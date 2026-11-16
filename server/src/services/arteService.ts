/**
 * arteService.ts — Mapas ilustrados («Arte»): lo que antes hacía el nginx de
 * la app independiente, ahora dentro de Trek.
 *
 *   · caché en disco de Overpass (30 días) y de las teselas de elevación (90 días)
 *   · peticiones de dibujo → issue en el repositorio de ilustraciones
 *   · sincronización de catálogo e ilustraciones (app/data) desde ese repositorio
 *
 * La app en sí (HTML + módulos JS, sin compilar) vive en /arte/app del
 * repositorio y se sirve tal cual desde routes/arte.ts.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { logInfo, logError } from './auditLog';

const dataRoot = path.join(__dirname, '../../data/arte');
const overpassDir = path.join(dataRoot, 'overpass');
const terrainDir = path.join(dataRoot, 'terreno');
const syncDir = path.join(dataRoot, 'sync');
/** Copia de app/data traída del repositorio de ilustraciones; tiene prioridad sobre la incluida. */
export const syncedDataDir = path.join(syncDir, 'data');
const manifestFile = path.join(syncDir, 'manifest.json');

const DAY = 24 * 60 * 60 * 1000;
const OVERPASS_TTL = 30 * DAY;
const TERRAIN_TTL = 90 * DAY;
const OVERPASS_MAX_BYTES = 80 * 1024 * 1024;
const USER_AGENT = 'ESTODOBAJADA-arte/1.0 (mapas ilustrados de bikepacking)';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Carpeta de la app estática: /app/arte en la imagen, <repo>/arte/app en desarrollo. */
export function arteAppDir(): string | null {
  const candidates = [
    process.env.ARTE_DIR,
    path.join(__dirname, '../../arte'),
    path.join(__dirname, '../../../arte/app'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeAtomic(file: string, data: Buffer | string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function freshFile(file: string, ttl: number): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < ttl;
  } catch {
    return false;
  }
}

// ── Overpass ────────────────────────────────────────────────────────────────

const overpassInFlight = new Map<string, Promise<{ file: string; cache: 'HIT' | 'MISS' }>>();

/**
 * Respuesta de Overpass para una consulta, desde la caché o recién pedida.
 * Devuelve la ruta del fichero JSON (se envía en streaming, puede pesar varios MB).
 */
export function overpassQuery(query: string): Promise<{ file: string; cache: 'HIT' | 'MISS' }> {
  const key = crypto.createHash('sha256').update(query).digest('hex');
  const file = path.join(overpassDir, `${key}.json`);
  if (freshFile(file, OVERPASS_TTL)) return Promise.resolve({ file, cache: 'HIT' });
  const running = overpassInFlight.get(key);
  if (running) return running;

  const job = (async () => {
    let lastErr: unknown = null;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': USER_AGENT,
          },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > OVERPASS_MAX_BYTES) throw new Error('respuesta demasiado grande');
        // Overpass responde 200 con HTML cuando está saturado: solo se guarda JSON válido.
        const head = buf.subarray(0, 64).toString('utf8').trimStart();
        if (!head.startsWith('{')) throw new Error('respuesta no válida');
        writeAtomic(file, buf);
        return { file, cache: 'MISS' as const };
      } catch (e) {
        lastErr = e;
      }
    }
    // Sin red: una copia caducada es mejor que nada.
    if (fs.existsSync(file)) return { file, cache: 'HIT' as const };
    throw lastErr instanceof Error ? lastErr : new Error('Overpass no responde');
  })().finally(() => overpassInFlight.delete(key));

  overpassInFlight.set(key, job);
  return job;
}

// ── Teselas de elevación (Terrarium, AWS Open Data) ─────────────────────────

export async function terrainTile(z: number, x: number, y: number): Promise<{ file: string; cache: 'HIT' | 'MISS' } | null> {
  const max = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > 15 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= max || y >= max) {
    return null;
  }
  const file = path.join(terrainDir, String(z), String(x), `${y}.png`);
  if (freshFile(file, TERRAIN_TTL)) return { file, cache: 'HIT' };
  try {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeAtomic(file, Buffer.from(await res.arrayBuffer()));
    return { file, cache: 'MISS' };
  } catch {
    return fs.existsSync(file) ? { file, cache: 'HIT' } : null;
  }
}

// ── Peticiones de dibujo ────────────────────────────────────────────────────

function arteRepo(): string {
  const repo = process.env.ARTE_REPO || process.env.PETICION_REPO || 'MelAnubis/estodobajada-arte';
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : 'MelAnubis/estodobajada-arte';
}

function requestToken(): string {
  return (process.env.ARTE_PETICION_TOKEN || process.env.PETICION_TOKEN || '').trim();
}

export function drawingRequestsEnabled(): boolean {
  return requestToken() !== '';
}

const requestLog = new Map<number, number[]>();
const REQUESTS_PER_MINUTE = 6;

/** Límite por usuario (el nginx original lo hacía por IP). */
export function drawingRequestAllowed(userId: number): boolean {
  const now = Date.now();
  const recent = (requestLog.get(userId) || []).filter(t => now - t < 60_000);
  if (recent.length >= REQUESTS_PER_MINUTE) {
    requestLog.set(userId, recent);
    return false;
  }
  recent.push(now);
  requestLog.set(userId, recent);
  return true;
}

export interface DrawingRequest {
  title: string;
  body: string;
}

/** Crea el issue con la etiqueta «dibujo». Devuelve el estado y el cuerpo que dio GitHub. */
export async function createDrawingRequest(req: DrawingRequest): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`https://api.github.com/repos/${arteRepo()}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requestToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ESTODOBAJADA-arte',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: req.title, body: req.body, labels: ['dibujo'] }),
    signal: AbortSignal.timeout(30_000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, body };
}

// ── Sincronización de app/data ──────────────────────────────────────────────

interface Manifest {
  etag?: string;
  files: Record<string, string>;
}

const SYNC_PREFIX = 'app/data/';
const SYNC_EXT = new Set(['.json', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.txt']);
const SYNC_MAX_FILE = 12 * 1024 * 1024;
const SYNC_MAX_FILES = 5000;

function syncToken(): string {
  return (process.env.ARTE_SYNC_TOKEN || process.env.SYNC_TOKEN || '').trim();
}

export function syncEnabled(): boolean {
  return syncToken() !== '';
}

function loadManifest(): Manifest {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (m && typeof m.files === 'object') return m as Manifest;
  } catch {
    /* primera vez */
  }
  return { files: {} };
}

/** Ruta relativa segura dentro de app/data, o null si no debe sincronizarse. */
export function safeSyncPath(repoPath: string): string | null {
  if (!repoPath.startsWith(SYNC_PREFIX)) return null;
  const rel = repoPath.slice(SYNC_PREFIX.length);
  if (!rel || rel.includes('\\') || rel.includes('\0')) return null;
  const parts = rel.split('/');
  if (parts.some(p => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null;
  if (!SYNC_EXT.has(path.extname(rel).toLowerCase())) return null;
  return rel;
}

let syncRunning = false;

/**
 * Trae del repositorio de ilustraciones lo que haya cambiado en app/data.
 * Una llamada al árbol de git (con ETag: si no hay cambios no descarga nada)
 * y una por fichero nuevo o modificado.
 */
export async function syncArteData(): Promise<{ changed: number; removed: number } | null> {
  const token = syncToken();
  if (!token || syncRunning) return null;
  syncRunning = true;
  try {
    const repo = arteRepo();
    const branch = process.env.ARTE_SYNC_BRANCH || 'main';
    const manifest = loadManifest();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ESTODOBAJADA-arte',
    };
    // Solo vale el ETag si la copia local sigue ahí.
    const haveLocal = fs.existsSync(syncedDataDir);
    const treeRes = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: manifest.etag && haveLocal ? { ...headers, 'If-None-Match': manifest.etag } : headers, signal: AbortSignal.timeout(60_000) },
    );
    if (treeRes.status === 304) return { changed: 0, removed: 0 };
    if (!treeRes.ok) throw new Error(`árbol: HTTP ${treeRes.status}`);
    const tree = (await treeRes.json()) as { tree?: { path: string; type: string; sha: string; size?: number }[]; truncated?: boolean };
    if (!Array.isArray(tree.tree)) throw new Error('árbol: respuesta no válida');

    const wanted = new Map<string, string>();
    for (const e of tree.tree) {
      if (e.type !== 'blob' || (e.size ?? 0) > SYNC_MAX_FILE) continue;
      const rel = safeSyncPath(e.path);
      if (rel && wanted.size < SYNC_MAX_FILES) wanted.set(rel, e.sha);
    }
    // Un árbol truncado o vacío no puede borrar lo que ya teníamos.
    const complete = !tree.truncated && wanted.size > 0;

    let changed = 0;
    let failed = 0;
    const files: Record<string, string> = haveLocal ? { ...manifest.files } : {};
    for (const [rel, sha] of wanted) {
      const dest = path.join(syncedDataDir, rel);
      if (files[rel] === sha && fs.existsSync(dest)) continue;
      try {
        const blobRes = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, {
          headers: { ...headers, Accept: 'application/vnd.github.raw' },
          signal: AbortSignal.timeout(120_000),
        });
        if (!blobRes.ok) throw new Error(`HTTP ${blobRes.status}`);
        writeAtomic(dest, Buffer.from(await blobRes.arrayBuffer()));
        files[rel] = sha;
        changed++;
      } catch (e) {
        failed++;
        logError(`Arte sync: ${rel}: ${e instanceof Error ? e.message : e}`);
      }
    }

    let removed = 0;
    if (complete) {
      for (const rel of Object.keys(files)) {
        if (wanted.has(rel)) continue;
        try {
          fs.rmSync(path.join(syncedDataDir, rel), { force: true });
        } catch {
          /* ya no estaba */
        }
        delete files[rel];
        removed++;
      }
    }

    // Con fallos no se guarda el ETag: la próxima vuelta lo reintenta.
    const etag = failed === 0 ? treeRes.headers.get('etag') || undefined : undefined;
    writeAtomic(manifestFile, JSON.stringify({ etag, files } satisfies Manifest));
    if (changed || removed) logInfo(`Arte sync: ${changed} actualizados, ${removed} eliminados`);
    return { changed, removed };
  } catch (e) {
    logError(`Arte sync: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    syncRunning = false;
  }
}

// ── Limpieza de cachés ──────────────────────────────────────────────────────

function pruneDir(dir: string, ttl: number): number {
  let n = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      n += pruneDir(full, ttl);
      try {
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } catch {
        /* en uso */
      }
    } else if (!freshFile(full, ttl)) {
      try {
        fs.rmSync(full, { force: true });
        n++;
      } catch {
        /* en uso */
      }
    }
  }
  return n;
}

/** Borra lo que lleva caducado más del doble de su vigencia (la copia caducada sirve sin red). */
export function pruneArteCaches(): number {
  return pruneDir(overpassDir, OVERPASS_TTL * 2) + pruneDir(terrainDir, TERRAIN_TTL * 2);
}

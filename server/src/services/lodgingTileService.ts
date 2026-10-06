/**
 * lodgingTileService.ts — Alojamientos y poblaciones de OpenStreetMap cerca de una línea, con caché por teselas.
 *
 * Los servidores públicos de Overpass fallan a menudo, y una consulta `around` con una polilínea larga es
 * de las más pesadas. Aquí se hace al revés: el mundo se divide en teselas de 0,1° (≈ 8–11 km), cada tesela
 * se consulta con una caja (barata) y se guarda en la base de datos durante 30 días, compartida entre rutas
 * y usuarios. Una vez descargada una zona ya no depende de que Overpass responda, y si una consulta falla
 * el reintento solo pide las teselas que faltan.
 */
import { db } from '../db/database';
import { overpassElements, overpassSelectorsFor } from './mapsService';

const TILE_DEG = 0.1;
/** Súbelo al cambiar los filtros de una categoría: las teselas guardadas con los filtros antiguos dejan de valer. */
const CACHE_VERSION = 2;
const cacheKey = (category: string) => `${category}:v${CACHE_VERSION}`;
const BUCKET_TILES = 4;                       // una consulta cubre hasta 4×4 teselas (0,4° × 0,4°)
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_AFTER_MS = 120 * 24 * 60 * 60 * 1000;
const ELEMENT_CAP = 4000;                     // si una consulta llega al tope puede estar incompleta: no se cachea

/** `type` solo en poblaciones: city / town / village. */
export interface TilePoi { osm_id: string; lat: number; lng: number; name: string; type?: string }
export type LodgingPoi = TilePoi

interface StoredPoi { i: string; a: number; o: number; n: string; t?: string }

export type TileCategory = 'lodging' | 'settlement'
const SETTLEMENT_TYPES = new Set(['city', 'town', 'village'])

export interface LodgingResult {
  pois: TilePoi[];
  /** Consultas a Overpass hechas y cuántas fallaron (0 consultas = todo salió del caché). */
  buckets: number;
  failedBuckets: number;
  /** Teselas necesarias para esta línea que no se pudieron obtener. */
  failedTiles: number;
}

const tileOf = (lat: number, lng: number): [number, number] => [Math.floor(lat / TILE_DEG), Math.floor(lng / TILE_DEG)];
const keyOf = (ty: number, tx: number) => `${ty}:${tx}`;

/** Distancia (m) de un punto a un segmento, en un plano local. */
function distToSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const kx = Math.cos(p[0] * Math.PI / 180) * 111320, ky = 110540;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Teselas que toca la línea ensanchada `radiusM` (se interpola para no saltarse teselas en tramos largos). */
export function tilesForLine(line: [number, number][], radiusM: number): Set<string> {
  const out = new Set<string>();
  const add = (lat: number, lng: number) => {
    const dLat = radiusM / 110540, dLng = radiusM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    for (const la of [lat - dLat, lat + dLat]) for (const lo of [lng - dLng, lng + dLng]) { const [ty, tx] = tileOf(la, lo); out.add(keyOf(ty, tx)); }
  };
  for (let i = 0; i < line.length; i++) {
    add(line[i][0], line[i][1]);
    if (i === 0) continue;
    const steps = Math.ceil(Math.max(Math.abs(line[i][0] - line[i - 1][0]), Math.abs(line[i][1] - line[i - 1][1])) / (TILE_DEG / 2));
    for (let s = 1; s < steps; s++) add(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * s / steps, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * s / steps);
  }
  return out;
}

const parseKey = (k: string): [number, number] => { const [a, b] = k.split(':'); return [Number(a), Number(b)]; };

function readTile(category: string, key: string): StoredPoi[] | null {
  const row = db.prepare('SELECT fetched_at, data FROM poi_tiles WHERE category = ? AND tile = ?').get(cacheKey(category), key) as { fetched_at: number; data: string } | undefined;
  if (!row || Date.now() - row.fetched_at > TTL_MS) return null;
  try { return JSON.parse(row.data) as StoredPoi[]; } catch { return null; }
}

const upsertTile = () => db.prepare(
  `INSERT INTO poi_tiles (category, tile, fetched_at, data) VALUES (?,?,?,?)
   ON CONFLICT(category, tile) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data`);

/**
 * POIs de una categoría («lodging»: hoteles, hostales, casas rurales, apartamentos, campings…; «settlement»: ciudades,
 * pueblos y aldeas grandes) a menos de `radiusM` de la línea. `deadline` (ms epoch) corta las consultas pendientes
 * para no pasarse del tiempo total del llamador.
 */
export async function getTilePois(category: TileCategory, line: [number, number][], radiusM: number, opts: { deadline?: number } = {}): Promise<LodgingResult> {
  const needed = [...tilesForLine(line, radiusM)];
  const data = new Map<string, StoredPoi[]>();
  const missing: string[] = [];
  for (const k of needed) {
    const t = readTile(category, k);
    if (t) data.set(k, t); else missing.push(k);
  }

  // Teselas que faltan → consultas por cajas de hasta 4×4 teselas.
  const buckets = new Map<string, string[]>();
  for (const k of missing) {
    const [ty, tx] = parseKey(k);
    const bk = `${Math.floor(ty / BUCKET_TILES)}:${Math.floor(tx / BUCKET_TILES)}`;
    (buckets.get(bk) ?? buckets.set(bk, []).get(bk)!).push(k);
  }

  let failedBuckets = 0, failedTiles = 0, queries = 0;
  const upsert = upsertTile();
  for (const tiles of buckets.values()) {
    queries++;
    if (opts.deadline && Date.now() > opts.deadline) { failedBuckets++; failedTiles += tiles.length; continue; }
    const ys = tiles.map(k => parseKey(k)[0]), xs = tiles.map(k => parseKey(k)[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys), minX = Math.min(...xs), maxX = Math.max(...xs);
    const r = (n: number) => Math.round(n * 1e6) / 1e6;
    const box = `(${r(minY * TILE_DEG)},${r(minX * TILE_DEG)},${r((maxY + 1) * TILE_DEG)},${r((maxX + 1) * TILE_DEG)})`;
    const query = `[out:json][timeout:25];\n(\n${overpassSelectorsFor(category, box)}\n);\nout center tags ${ELEMENT_CAP};`;
    try {
      const elements = await overpassElements(query);
      const perTile = new Map<string, StoredPoi[]>();
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) perTile.set(keyOf(y, x), []);
      for (const el of elements) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) continue;
        const name = String(el.tags?.name || '').slice(0, 80);
        let type: string | undefined;
        if (category === 'settlement') {
          type = el.tags?.place;
          if (!type || !SETTLEMENT_TYPES.has(type) || !name) continue;     // una población sin nombre no sirve de fin de etapa
        }
        const [ty, tx] = tileOf(lat, lng);
        perTile.get(keyOf(ty, tx))?.push({ i: `${el.type}:${el.id}`, a: Math.round(lat * 1e5) / 1e5, o: Math.round(lng * 1e5) / 1e5, n: name, ...(type ? { t: type } : {}) });
      }
      const complete = elements.length < ELEMENT_CAP;    // al tope puede faltar algo: se usa pero no se cachea
      const now = Date.now();
      for (const [k, list] of perTile) {
        if (complete) upsert.run(cacheKey(category), k, now, JSON.stringify(list));
        if (needed.includes(k)) data.set(k, list);
      }
    } catch {
      failedBuckets++;
      failedTiles += tiles.length;
    }
  }
  if (queries) { try { db.prepare('DELETE FROM poi_tiles WHERE fetched_at < ?').run(Date.now() - PRUNE_AFTER_MS); } catch { /* limpieza best-effort */ } }

  // Solo lo realmente cerca de la línea (las teselas son más anchas que el corredor).
  const seen = new Set<string>();
  const pois: TilePoi[] = [];
  for (const list of data.values()) {
    for (const p of list) {
      if (seen.has(p.i)) continue;
      let best = Infinity;
      for (let i = 1; i < line.length; i++) { const d = distToSegmentM([p.a, p.o], line[i - 1], line[i]); if (d < best) best = d; }
      if (best <= radiusM) { seen.add(p.i); pois.push({ osm_id: p.i, lat: p.a, lng: p.o, name: p.n, ...(p.t ? { type: p.t } : {}) }); }
    }
  }
  return { pois, buckets: queries, failedBuckets, failedTiles };
}

/** Alojamientos cerca de la línea (ver getTilePois). */
export const getLodgingNearLine = (line: [number, number][], radiusM: number, opts: { deadline?: number } = {}) =>
  getTilePois('lodging', line, radiusM, opts);

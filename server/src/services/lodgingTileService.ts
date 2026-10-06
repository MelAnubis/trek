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
import { overpassElements, overpassSelectorsFor, nominatimLodgingElements, categoryAllowsUnnamed } from './mapsService';

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

/** Categorías que se sirven por teselas (poco densas: una caja de 0,4° cabe sobrada en el tope de resultados). */
export const TILE_CATEGORIES = ['lodging', 'camping', 'station', 'bike_shop', 'bike_repair', 'supermarket', 'water', 'settlement'] as const
export type TileCategory = typeof TILE_CATEGORIES[number]
const SETTLEMENT_TYPES = new Set(['city', 'town', 'village'])

export interface LodgingResult {
  pois: TilePoi[];
  /** Consultas a Overpass hechas y cuántas fallaron (0 consultas = todo salió del caché). */
  buckets: number;
  failedBuckets: number;
  /** Teselas necesarias para esta línea que no se pudieron obtener. */
  failedTiles: number;
  /** Teselas que se han servido de un caché CADUCADO porque la consulta falló (mejor datos viejos que ninguno). */
  staleTiles: number;
  /** Teselas que se han resuelto con Nominatim porque Overpass no respondía (puede faltar algo). */
  fallbackTiles: number;
  /** Motivos de los fallos de Overpass (los primeros), para mostrarlos o registrarlos. */
  errors: string[];
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

function readTile(category: string, key: string): { list: StoredPoi[]; stale: boolean } | null {
  const row = db.prepare('SELECT fetched_at, data FROM poi_tiles WHERE category = ? AND tile = ?').get(cacheKey(category), key) as { fetched_at: number; data: string } | undefined;
  if (!row) return null;
  try { return { list: JSON.parse(row.data) as StoredPoi[], stale: Date.now() - row.fetched_at > TTL_MS }; } catch { return null; }
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
  const stale = new Map<string, StoredPoi[]>();
  const missing: string[] = [];
  for (const k of needed) {
    const t = readTile(category, k);
    if (t && !t.stale) data.set(k, t.list);
    else { if (t) stale.set(k, t.list); missing.push(k); }
  }

  // Teselas que faltan → consultas por cajas de hasta 4×4 teselas.
  const buckets = new Map<string, string[]>();
  for (const k of missing) {
    const [ty, tx] = parseKey(k);
    const bk = `${Math.floor(ty / BUCKET_TILES)}:${Math.floor(tx / BUCKET_TILES)}`;
    (buckets.get(bk) ?? buckets.set(bk, []).get(bk)!).push(k);
  }

  let failedBuckets = 0, failedTiles = 0, queries = 0, staleTiles = 0, fallbackTiles = 0;
  const errors: string[] = [];
  /** Si no se pudo refrescar, se usa lo caducado; solo cuenta como fallo lo que no tiene nada que ofrecer. */
  const giveUp = (tiles: string[], reason: string) => {
    if (reason && errors.length < 3 && !errors.includes(reason)) errors.push(reason);
    let lost = 0;
    for (const k of tiles) {
      const old = stale.get(k);
      if (old) { data.set(k, old); staleTiles++; } else lost++;
    }
    if (lost) { failedBuckets++; failedTiles += lost; }
  };
  const upsert = upsertTile();
  for (const tiles of buckets.values()) {
    queries++;
    if (opts.deadline && Date.now() > opts.deadline) { giveUp(tiles, 'tiempo agotado'); continue; }
    const ys = tiles.map(k => parseKey(k)[0]), xs = tiles.map(k => parseKey(k)[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys), minX = Math.min(...xs), maxX = Math.max(...xs);
    const r = (n: number) => Math.round(n * 1e6) / 1e6;
    const box = `(${r(minY * TILE_DEG)},${r(minX * TILE_DEG)},${r((maxY + 1) * TILE_DEG)},${r((maxX + 1) * TILE_DEG)})`;
    const query = `[out:json][timeout:25];\n(\n${overpassSelectorsFor(category, box)}\n);\nout center tags ${ELEMENT_CAP};`;
    try {
      let elements: Awaited<ReturnType<typeof overpassElements>>;
      let viaFallback = false;
      try {
        elements = await overpassElements(query);
      } catch (err) {
        const detail = (err as { detail?: string[] })?.detail;
        const reason = detail?.length ? detail.slice(0, 2).join(' · ') : (err as Error)?.message ?? 'Overpass';
        if (category !== 'lodging') throw Object.assign(err as Error, { reason });
        // Overpass no responde: los alojamientos se piden a Nominatim (otro servidor de OpenStreetMap).
        try {
          elements = await nominatimLodgingElements(minY * TILE_DEG, minX * TILE_DEG, (maxY + 1) * TILE_DEG, (maxX + 1) * TILE_DEG);
          viaFallback = true;
          if (errors.length < 3 && !errors.includes(reason)) errors.push(reason);
        } catch { throw Object.assign(err as Error, { reason }); }
      }
      const perTile = new Map<string, StoredPoi[]>();
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) perTile.set(keyOf(y, x), []);
      for (const el of elements) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) continue;
        const name = String(el.tags?.name || '').slice(0, 80);
        if (category === 'water' && el.tags?.drinking_water === 'no') continue;
        let type: string | undefined;
        if (category === 'settlement') {
          type = el.tags?.place;
          if (!type || !SETTLEMENT_TYPES.has(type) || !name) continue;     // una población sin nombre no sirve de fin de etapa
        }
        const [ty, tx] = tileOf(lat, lng);
        perTile.get(keyOf(ty, tx))?.push({ i: `${el.type}:${el.id}`, a: Math.round(lat * 1e5) / 1e5, o: Math.round(lng * 1e5) / 1e5, n: name, ...(type ? { t: type } : {}) });
      }
      // Al tope de resultados, o si viene de Nominatim (50 por término), puede faltar algo: se usa pero no se cachea.
      const complete = !viaFallback && elements.length < ELEMENT_CAP;
      const now = Date.now();
      for (const [k, list] of perTile) {
        if (complete) upsert.run(cacheKey(category), k, now, JSON.stringify(list));
        if (needed.includes(k)) data.set(k, list);
      }
      if (viaFallback) fallbackTiles += tiles.length;
    } catch (err) {
      giveUp(tiles, (err as { reason?: string })?.reason ?? (err as Error)?.message ?? 'error');
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
  return { pois, buckets: queries, failedBuckets, failedTiles, staleTiles, fallbackTiles, errors };
}

/** Alojamientos cerca de la línea (ver getTilePois). */
export const getLodgingNearLine = (line: [number, number][], radiusM: number, opts: { deadline?: number } = {}) =>
  getTilePois('lodging', line, radiusM, opts);

// ── Búsqueda «a lo largo de la ruta» para el panel de servicios ──────────────

export interface RoutePoi {
  osm_id: string; name: string; lat: number; lng: number; category: string; poi_type: string;
  address: null; website: null; phone: null; opening_hours: null; cuisine: null; source: 'openstreetmap';
}

/** Categorías del panel que se resuelven con el caché por teselas; «hotel» es el alojamiento en general. */
export function tileCategoryFor(category: string): TileCategory | null {
  const c = category === 'hotel' ? 'lodging' : category;
  return (TILE_CATEGORIES as readonly string[]).includes(c) ? c as TileCategory : null;
}

/**
 * POIs de una categoría a menos de `radiusM` de la línea, por teselas (caché + reutiliza datos caducados si falla
 * Overpass + Nominatim para alojamientos). `partial` si alguna zona no se pudo consultar; lanza si no se pudo ninguna.
 */
export async function searchTilePoisAlongRoute(category: string, line: [number, number][], radiusM: number, opts: { deadline?: number } = {}) {
  const tc = tileCategoryFor(category);
  if (!tc) throw Object.assign(new Error('Category is not served by tiles'), { status: 400 });
  const res = await getTilePois(tc, line, Math.min(3000, Math.max(100, Math.round(radiusM))), opts);
  const needsName = !categoryAllowsUnnamed(tc);
  const pois: RoutePoi[] = res.pois
    .filter(p => !needsName || p.name)
    .map(p => ({
      osm_id: p.osm_id, name: p.name, lat: p.lat, lng: p.lng, category, poi_type: p.type ?? tc,
      address: null, website: null, phone: null, opening_hours: null, cuisine: null, source: 'openstreetmap' as const,
    }));
  if (res.buckets > 0 && res.failedBuckets >= res.buckets && !pois.length && res.staleTiles === 0) {
    throw Object.assign(new Error('Overpass request failed'), { status: 502, detail: res.errors });
  }
  return { pois, source: 'openstreetmap' as const, truncated: false, clamped: false, partial: res.failedBuckets > 0, stale: res.staleTiles > 0, fallback: res.fallbackTiles > 0, errors: res.errors };
}

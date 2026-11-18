/**
 * arteTrekService.ts — Lo que une los mapas ilustrados (Arte) con el resto de Trek:
 *
 *   · las rutas del usuario (planificador, tracks y excursiones de sus viajes) como GPX
 *   · sus composiciones guardadas (antes en el IndexedDB del navegador)
 */
import zlib from 'node:zlib';
import { db } from '../db/database';

// ── Rutas del usuario ───────────────────────────────────────────────────────

export type RouteKind = 'planner' | 'track' | 'tour';

export interface RouteSummary {
  tipo: RouteKind;
  id: number;
  nombre: string;
  km: number | null;
  puntos: number | null;
  viaje: string | null;
  fecha: string | null;
}

/** Viajes que el usuario puede ver: los suyos y aquellos de los que es miembro. */
const TRIP_ACCESS = `(t.user_id = @uid OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = @uid))`;

export function listUserRoutes(userId: number): RouteSummary[] {
  const out: RouteSummary[] = [];

  const planner = db.prepare(
    `SELECT id, name, total_distance_km AS km, point_count AS puntos, updated_at AS fecha
       FROM planner_routes WHERE user_id = ? AND point_count >= 2 ORDER BY updated_at DESC LIMIT 500`,
  ).all(userId) as { id: number; name: string; km: number | null; puntos: number | null; fecha: string | null }[];
  for (const r of planner) out.push({ tipo: 'planner', id: r.id, nombre: r.name, km: r.km, puntos: r.puntos, viaje: null, fecha: r.fecha });

  const tracks = db.prepare(
    `SELECT g.id, g.track_name AS name, g.total_distance AS dist, g.point_count AS puntos, g.created_at AS fecha, t.title AS viaje
       FROM gpx_tracks g JOIN trips t ON t.id = g.trip_id
      WHERE ${TRIP_ACCESS} AND g.point_count >= 2 ORDER BY g.created_at DESC LIMIT 500`,
  ).all({ uid: userId }) as { id: number; name: string; dist: number | null; puntos: number | null; fecha: string | null; viaje: string | null }[];
  // total_distance de los tracks ya va en km (computeStats en routes/gpxTracks.ts).
  for (const r of tracks) out.push({ tipo: 'track', id: r.id, nombre: r.name, km: r.dist ?? null, puntos: r.puntos, viaje: r.viaje, fecha: r.fecha });

  const tours = db.prepare(
    `SELECT p.id, p.name, tr.distance AS dist, tr.created_at AS fecha, t.title AS viaje
       FROM tours tr JOIN places p ON p.id = tr.place_id JOIN trips t ON t.id = p.trip_id
      WHERE ${TRIP_ACCESS} AND p.route_geometry IS NOT NULL ORDER BY tr.created_at DESC LIMIT 500`,
  ).all({ uid: userId }) as { id: number; name: string; dist: number | null; fecha: string | null; viaje: string | null }[];
  // distance de las excursiones también va en km (computeTourMetrics().distanceKm).
  for (const r of tours) out.push({ tipo: 'tour', id: r.id, nombre: r.name, km: r.dist ?? null, puntos: null, viaje: r.viaje, fecha: r.fecha });

  return out;
}

type Pt = { lat: number; lng: number; ele: number | null };

function normalizePoints(raw: unknown): Pt[] {
  if (!Array.isArray(raw)) return [];
  const out: Pt[] = [];
  for (const p of raw) {
    let lat: unknown, lng: unknown, ele: unknown;
    if (Array.isArray(p)) [lat, lng, ele] = p;
    else if (p && typeof p === 'object') ({ lat, lng, ele } = p as Record<string, unknown>);
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng, ele: typeof ele === 'number' && Number.isFinite(ele) ? ele : null });
  }
  return out;
}

const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * GPX con los puntos tal como los guarda Trek: sin simplificar, suavizar ni
 * reordenar (Arte valida después su mapa contra este texto, punto a punto).
 */
export function buildGpx(name: string, points: Pt[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trek" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xmlEsc(name)}</name></metadata>`,
    '  <trk>',
    `    <name>${xmlEsc(name)}</name>`,
    '    <trkseg>',
  ];
  for (const p of points) {
    lines.push(p.ele != null
      ? `      <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`
      : `      <trkpt lat="${p.lat}" lon="${p.lng}"/>`);
  }
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}

function parseJson(text: string | null | undefined): unknown {
  try {
    return JSON.parse(text || '[]');
  } catch {
    return [];
  }
}

/** La ruta como GPX, o null si no existe o el usuario no puede verla. */
export function userRouteGpx(userId: number, kind: RouteKind, id: number): { name: string; gpx: string } | null {
  let row: { name: string; points: string | null } | undefined;
  if (kind === 'planner') {
    row = db.prepare('SELECT name, points_json AS points FROM planner_routes WHERE id = ? AND user_id = ?').get(id, userId) as typeof row;
  } else if (kind === 'track') {
    row = db.prepare(
      `SELECT g.track_name AS name, g.points_json AS points FROM gpx_tracks g JOIN trips t ON t.id = g.trip_id WHERE g.id = @id AND ${TRIP_ACCESS}`,
    ).get({ id, uid: userId }) as typeof row;
  } else if (kind === 'tour') {
    row = db.prepare(
      `SELECT p.name, p.route_geometry AS points FROM tours tr JOIN places p ON p.id = tr.place_id JOIN trips t ON t.id = p.trip_id
        WHERE p.id = @id AND ${TRIP_ACCESS}`,
    ).get({ id, uid: userId }) as typeof row;
  }
  if (!row) return null;
  const points = normalizePoints(parseJson(row.points));
  if (points.length < 2) return null;
  return { name: row.name, gpx: buildGpx(row.name, points) };
}

// ── Composiciones ───────────────────────────────────────────────────────────

export const COMPOSITION_FORMAT = 'estodobajada-arte/composicion';
const MAX_COMPOSITIONS = 300;
const MAX_THUMB = 300_000;
const MAX_IMAGE = 4 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export interface CompositionSummary {
  id: string;
  nombre: string;
  guardado: string;
  gpx: string | null;
  conOsm: boolean;
  miniatura: string | null;
  conImagen: boolean;
}

export function validCompositionId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function listCompositions(userId: number): CompositionSummary[] {
  const rows = db.prepare(
    `SELECT id, name, saved_at, gpx_name, has_osm, thumbnail, image IS NOT NULL AS has_image
       FROM arte_compositions WHERE user_id = ? ORDER BY saved_at DESC`,
  ).all(userId) as { id: string; name: string; saved_at: string; gpx_name: string | null; has_osm: number; thumbnail: string | null; has_image: number }[];
  return rows.map(r => ({ id: r.id, nombre: r.name, guardado: r.saved_at, gpx: r.gpx_name, conOsm: !!r.has_osm, miniatura: r.thumbnail, conImagen: !!r.has_image }));
}

/** La composición completa, como la guardó la app (con su miniatura, sin la imagen pintada). */
export function getComposition(userId: number, id: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT data, thumbnail FROM arte_compositions WHERE user_id = ? AND id = ?').get(userId, id) as { data: Buffer; thumbnail: string | null } | undefined;
  if (!row) return null;
  try {
    const comp = JSON.parse(zlib.gunzipSync(row.data).toString('utf8')) as Record<string, unknown>;
    if (row.thumbnail) comp.miniatura = row.thumbnail;
    return comp;
  } catch {
    return null;
  }
}

export function getCompositionImage(userId: number, id: string): Buffer | null {
  const row = db.prepare('SELECT image FROM arte_compositions WHERE user_id = ? AND id = ?').get(userId, id) as { image: Buffer | null } | undefined;
  return row?.image ?? null;
}

function decodeJpegDataUrl(v: unknown): Buffer | null {
  if (typeof v !== 'string') return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  // JPEG: empieza por FF D8 FF.
  if (buf.length < 4 || buf.length > MAX_IMAGE || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return buf;
}

export type SaveResult = { ok: true; summary: CompositionSummary } | { ok: false; status: number; error: string };

/**
 * Guarda (crea o sustituye) una composición. `imagen` (data: URL JPEG del mapa
 * pintado) va aparte del JSON: se guarda en binario y no vuelve con la composición.
 */
export function saveComposition(userId: number, id: string, body: unknown): SaveResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'Composición no válida' };
  const comp = { ...(body as Record<string, unknown>) };
  const gpx = comp.gpx as { nombre?: unknown; texto?: unknown } | undefined;
  if (comp.formato !== COMPOSITION_FORMAT || !gpx || typeof gpx.texto !== 'string' || !gpx.texto.includes('<')) {
    return { ok: false, status: 400, error: 'Composición no válida' };
  }
  const exists = db.prepare('SELECT 1 FROM arte_compositions WHERE user_id = ? AND id = ?').get(userId, id);
  if (!exists) {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM arte_compositions WHERE user_id = ?').get(userId) as { n: number }).n;
    if (n >= MAX_COMPOSITIONS) return { ok: false, status: 409, error: `Has llegado al máximo de ${MAX_COMPOSITIONS} composiciones` };
  }

  const name = (typeof comp.nombre === 'string' && comp.nombre.trim() ? comp.nombre.trim() : 'Sin título').slice(0, 200);
  const savedAt = typeof comp.guardado === 'string' && !Number.isNaN(Date.parse(comp.guardado)) ? new Date(comp.guardado).toISOString() : new Date().toISOString();
  const gpxName = typeof gpx.nombre === 'string' ? gpx.nombre.slice(0, 255) : null;
  const thumbnail = typeof comp.miniatura === 'string' && comp.miniatura.startsWith('data:image/jpeg;base64,') && comp.miniatura.length <= MAX_THUMB ? comp.miniatura : null;
  const image = decodeJpegDataUrl(comp.imagen);
  const imageW = image && Number.isFinite(Number(comp.imagen_ancho)) ? Math.round(Number(comp.imagen_ancho)) : null;
  const imageH = image && Number.isFinite(Number(comp.imagen_alto)) ? Math.round(Number(comp.imagen_alto)) : null;
  delete comp.miniatura;
  delete comp.imagen;
  delete comp.imagen_ancho;
  delete comp.imagen_alto;
  comp.id = id;
  comp.nombre = name;
  comp.guardado = savedAt;

  const data = zlib.gzipSync(Buffer.from(JSON.stringify(comp), 'utf8'));
  // Sin imagen nueva se conserva la que hubiera (p. ej. al importar una copia de seguridad).
  db.prepare(
    `INSERT INTO arte_compositions (user_id, id, name, saved_at, gpx_name, has_osm, thumbnail, data, image, image_width, image_height)
     VALUES (@user_id, @id, @name, @saved_at, @gpx_name, @has_osm, @thumbnail, @data, @image, @image_width, @image_height)
     ON CONFLICT(user_id, id) DO UPDATE SET
       name = excluded.name, saved_at = excluded.saved_at, gpx_name = excluded.gpx_name, has_osm = excluded.has_osm,
       thumbnail = COALESCE(excluded.thumbnail, arte_compositions.thumbnail), data = excluded.data,
       image = COALESCE(excluded.image, arte_compositions.image),
       image_width = CASE WHEN excluded.image IS NULL THEN arte_compositions.image_width ELSE excluded.image_width END,
       image_height = CASE WHEN excluded.image IS NULL THEN arte_compositions.image_height ELSE excluded.image_height END`,
  ).run({ user_id: userId, id, name, saved_at: savedAt, gpx_name: gpxName, has_osm: comp.osm ? 1 : 0, thumbnail, data, image, image_width: imageW, image_height: imageH });

  const summary = listCompositions(userId).find(c => c.id === id)!;
  return { ok: true, summary };
}

export function deleteComposition(userId: number, id: string): boolean {
  return db.prepare('DELETE FROM arte_compositions WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

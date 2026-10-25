/**
 * La zona pública (#ESTODOBAJADA): lo que se ve sin cuenta.
 *
 * - Rutas: viajes con trips.is_public = 1. Solo lo que sirve para conocer la
 *   ruta — título, texto, fechas, portada, días, etapas, lugares y el trazado
 *   con su perfil. Nada de reservas, presupuesto, miembros, notas ni
 *   documentos. El GPX se descarga solo con sesión (routes/site.ts).
 * - Relatos: los posts publicados del blog de las travesías que un admin ha
 *   marcado como «diario del sitio» (journeys.site_journal = 1). Se escriben
 *   con el editor del blog de siempre.
 */
import { db } from '../db/database';
import { getSitePostsFor, getSitePost } from './blogService';

interface TripRow {
  id: number; title: string; description: string | null; start_date: string | null; end_date: string | null;
  cover_image: string | null; trip_type: string | null; published_at: number | null; owner: string;
}
interface TrackRow {
  id: number; day_id: number | null; total_distance: number | null; total_elevation_gain: number | null;
  total_elevation_loss: number | null; max_elevation: number | null; points_json: string | null; sort_order: number;
}
type Pt = { lat: number; lng: number; ele?: number | null };

const PROFILE_POINTS = 160;
const LINE_POINTS = 260;

function tripRows(where = '', ...args: unknown[]): TripRow[] {
  return db.prepare(`
    SELECT t.id, t.title, t.description, t.start_date, t.end_date, t.cover_image, t.trip_type, t.published_at, u.username AS owner
    FROM trips t JOIN users u ON u.id = t.user_id
    WHERE t.is_public = 1 ${where}
    ORDER BY COALESCE(t.published_at, 0) DESC, t.id DESC
  `).all(...args) as TripRow[];
}

function tracksOf(tripId: number): TrackRow[] {
  return db.prepare(`
    SELECT id, day_id, total_distance, total_elevation_gain, total_elevation_loss, max_elevation, points_json, sort_order
    FROM gpx_tracks WHERE trip_id = ? AND COALESCE(is_active, 1) = 1
    ORDER BY sort_order ASC, id ASC
  `).all(tripId) as TrackRow[];
}

function parsePts(json: string | null): Pt[] {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  } catch { return []; }
}

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * rad) / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const r = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Every n-th point, always keeping the last one. */
function sample<T>(a: T[], max: number): T[] {
  if (a.length <= max) return a;
  const step = (a.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => a[Math.round(i * step)]);
}

/** The whole route as one line: [km, ele] profile and [lat, lng] polyline per track. */
function geometry(tracks: TrackRow[]) {
  const lines: [number, number][][] = [];
  const prof: [number, number][] = [];
  let km = 0;
  for (const t of tracks) {
    const pts = parsePts(t.points_json);
    if (!pts.length) continue;
    lines.push(sample(pts, LINE_POINTS).map(p => [r(p.lat, 5), r(p.lng, 5)] as [number, number]));
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) km += haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000;
      if (pts[i].ele != null && Number.isFinite(pts[i].ele)) prof.push([km, pts[i].ele as number]);
    }
  }
  return { lines, profile: sample(prof, PROFILE_POINTS).map(([k, e]) => [r(k, 2), Math.round(e)] as [number, number]) };
}

function stats(tracks: TrackRow[]) {
  const sum = (k: keyof TrackRow) => tracks.reduce((s, t) => s + (Number(t[k]) || 0), 0);
  const maxEle = tracks.reduce((m, t) => (t.max_elevation != null && t.max_elevation > m ? t.max_elevation : m), -Infinity);
  return {
    distance_km: r(sum('total_distance')),
    gain_m: Math.round(sum('total_elevation_gain')),
    loss_m: Math.round(sum('total_elevation_loss')),
    max_ele_m: Number.isFinite(maxEle) ? Math.round(maxEle) : null,
  };
}

function dayCount(tripId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM days WHERE trip_id = ?').get(tripId) as { n: number }).n;
}

function summaryOf(t: TripRow) {
  const tracks = tracksOf(t.id);
  const g = geometry(tracks);
  return {
    id: t.id, title: t.title, description: t.description, start_date: t.start_date, end_date: t.end_date,
    cover_image: t.cover_image, cycling: t.trip_type === 'cycling', author: t.owner,
    days: dayCount(t.id), ...stats(tracks), profile: g.profile,
    lines: g.lines.map(l => sample(l, Math.max(24, Math.floor(LINE_POINTS / g.lines.length)))),
  };
}
export type SiteRoute = ReturnType<typeof summaryOf>;

// Leer y muestrear los trazados cuesta: un minuto de caché, que se vacía
// cuando cambia algo que se ve aquí (un viaje se hace público, un diario…).
const TTL = 60_000;
const cache = new Map<string, { at: number; v: unknown }>();
function cached<T>(key: string, fn: () => T): T {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}
export function clearSiteCache(): void { cache.clear(); }

export function getSiteHome(allowRegistration: boolean) {
  const routes = cached('routes', () => tripRows().map(summaryOf));
  const stories = getSitePostsFor(siteJournals());
  return { routes, stories, registration: allowRegistration };
}

export function getSiteRoute(id: number) {
  return cached(`route:${id}`, () => buildRoute(id));
}

function buildRoute(id: number) {
  const t = tripRows('AND t.id = ?', id)[0];
  if (!t) return null;
  const tracks = tracksOf(t.id);
  const days = db.prepare('SELECT id, day_number, date, title, notes FROM days WHERE trip_id = ? ORDER BY day_number').all(t.id) as { id: number; day_number: number; date: string | null; title: string | null; notes: string | null }[];
  const places = db.prepare(`
    SELECT da.day_id, p.name, p.lat, p.lng, c.name AS category, c.color, c.icon
    FROM day_assignments da JOIN places p ON p.id = da.place_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.trip_id = ? AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    ORDER BY da.day_id, da.order_index
  `).all(t.id) as { day_id: number; name: string; lat: number; lng: number; category: string | null; color: string | null; icon: string | null }[];
  const stages = days.map(d => {
    const own = tracks.filter(tr => tr.day_id === d.id);
    const g = geometry(own);
    return {
      day_number: d.day_number, date: d.date, title: d.title,
      ...stats(own), lines: g.lines, profile: g.profile,
      places: places.filter(p => p.day_id === d.id).map(({ day_id: _d, ...p }) => p),
    };
  });
  const loose = tracks.filter(tr => tr.day_id == null || !days.some(d => d.id === tr.day_id));
  return {
    ...summaryOf(t),
    stages,
    extra_lines: geometry(loose).lines,
    gpx: tracks.length > 0 || places.length > 0,
  };
}

export function isPublicTrip(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM trips WHERE id = ? AND is_public = 1').get(id);
}

export function siteJournals(): number[] {
  return (db.prepare('SELECT id FROM journeys WHERE site_journal = 1').all() as { id: number }[]).map(j => j.id);
}

export function getSiteStory(slug: string) {
  return getSitePost(siteJournals(), slug);
}

/** A photo can be served publicly only if it belongs to a site journal. */
export function sitePhotoOwner(photoId: number): number | null {
  const row = db.prepare(`
    SELECT tkp.owner_id, j.user_id
    FROM journey_photos gp
    JOIN journeys j ON j.id = gp.journey_id AND j.site_journal = 1
    JOIN trek_photos tkp ON tkp.id = gp.photo_id
    WHERE gp.photo_id = ? LIMIT 1
  `).get(photoId) as { owner_id: number | null; user_id: number } | undefined;
  return row ? (row.owner_id || row.user_id) : null;
}

/** Only an admin marks a journey as the source of the public stories. */
export function setSiteJournal(journeyId: number, on: boolean): boolean {
  return db.prepare('UPDATE journeys SET site_journal = ? WHERE id = ?').run(on ? 1 : 0, journeyId).changes > 0;
}

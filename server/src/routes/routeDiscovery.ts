import express, { Request, Response } from 'express';
import { authenticate, adminOnly } from '../middleware/auth';
import { db } from '../db/database';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();
router.use(authenticate, adminOnly);

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const COUNTRY_BBOXES: Record<string, string> = {
  ES: '27.6,-18.2,43.9,4.5',
  PT: '30.0,-9.6,42.2,-6.2',
  FR: '42.3,-5.1,51.2,8.3',
};

// Server-side cache for fetched GPX points. Avoids sending large bodies from client→server.
// Keyed as "source:osmId" (e.g. "osm:12345", "wmt_cycling:67890"). Entries expire after 60 minutes.
type CacheEntry = { points: { lat: number; lng: number; ele?: number | null }[]; distanceKm: number; cachedAt: number };
const gpxCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000;

// Search result cache: avoids re-querying Overpass for the same filters on paginated requests.
// Keyed by JSON of { countries, networks, minDistanceKm }. Entries expire after 5 minutes.
type SearchCacheEntry = { routes: any[]; cachedAt: number };
const searchCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

function prunCache() {
  const now = Date.now();
  for (const [k, v] of gpxCache) if (now - v.cachedAt > CACHE_TTL) gpxCache.delete(k);
  for (const [k, v] of searchCache) if (now - v.cachedAt > SEARCH_CACHE_TTL) searchCache.delete(k);
}

// ── Waymarked Trails integration ──────────────────────────────────────────────

const WMT_SOURCES = [
  { sport: 'cycling', base: 'https://cycling.waymarkedtrails.org/api/v1' },
  { sport: 'hiking',  base: 'https://hiking.waymarkedtrails.org/api/v1' },
];

const WMT_GROUP_NET: Record<string, string> = {
  INT: 'icn', NAT: 'ncn', REG: 'rcn', LOC: 'lcn',
};

// Convert EPSG:3857 (Web Mercator) to WGS84
function mercatorToLatLng(x: number, y: number) {
  return {
    lat: Math.round(((Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90) * 1e7) / 1e7,
    lng: Math.round((x / 20037508.34 * 180) * 1e7) / 1e7,
  };
}

async function wmtSearch(query: string): Promise<any[]> {
  const results = await Promise.allSettled(
    WMT_SOURCES.map(async ({ sport, base }) => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch(`${base}/list/search?query=${encodeURIComponent(query)}&lang=es&limit=30`, {
          headers: { 'User-Agent': 'TrekWanderer/1.0' },
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data = await r.json();
        return (data.results || []).map((rt: any) => ({
          osmId: rt.id,
          name: rt.name || query,
          network: WMT_GROUP_NET[rt.group] || 'lcn',
          ref: rt.ref || null,
          distance: null,
          website: null,
          description: rt.itinerary?.length ? (rt.itinerary as string[]).join(' → ') : null,
          wikipedia: null, operator: null, colour: null, hasMinInfo: true,
          source: `wmt_${sport}`,
        }));
      } catch { return []; } finally { clearTimeout(tid); }
    })
  );

  const all = results
    .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicate by osmId (same relation might appear in cycling and hiking)
  const seen = new Set<number>();
  return all.filter(r => !seen.has(r.osmId) && seen.add(r.osmId));
}

// Parse trkpt elements from a GPX string
function parseGpxPoints(gpxText: string): { lat: number; lng: number; ele: number | null }[] {
  const re = /<trkpt\s+[^>]*?(lat="([^"]+)"[^>]*?lon="([^"]+)"|lon="([^"]+)"[^>]*?lat="([^"]+)")[^>]*>([\s\S]*?)<\/trkpt>/g;
  const points: { lat: number; lng: number; ele: number | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpxText)) !== null) {
    const lat = parseFloat(m[2] || m[5]);
    const lng = parseFloat(m[3] || m[4]);
    const eleM = m[6].match(/<ele>([\s\S]*?)<\/ele>/);
    if (!isNaN(lat) && !isNaN(lng)) {
      points.push({ lat, lng, ele: eleM ? Math.round(parseFloat(eleM[1]) * 10) / 10 : null });
    }
  }
  return points;
}

// fetchWmtPoints only handles the /gpx download path.
// If that fails (404, insufficient data), the caller falls through to the OSM Overpass path
// which uses node-based stitching + Open-Meteo elevation — more reliable than /way-elevation.
async function fetchWmtPoints(osmId: number, sport: string): Promise<{ lat: number; lng: number; ele: number | null }[]> {
  const base = sport === 'hiking'
    ? 'https://hiking.waymarkedtrails.org/api/v1'
    : 'https://cycling.waymarkedtrails.org/api/v1';

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`${base}/details/relation/${osmId}/gpx`, {
      headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/gpx+xml,text/xml,*/*' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`WMT GPX ${r.status}`);
    const gpxText = await r.text();
    const points = parseGpxPoints(gpxText);
    if (points.length < 10) throw new Error('WMT GPX insufficient data');
    const hasEle = points.some(p => p.ele != null);
    console.log(`[route-discovery wmt-gpx] osmId=${osmId} pts=${points.length} ele=${hasEle}`);
    return points;
  } finally { clearTimeout(tid); }
}

// ── Komoot integration ────────────────────────────────────────────────────────

function parseKomootUrl(input: string): { type: 'tour' | 'collection'; id: string } | null {
  const tourM = input.match(/komoot\.[a-z]+\/(?:tour|t)\/(\d+)/i);
  if (tourM) return { type: 'tour', id: tourM[1] };
  const collM = input.match(/komoot\.[a-z]+\/collection\/(\d+)/i);
  if (collM) return { type: 'collection', id: collM[1] };
  if (/^\d{8,13}$/.test(input.trim())) return { type: 'tour', id: input.trim() };
  return null;
}

function hashUrl(url: string): number {
  let h = 5381;
  for (let i = 0; i < url.length; i++) { h = (((h << 5) + h) + url.charCodeAt(i)) & 0x7fffffff; }
  return h || 1;
}

// Extract __NEXT_DATA__ JSON from a Komoot HTML page
function extractKomootPageData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function fetchKomootTourInfo(tourId: string): Promise<{ name: string; distanceKm: number; description: string | null }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://api.komoot.de/v007/tours/${tourId}`, {
      headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (r.ok) {
      const d = await r.json();
      return { name: d.name || `Komoot ${tourId}`, distanceKm: Math.round((d.distance || 0) / 100) / 10, description: d.summary || null };
    }
  } catch { /* fall through to page */ } finally { clearTimeout(tid); }

  const r2 = await fetch(`https://www.komoot.com/tour/${tourId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', Accept: 'text/html' },
  });
  if (!r2.ok) throw new Error(`Komoot tour ${tourId} not accessible (${r2.status})`);
  const json = extractKomootPageData(await r2.text());
  const tour = json?.props?.pageProps?.tour ?? json?.props?.pageProps?.serverProps?.page?.tour;
  if (!tour) throw new Error('Komoot: tour data not found in page');
  return { name: tour.name || `Komoot ${tourId}`, distanceKm: Math.round((tour.distance || 0) / 100) / 10, description: tour.summary || null };
}

async function fetchKomootPoints(tourId: string): Promise<{ lat: number; lng: number; ele: number | null }[]> {
  // Try API with coordinates embedded
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`https://api.komoot.de/v007/tours/${tourId}?_embedded=coordinates`, {
      headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (r.ok) {
      const d = await r.json();
      const items: any[] = d?._embedded?.coordinates?.items ?? [];
      if (items.length >= 10) return items.map((p: any) => ({ lat: p.lat, lng: p.lng, ele: p.alt ?? null }));
    }
  } catch { /* fall through */ } finally { clearTimeout(tid); }

  // Try GPX export endpoint
  const ctrl2 = new AbortController();
  const tid2 = setTimeout(() => ctrl2.abort(), 30000);
  try {
    const r = await fetch(`https://api.komoot.de/v007/tours/${tourId}/export.gpx`, {
      headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/gpx+xml' },
      signal: ctrl2.signal,
    });
    if (r.ok) {
      const pts = parseGpxPoints(await r.text());
      if (pts.length >= 10) return pts;
    }
  } catch { /* fall through */ } finally { clearTimeout(tid2); }

  // Page scraping: extract __NEXT_DATA__ coordinates
  const ctrl3 = new AbortController();
  const tid3 = setTimeout(() => ctrl3.abort(), 30000);
  try {
    const r = await fetch(`https://www.komoot.com/tour/${tourId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', Accept: 'text/html' },
      signal: ctrl3.signal,
    });
    if (r.ok) {
      const json = extractKomootPageData(await r.text());
      const tour = json?.props?.pageProps?.tour ?? json?.props?.pageProps?.serverProps?.page?.tour;
      const items: any[] = tour?._embedded?.coordinates?.items ?? [];
      if (items.length >= 10) return items.map((p: any) => ({ lat: p.lat, lng: p.lng, ele: p.alt ?? null }));
    }
  } catch { /* fall through */ } finally { clearTimeout(tid3); }

  throw new Error('No se pudo obtener la geometría de Komoot. El tour puede ser privado.');
}

async function fetchKomootCollection(collectionId: string): Promise<{ osmId: number; name: string; distanceKm: number | null }[]> {
  const tryExtractTours = (json: any): any[] | null => {
    const items =
      json?.props?.pageProps?.collection?._embedded?.tours?._embedded?.items ??
      json?.props?.pageProps?.tours?._embedded?.items ??
      json?.props?.pageProps?.serverProps?.page?.collection?._embedded?.tours?._embedded?.items;
    return Array.isArray(items) ? items : null;
  };

  // Try API
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://api.komoot.de/v007/collections/${collectionId}?_embedded=tours`, {
      headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (r.ok) {
      const d = await r.json();
      const items: any[] = d?._embedded?.tours?._embedded?.items ?? d?._embedded?.tours ?? [];
      if (items.length > 0) return items.map((t: any) => ({ osmId: Number(t.id), name: t.name || `Komoot ${t.id}`, distanceKm: t.distance ? Math.round(t.distance / 100) / 10 : null }));
    }
  } catch { /* fall through */ } finally { clearTimeout(tid); }

  // Page scraping
  const r2 = await fetch(`https://www.komoot.com/collection/${collectionId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', Accept: 'text/html' },
  });
  if (!r2.ok) throw new Error(`Komoot collection ${collectionId} no accesible (${r2.status})`);
  const json = extractKomootPageData(await r2.text());
  const items = json ? tryExtractTours(json) : null;
  if (!items || items.length === 0) throw new Error('Komoot: no se encontraron tours en la colección');
  return items.slice(0, 50).map((t: any) => ({ osmId: Number(t.id), name: t.name || `Komoot ${t.id}`, distanceKm: t.distance ? Math.round(t.distance / 100) / 10 : null }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fill null elevation values using Open-Meteo (free, no key, SRTM 90m global, 1000 pts/batch)
async function enrichMissingElevation(
  points: { lat: number; lng: number; ele: number | null }[],
): Promise<{ lat: number; lng: number; ele: number | null }[]> {
  const indices = points.map((p, i) => p.ele == null ? i : -1).filter(i => i >= 0);
  if (indices.length === 0) return points;
  const result = [...points];
  const BATCH = 1000;
  for (let b = 0; b < indices.length; b += BATCH) {
    const batch = indices.slice(b, b + BATCH);
    const lats = batch.map(i => points[i].lat).join(',');
    const lngs = batch.map(i => points[i].lng).join(',');
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 20000);
      let r: Response;
      try {
        r = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,
          { signal: ctrl.signal },
        );
      } finally { clearTimeout(tid); }
      if (!r.ok) { console.warn('[route-discovery elevation] open-meteo error', r.status); continue; }
      const data: any = await r.json();
      const elevs: number[] = data.elevation ?? [];
      for (let j = 0; j < batch.length && j < elevs.length; j++) {
        const ele = elevs[j];
        if (ele != null && !isNaN(ele)) {
          result[batch[j]] = { ...result[batch[j]], ele: Math.round(ele * 10) / 10 };
        }
      }
    } catch (err: any) { console.warn('[route-discovery elevation] batch failed:', err.message); }
  }
  return result;
}

function calcDistanceKm(points: { lat: number; lng: number }[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return Math.round(d * 10) / 10;
}

// Iterative Ramer-Douglas-Peucker simplification (avoids stack overflow on large routes)
function simplifyPoints(pts: { lat: number; lng: number }[], epsilon: number): { lat: number; lng: number }[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    if (e - s <= 1) continue;
    const p1 = pts[s], p2 = pts[e];
    const dx = p2.lng - p1.lng, dy = p2.lat - p1.lat;
    const mag = Math.sqrt(dx * dx + dy * dy);
    let maxD = 0, maxI = s;
    for (let i = s + 1; i < e; i++) {
      const d = mag === 0
        ? Math.sqrt((pts[i].lng - p1.lng) ** 2 + (pts[i].lat - p1.lat) ** 2)
        : Math.abs(dy * pts[i].lng - dx * pts[i].lat + p2.lng * p1.lat - p2.lat * p1.lng) / mag;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > epsilon) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Collect all way IDs from a relation, recursing into nested sub-relations (e.g. EuroVelo)
// elementMap must be keyed as "type:id" to avoid collisions between ways and relations
// (OSM numeric IDs overlap across element types — a way and a relation can share the same number)
function collectWayIds(relation: any, elementMap: Map<string, any>, visited = new Set<number>()): number[] {
  if (visited.has(relation.id)) return [];
  visited.add(relation.id);
  const ids: number[] = [];
  for (const m of (relation.members || [])) {
    if (m.type === 'way') ids.push(m.ref);
    else if (m.type === 'relation') {
      const sub = elementMap.get(`relation:${m.ref}`);
      if (sub) ids.push(...collectWayIds(sub, elementMap, visited));
    }
  }
  return ids;
}

// ── OSRM road-snap ────────────────────────────────────────────────────────────
// When a route only has sparse waypoints (e.g. one node per town), call OSRM
// cycling profile to calculate the actual road path between them.
// Chunks into segments of ≤80 waypoints to stay within URL limits.
const OSRM_CYCLING = 'https://router.project-osrm.org/route/v1/cycling';

async function snapToRoads(pts: { lat: number; lng: number }[]): Promise<{ lat: number; lng: number }[] | null> {
  if (pts.length < 2) return null;
  const CHUNK = 80;
  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < pts.length - 1; i += CHUNK - 1) {
    const chunk = pts.slice(i, i + CHUNK);
    if (chunk.length < 2) break;
    const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(';');
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(
        `${OSRM_CYCLING}/${coordStr}?overview=full&geometries=geojson`,
        { headers: { 'User-Agent': 'TrekWanderer/1.0' }, signal: ctrl.signal },
      );
      if (!r.ok) { console.warn(`[route-discovery osrm] ${r.status}`); return null; }
      const data = await r.json();
      if (data.code !== 'Ok') { console.warn('[route-discovery osrm] code:', data.code); return null; }
      const coords: [number, number][] = data.routes?.[0]?.geometry?.coordinates ?? [];
      if (coords.length < 2) return null;
      // Skip first point on subsequent chunks (already added as last point of prev chunk)
      const startIdx = out.length === 0 ? 0 : 1;
      for (let j = startIdx; j < coords.length; j++) out.push({ lat: coords[j][1], lng: coords[j][0] });
    } catch (e: any) {
      console.warn('[route-discovery osrm] failed:', e.message);
      return null;
    } finally {
      clearTimeout(tid);
    }
  }
  return out.length >= 10 ? out : null;
}

async function overpassQuery(query: string): Promise<any> {
  let lastError = '';
  for (const url of OVERPASS_MIRRORS) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 65000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TrekWanderer/1.0 (trip planner; admin route import)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (r.ok) return await r.json();
      lastError = `Overpass error ${r.status} from ${url}`;
      console.warn(`[route-discovery] ${lastError}`);
    } catch (e: any) {
      lastError = e.message;
      console.warn(`[route-discovery] ${url} failed: ${e.message}`);
    } finally {
      clearTimeout(tid);
    }
  }
  throw new Error(lastError || 'All Overpass mirrors failed');
}

function insertTrack(tripId: number, userId: number, trackName: string, points: { lat: number; lng: number; ele?: number | null }[]) {
  const pts = points.map(p => ({ lat: p.lat, lng: p.lng, ele: p.ele ?? null }));
  const stats = calcStats(pts);
  const sortRow = db.prepare('SELECT COUNT(*) as n FROM gpx_tracks WHERE trip_id = ?').get(tripId) as { n: number };
  db.prepare(`
    INSERT INTO gpx_tracks
      (trip_id, user_id, track_name, orig_name, total_distance, total_elevation_gain,
       total_elevation_loss, max_elevation, min_elevation, point_count,
       start_lat, start_lng, end_lat, end_lng, points_json, waypoints_json, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    tripId, userId,
    trackName, `${trackName}.gpx`,
    stats.totalDistance, stats.totalElevationGain, stats.totalElevationLoss,
    stats.maxElevation, stats.minElevation, pts.length,
    pts[0]?.lat, pts[0]?.lng,
    pts[pts.length - 1]?.lat, pts[pts.length - 1]?.lng,
    JSON.stringify(pts),
    '[]', sortRow.n,
  );
}

const PAGE_SIZE = 50;

// ── POST /api/admin/route-discovery/search ────────────────────────────────────
router.post('/search', async (req: Request, res: Response) => {
  const { countries = ['ES'], minDistanceKm = 150, networks = ['icn', 'ncn', 'rcn'], page = 1, query } = req.body;

  prunCache();

  // Text-search mode
  if (query && typeof query === 'string' && query.trim().length >= 2) {
    const q = query.trim();

    // ── Komoot URL / ID ────────────────────────────────────────────────────────
    const komoot = parseKomootUrl(q);
    if (komoot) {
      try {
        let routes: any[];
        if (komoot.type === 'collection') {
          const tours = await fetchKomootCollection(komoot.id);
          routes = tours.map(t => ({
            osmId: t.osmId, name: t.name, network: '', ref: null,
            distance: t.distanceKm, website: `https://www.komoot.com/tour/${t.osmId}`,
            description: null, wikipedia: null, operator: null, colour: null,
            hasMinInfo: true, source: 'komoot',
          }));
        } else {
          const info = await fetchKomootTourInfo(komoot.id);
          routes = [{
            osmId: Number(komoot.id), name: info.name, network: '', ref: null,
            distance: info.distanceKm, website: `https://www.komoot.com/tour/${komoot.id}`,
            description: info.description, wikipedia: null, operator: null, colour: null,
            hasMinInfo: true, source: 'komoot',
          }];
        }
        console.log(`[route-discovery search] komoot ${komoot.type}=${komoot.id} → ${routes.length} results`);
        return res.json({ routes, total: routes.length, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
      } catch (e: any) {
        console.error('[route-discovery search komoot]', e.message);
        return res.status(502).json({ error: e.message });
      }
    }

    // ── Direct GPX URL ─────────────────────────────────────────────────────────
    if (/^https?:\/\//i.test(q)) {
      const urlName = (() => { try { return new URL(q).pathname.split('/').filter(Boolean).pop()?.replace(/\.gpx$/i, '').replace(/[-_+]/g, ' ').trim() || 'Ruta GPX'; } catch { return 'Ruta GPX'; } })();
      return res.json({
        routes: [{
          osmId: hashUrl(q), name: urlName, network: '', ref: null,
          distance: null, website: q, description: null,
          wikipedia: null, operator: null, colour: null, hasMinInfo: true, source: 'url',
        }],
        total: 1, page: 1, pageSize: PAGE_SIZE, totalPages: 1,
      });
    }

    // ── Waymarked Trails text search ───────────────────────────────────────────
    try {
      const allRoutes = await wmtSearch(q);
      const pageNum = Math.max(1, Number(page));
      const start = (pageNum - 1) * PAGE_SIZE;
      console.log(`[route-discovery search] wmt query="${q}" → ${allRoutes.length} results`);
      return res.json({
        routes: allRoutes.slice(start, start + PAGE_SIZE),
        total: allRoutes.length,
        page: pageNum,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(allRoutes.length / PAGE_SIZE) || 1,
      });
    } catch (e: any) {
      console.error('[route-discovery search wmt]', e.message);
      return res.status(502).json({ error: e.message });
    }
  }

  // Browse mode: existing OSM Overpass query
  const validCountries = (countries as string[]).filter(c => c in COUNTRY_BBOXES);
  if (validCountries.length === 0) return res.status(400).json({ error: 'Invalid countries' });

  const sortedCountries = [...validCountries].sort();
  const sortedNetworks = [...(networks as string[])].sort();
  const cacheKey = JSON.stringify({ countries: sortedCountries, networks: sortedNetworks, minDistanceKm });

  let allRoutes: any[];
  const cached = searchCache.get(cacheKey);
  if (cached) {
    allRoutes = cached.routes;
    console.log(`[route-discovery search] cache hit, ${allRoutes.length} routes`);
  } else {
    const networkRegex = sortedNetworks.join('|');
    const unionLines = sortedCountries.map(c =>
      `  relation["route"="bicycle"]["network"~"^(${networkRegex})$"](${COUNTRY_BBOXES[c]});`
    );

    const query = `[out:json][timeout:120];
(
${unionLines.join('\n')}
);
out tags;`;

    try {
      const data = await overpassQuery(query);
      const elements: any[] = data.elements || [];

      allRoutes = elements
        .filter(e => e.tags?.name)
        .map(e => {
          const tags = e.tags || {};
          const distTag = tags.distance ? parseFloat(tags.distance) : null;
          return {
            osmId: e.id,
            name: tags.name,
            network: tags.network || '',
            ref: tags.ref || null,
            distance: distTag,
            website: tags.website || tags.url || null,
            description: tags.description || tags['description:es'] || tags['description:en'] || null,
            wikidata: tags.wikidata || null,
            operator: tags.operator || null,
            wikipedia: tags.wikipedia || null,
            colour: tags.colour || null,
            hasMinInfo: !!(tags.name && (distTag == null || distTag >= minDistanceKm)),
            source: 'osm',
          };
        })
        .filter(r => r.distance == null || r.distance >= minDistanceKm)
        // Sort longest first; routes with unknown distance go last
        .sort((a, b) => {
          if (a.distance == null && b.distance == null) return 0;
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
          return b.distance - a.distance;
        });

      searchCache.set(cacheKey, { routes: allRoutes, cachedAt: Date.now() });
      console.log(`[route-discovery search] fetched ${allRoutes.length} routes from Overpass, cached`);
    } catch (e: any) {
      console.error('[route-discovery search]', e.message);
      return res.status(502).json({ error: e.message });
    }
  }

  const pageNum = Math.max(1, Number(page));
  const start = (pageNum - 1) * PAGE_SIZE;
  const routes = allRoutes.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(allRoutes.length / PAGE_SIZE);

  res.json({ routes, total: allRoutes.length, page: pageNum, pageSize: PAGE_SIZE, totalPages });
});

// ── POST /api/admin/route-discovery/fetch-gpx ─────────────────────────────────
// Fetches full geometry for a single OSM relation and caches it server-side.
// The import endpoint reads from this cache — the client never sends points back.
router.post('/fetch-gpx', async (req: Request, res: Response) => {
  const { osmId, source = 'osm' } = req.body;
  if (!osmId) return res.status(400).json({ error: 'osmId required' });

  prunCache();
  const cacheKey = `${source}:${osmId}`;

  const alreadyCached = gpxCache.get(cacheKey);
  if (alreadyCached) {
    return res.json({ points: alreadyCached.points, distanceKm: alreadyCached.distanceKm, pointCount: alreadyCached.points.length });
  }

  // ── Waymarked Trails source ────────────────────────────────────────────────
  if (typeof source === 'string' && source.startsWith('wmt_')) {
    const sport = source.slice(4);
    try {
      const rawPoints = await fetchWmtPoints(Number(osmId), sport);
      const rawDistKm = calcDistanceKm(rawPoints);
      // Require ≥2 pts/km — WMT sometimes returns only waypoint nodes (1 per town),
      // giving straight lines when rendered. Fall through to Overpass for denser geometry.
      if (rawPoints.length < Math.max(10, rawDistKm * 2)) {
        throw new Error(`WMT GPX too sparse (${rawPoints.length} pts for ${rawDistKm.toFixed(0)} km) — falling back to Overpass`);
      }
      const points = await enrichMissingElevation(rawPoints);
      const distanceKm = calcDistanceKm(points);
      gpxCache.set(cacheKey, { points, distanceKm, cachedAt: Date.now() });
      const hasEle = points.some(p => p.ele != null);
      console.log(`[route-discovery fetch-gpx] wmt_${sport} osmId=${osmId} pts=${points.length} dist=${distanceKm}km ele=${hasEle}`);
      return res.json({ points, distanceKm, pointCount: points.length, hasElevation: hasEle });
    } catch (wmtErr: any) {
      console.warn(`[route-discovery fetch-gpx] WMT failed (${wmtErr.message}), falling back to Overpass`);
      // Fall through to Overpass below
    }
  }

  // ── Komoot source ─────────────────────────────────────────────────────────
  if (source === 'komoot') {
    try {
      const rawPoints = await fetchKomootPoints(String(osmId));
      const points = await enrichMissingElevation(rawPoints);
      const distanceKm = calcDistanceKm(points);
      gpxCache.set(cacheKey, { points, distanceKm, cachedAt: Date.now() });
      const hasEle = points.some(p => p.ele != null);
      console.log(`[route-discovery fetch-gpx] komoot id=${osmId} pts=${points.length} dist=${distanceKm}km ele=${hasEle}`);
      return res.json({ points, distanceKm, pointCount: points.length, hasElevation: hasEle });
    } catch (e: any) {
      console.error('[route-discovery fetch-gpx komoot]', e.message);
      return res.status(502).json({ error: e.message });
    }
  }

  // ── Direct GPX URL source ─────────────────────────────────────────────────
  if (source === 'url') {
    const gpxUrl = req.body.gpxUrl as string;
    if (!gpxUrl) return res.status(400).json({ error: 'gpxUrl required for source=url' });
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30000);
      let r: Response;
      try {
        r = await fetch(gpxUrl, { headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/gpx+xml,text/xml,*/*' }, signal: ctrl.signal });
      } finally { clearTimeout(tid); }
      if (!r.ok) return res.status(502).json({ error: `URL fetch failed: ${r.status}` });
      const rawPoints = parseGpxPoints(await r.text());
      if (rawPoints.length < 10) return res.status(422).json({ error: 'GPX insuficiente o inaccesible desde URL' });
      const points = await enrichMissingElevation(rawPoints);
      const distanceKm = calcDistanceKm(points);
      gpxCache.set(cacheKey, { points, distanceKm, cachedAt: Date.now() });
      const hasEle = points.some(p => p.ele != null);
      console.log(`[route-discovery fetch-gpx] url pts=${points.length} dist=${distanceKm}km`);
      return res.json({ points, distanceKm, pointCount: points.length, hasElevation: hasEle });
    } catch (e: any) {
      console.error('[route-discovery fetch-gpx url]', e.message);
      return res.status(502).json({ error: e.message });
    }
  }

  // ── OSM Overpass source (default + WMT fallback) ──────────────────────────
  const osmCacheKey = source.startsWith('wmt_') ? `osm:${osmId}` : cacheKey;

  const overpassQry = `[out:json][timeout:55];
relation(${osmId});
(._; >>;);
out body qt;`;

  try {
    const data = await overpassQuery(overpassQry);
    const elements: any[] = data.elements || [];

    const nodeMap = new Map<number, { lat: number; lng: number }>();
    // Key: "type:id" — prevents way IDs from overwriting relation IDs when they share the same number
    const elementMap = new Map<string, any>();
    for (const e of elements) {
      elementMap.set(`${e.type}:${e.id}`, e);
      if (e.type === 'node') nodeMap.set(e.id, { lat: e.lat, lng: e.lon });
    }

    const topRelation = elements.find(e => e.type === 'relation' && e.id === Number(osmId));
    if (!topRelation) return res.status(404).json({ error: 'Relation not found' });

    const wayIds = collectWayIds(topRelation, elementMap);

    // Store way details with endpoint node IDs for accurate stitching
    const wayDetails = new Map<number, { firstNode: number; lastNode: number; pts: { lat: number; lng: number }[] }>();
    for (const e of elements) {
      if (e.type === 'way' && (e.nodes?.length ?? 0) >= 2) {
        const pts = (e.nodes as number[])
          .map((nid: number) => nodeMap.get(nid))
          .filter(Boolean) as { lat: number; lng: number }[];
        if (pts.length > 0) {
          wayDetails.set(e.id, { firstNode: e.nodes[0], lastNode: e.nodes[e.nodes.length - 1], pts });
        }
      }
    }

    // Stitch ways using shared endpoint nodes — avoids duplicate points and wrong orientations.
    // Falls back to distance-based orientation only when two consecutive ways don't share a node.
    const raw: { lat: number; lng: number }[] = [];
    let lastNodeId: number | null = null;
    for (const wid of wayIds) {
      const w = wayDetails.get(wid);
      if (!w || w.pts.length === 0) continue;
      if (raw.length === 0) {
        raw.push(...w.pts);
        lastNodeId = w.lastNode;
      } else if (w.firstNode === lastNodeId) {
        raw.push(...w.pts.slice(1));       // forward — skip shared endpoint
        lastNodeId = w.lastNode;
      } else if (w.lastNode === lastNodeId) {
        raw.push(...[...w.pts].reverse().slice(1));  // reverse — skip shared endpoint
        lastNodeId = w.firstNode;
      } else {
        // No shared node: fall back to distance-based orientation
        const last = raw[raw.length - 1];
        const d1 = haversineKm(last.lat, last.lng, w.pts[0].lat, w.pts[0].lng);
        const d2 = haversineKm(last.lat, last.lng, w.pts[w.pts.length - 1].lat, w.pts[w.pts.length - 1].lng);
        if (d2 < d1) {
          raw.push(...[...w.pts].reverse());
          lastNodeId = w.firstNode;
        } else {
          raw.push(...w.pts);
          lastNodeId = w.lastNode;
        }
      }
    }

    if (raw.length < 10) return res.status(422).json({ error: 'Insufficient geometry' });

    const rawDistanceKm = calcDistanceKm(raw);
    const rawDensity = raw.length / rawDistanceKm; // pts per km

    // If Overpass only returned sparse waypoints (< 2 pts/km), snap them to the actual
    // road network via OSRM so the track follows real roads instead of straight lines.
    let workingPts = raw;
    if (rawDensity < 2 && raw.length <= 500) {
      console.log(`[route-discovery fetch-gpx] sparse geometry (${raw.length} pts, ${rawDensity.toFixed(2)} pts/km) — trying OSRM snap`);
      const snapped = await snapToRoads(raw);
      if (snapped) {
        console.log(`[route-discovery fetch-gpx] OSRM snap: ${raw.length} → ${snapped.length} pts`);
        workingPts = snapped;
      } else {
        console.warn('[route-discovery fetch-gpx] OSRM snap failed, keeping sparse Overpass geometry');
      }
    }

    // Only simplify extreme tracks (>30 000pts) to avoid losing elevation data
    const simplified = workingPts.length > 30000
      ? simplifyPoints(workingPts, Math.max(0.00005, rawDistanceKm / (20000 * 111)))
      : workingPts;
    const points = await enrichMissingElevation(
      simplified.map(p => ({ ...p, ele: (p as any).ele ?? null }))
    );
    const distanceKm = calcDistanceKm(points);

    // Cache under both the requested key and the osm: key (for WMT fallback path)
    gpxCache.set(cacheKey, { points, distanceKm, cachedAt: Date.now() });
    if (osmCacheKey !== cacheKey) gpxCache.set(osmCacheKey, { points, distanceKm, cachedAt: Date.now() });

    console.log(`[route-discovery fetch-gpx] osmId=${osmId} raw=${raw.length}pts final=${points.length}pts dist=${distanceKm}km`);
    res.json({ points, distanceKm, pointCount: points.length, rawPointCount: raw.length });
  } catch (e: any) {
    console.error('[route-discovery fetch-gpx]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── POST /api/admin/route-discovery/import ────────────────────────────────────
// Creates ONE trip with ONE track per route segment (grouped by caller).
// Body: { groupName, routes: RouteInfo[], tripType }
// Points come from the server-side cache populated by fetch-gpx — no large body.
router.post('/import', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { groupName, routes, tripType = 'cycling' } = req.body;

  if (!groupName || !Array.isArray(routes) || routes.length === 0) {
    return res.status(400).json({ error: 'groupName and routes[] required' });
  }

  // Resolve all segments from cache
  const segments: { route: any; cached: CacheEntry }[] = [];
  for (const route of routes) {
    const src = route.source || 'osm';
    const cacheKey = `${src}:${route.osmId}`;
    const cached = gpxCache.get(cacheKey);
    if (!cached) {
      return res.status(400).json({
        error: `GPX not loaded for "${route.name}" (OSM ${route.osmId}) — click "Cargar GPX" first`,
      });
    }
    segments.push({ route, cached });
  }

  const totalDist = Math.round(segments.reduce((s, seg) => s + seg.cached.distanceKm, 0) * 10) / 10;
  const osmIds = routes.map((r: any) => r.osmId).join(', ');
  const firstRoute = routes[0];
  const sourceLabel = (firstRoute.source || 'osm').startsWith('wmt') ? 'Waymarked Trails' : 'OpenStreetMap';

  const description = [
    routes.map((r: any) => r.description).filter(Boolean).join('\n\n'),
    firstRoute.website ? `\nMás información: ${firstRoute.website}` : '',
    firstRoute.ref ? `\nReferencia: ${firstRoute.ref}` : '',
    `\n\nDistancia total estimada: ${totalDist} km`,
    `\nFuente: ${sourceLabel} (IDs: ${osmIds})`,
  ].join('').trim();

  try {
    const tripResult = db.prepare(`
      INSERT INTO trips (user_id, title, description, trip_type, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'EUR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(authReq.user.id, groupName, description, tripType);

    const tripId = Number(tripResult.lastInsertRowid);

    for (const { route, cached } of segments) {
      insertTrack(tripId, authReq.user.id, route.name, cached.points);
    }

    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    res.status(201).json({ trip, tripId, trackCount: segments.length });
  } catch (e: any) {
    console.error('[route-discovery import]', e.message);
    res.status(500).json({ error: e.message });
  }
});

function calcStats(points: { lat: number; lng: number; ele: number | null }[]) {
  let totalDistance = 0, totalElevationGain = 0, totalElevationLoss = 0;
  let maxElevation = -Infinity, minElevation = Infinity;
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    const e1 = points[i - 1].ele ?? 0, e2 = points[i].ele ?? 0;
    const diff = e2 - e1;
    if (diff > 0) totalElevationGain += diff; else totalElevationLoss += Math.abs(diff);
    if (e2 > maxElevation) maxElevation = e2;
    if (e2 < minElevation) minElevation = e2;
  }
  return {
    totalDistance: Math.round(totalDistance * 100) / 100,
    totalElevationGain: Math.round(totalElevationGain),
    totalElevationLoss: Math.round(totalElevationLoss),
    maxElevation: maxElevation === -Infinity ? null : Math.round(maxElevation),
    minElevation: minElevation === Infinity ? null : Math.round(minElevation),
  };
}

export default router;

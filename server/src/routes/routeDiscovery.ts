import express, { Request, Response } from 'express';
import { authenticate, adminOnly } from '../middleware/auth';
import { db } from '../db/database';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();
router.use(authenticate, adminOnly);

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const COUNTRY_BBOXES: Record<string, string> = {
  ES: '27.6,-18.2,43.9,4.5',
  PT: '30.0,-9.6,42.2,-6.2',
  FR: '42.3,-5.1,51.2,8.3',
};

// Server-side cache for fetched GPX points. Avoids sending large bodies from client→server.
// Keyed by osmId. Entries expire after 60 minutes.
type CacheEntry = { points: { lat: number; lng: number }[]; distanceKm: number; cachedAt: number };
const gpxCache = new Map<number, CacheEntry>();
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
function collectWayIds(relation: any, elementMap: Map<number, any>, visited = new Set<number>()): number[] {
  if (visited.has(relation.id)) return [];
  visited.add(relation.id);
  const ids: number[] = [];
  for (const m of (relation.members || [])) {
    if (m.type === 'way') ids.push(m.ref);
    else if (m.type === 'relation') {
      const sub = elementMap.get(m.ref);
      if (sub) ids.push(...collectWayIds(sub, elementMap, visited));
    }
  }
  return ids;
}

async function overpassQuery(query: string): Promise<any> {
  let lastError = '';
  for (const url of OVERPASS_MIRRORS) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 330000);
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

function insertTrack(tripId: number, userId: number, trackName: string, points: { lat: number; lng: number }[]) {
  const pts = points.map(p => ({ lat: p.lat, lng: p.lng, ele: null as null }));
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
  const { countries = ['ES'], minDistanceKm = 150, networks = ['icn', 'ncn', 'rcn'], page = 1 } = req.body;

  const validCountries = (countries as string[]).filter(c => c in COUNTRY_BBOXES);
  if (validCountries.length === 0) return res.status(400).json({ error: 'Invalid countries' });

  prunCache();

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
  const { osmId } = req.body;
  if (!osmId) return res.status(400).json({ error: 'osmId required' });

  prunCache();

  const query = `[out:json][timeout:300];
relation(${osmId});
(._; >>;);
out body qt;`;

  try {
    const data = await overpassQuery(query);
    const elements: any[] = data.elements || [];

    const nodeMap = new Map<number, { lat: number; lng: number }>();
    const elementMap = new Map<number, any>();
    for (const e of elements) {
      elementMap.set(e.id, e);
      if (e.type === 'node') nodeMap.set(e.id, { lat: e.lat, lng: e.lon });
    }

    const topRelation = elements.find(e => e.type === 'relation' && e.id === Number(osmId));
    if (!topRelation) return res.status(404).json({ error: 'Relation not found' });

    const wayIds = collectWayIds(topRelation, elementMap);

    const wayMap = new Map<number, { lat: number; lng: number }[]>();
    for (const e of elements) {
      if (e.type === 'way') {
        const pts = (e.nodes || [])
          .map((nid: number) => nodeMap.get(nid))
          .filter(Boolean) as { lat: number; lng: number }[];
        wayMap.set(e.id, pts);
      }
    }

    const raw: { lat: number; lng: number }[] = [];
    for (const wid of wayIds) {
      const seg = wayMap.get(wid);
      if (!seg || seg.length === 0) continue;
      if (raw.length === 0) {
        raw.push(...seg);
      } else {
        const last = raw[raw.length - 1];
        const firstDist = haversineKm(last.lat, last.lng, seg[0].lat, seg[0].lng);
        const lastDist = haversineKm(last.lat, last.lng, seg[seg.length - 1].lat, seg[seg.length - 1].lng);
        raw.push(...(lastDist < firstDist ? [...seg].reverse() : seg));
      }
    }

    if (raw.length < 10) return res.status(422).json({ error: 'Insufficient geometry' });

    const rawDistanceKm = calcDistanceKm(raw);
    const epsilon = Math.max(0.0001, rawDistanceKm / (5000 * 111));
    const points = raw.length > 5000 ? simplifyPoints(raw, epsilon) : raw;
    const distanceKm = calcDistanceKm(points);

    // Cache server-side so import doesn't need a large request body
    gpxCache.set(Number(osmId), { points, distanceKm, cachedAt: Date.now() });

    console.log(`[route-discovery fetch-gpx] osmId=${osmId} raw=${raw.length}pts simplified=${points.length}pts dist=${distanceKm}km`);
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
    const cached = gpxCache.get(Number(route.osmId));
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

  const description = [
    routes.map((r: any) => r.description).filter(Boolean).join('\n\n'),
    firstRoute.website ? `\nMás información: ${firstRoute.website}` : '',
    firstRoute.ref ? `\nReferencia: ${firstRoute.ref}` : '',
    `\n\nDistancia total estimada: ${totalDist} km`,
    `\nFuente: OpenStreetMap (IDs: ${osmIds})`,
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

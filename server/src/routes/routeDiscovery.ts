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

async function fetchWmtPoints(osmId: number, sport: string): Promise<{ lat: number; lng: number; ele: number | null }[]> {
  const base = sport === 'hiking'
    ? 'https://hiking.waymarkedtrails.org/api/v1'
    : 'https://cycling.waymarkedtrails.org/api/v1';

  // Try direct GPX download first — segments are pre-ordered by WMT, avoids stitching errors
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(`${base}/details/relation/${osmId}/gpx`, {
        headers: { 'User-Agent': 'TrekWanderer/1.0', Accept: 'application/gpx+xml,text/xml,*/*' },
        signal: ctrl.signal,
      });
      if (r.ok) {
        const gpxText = await r.text();
        const points = parseGpxPoints(gpxText);
        if (points.length >= 10) {
          const hasEle = points.some(p => p.ele != null);
          console.log(`[route-discovery wmt-gpx] osmId=${osmId} pts=${points.length} ele=${hasEle}`);
          return points;
        }
      }
    } finally { clearTimeout(tid); }
  } catch (gpxErr: any) {
    console.warn(`[route-discovery wmt-gpx] GPX download failed: ${gpxErr.message}`);
  }

  // Fall back to /way-elevation with greedy-nearest-neighbour stitching
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch(`${base}/details/relation/${osmId}/way-elevation`, {
      headers: { 'User-Agent': 'TrekWanderer/1.0' },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`WMT way-elevation ${r.status}`);
    const data = await r.json();

    const rawSegs: { lat: number; lng: number; ele: number | null }[][] = Object.values(data.segments || {})
      .map((seg: any) =>
        (seg.elevation || []).map((p: any) => ({
          ...mercatorToLatLng(p.x, p.y),
          ele: typeof p.ele === 'number' ? Math.round(p.ele * 10) / 10 : null,
        }))
      )
      .filter((s: any[]) => s.length > 0);

    if (rawSegs.length === 0) throw new Error('No WMT elevation data');
    if (rawSegs.length === 1) return rawSegs[0];

    const chain: { lat: number; lng: number; ele: number | null }[] = [...rawSegs.shift()!];
    const remaining = [...rawSegs];
    while (remaining.length > 0) {
      const last = chain[chain.length - 1];
      let bi = 0, bDist = Infinity, bRev = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const d1 = haversineKm(last.lat, last.lng, seg[0].lat, seg[0].lng);
        const d2 = haversineKm(last.lat, last.lng, seg[seg.length - 1].lat, seg[seg.length - 1].lng);
        if (d1 < bDist) { bDist = d1; bi = i; bRev = false; }
        if (d2 < bDist) { bDist = d2; bi = i; bRev = true; }
      }
      const next = remaining.splice(bi, 1)[0];
      chain.push(...(bRev ? [...next].reverse() : next));
    }
    return chain;
  } finally { clearTimeout(tid); }
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

  // Text-search mode: query Waymarked Trails (cycling + hiking)
  if (query && typeof query === 'string' && query.trim().length >= 2) {
    try {
      const allRoutes = await wmtSearch(query.trim());
      const pageNum = Math.max(1, Number(page));
      const start = (pageNum - 1) * PAGE_SIZE;
      console.log(`[route-discovery search] wmt query="${query.trim()}" → ${allRoutes.length} results`);
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
      const points = await fetchWmtPoints(Number(osmId), sport);
      if (points.length < 10) return res.status(422).json({ error: 'Insufficient WMT geometry' });
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

  // ── OSM Overpass source (default + WMT fallback) ──────────────────────────
  const osmCacheKey = source.startsWith('wmt_') ? `osm:${osmId}` : cacheKey;

  const overpassQry = `[out:json][timeout:300];
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
    // Only simplify extreme tracks (>30 000pts) to avoid losing elevation data
    const points = raw.length > 30000
      ? simplifyPoints(raw, Math.max(0.00005, rawDistanceKm / (20000 * 111)))
      : raw;
    const distanceKm = calcDistanceKm(points);

    // Cache under both the requested key and the osm: key (for WMT fallback path)
    gpxCache.set(cacheKey, { points, distanceKm, cachedAt: Date.now() });
    if (osmCacheKey !== cacheKey) gpxCache.set(osmCacheKey, { points, distanceKm, cachedAt: Date.now() });

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

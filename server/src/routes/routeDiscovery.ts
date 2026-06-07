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
    const tid = setTimeout(() => controller.abort(), 330000); // 5.5 min — covers 300s Overpass timeout
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

// ── POST /api/admin/route-discovery/search ────────────────────────────────────
// Searches OSM for cycling routes matching filters. Returns metadata only (fast).
router.post('/search', async (req: Request, res: Response) => {
  const { countries = ['ES'], minDistanceKm = 150, networks = ['icn', 'ncn', 'rcn'] } = req.body;

  const validCountries = (countries as string[]).filter(c => c in COUNTRY_BBOXES);
  if (validCountries.length === 0) return res.status(400).json({ error: 'Invalid countries' });

  const networkRegex = (networks as string[]).join('|');
  const unionLines = validCountries.map(c =>
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

    const routes = elements
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
      .filter(r => r.distance == null || r.distance >= minDistanceKm);

    res.json({ routes, total: routes.length });
  } catch (e: any) {
    console.error('[route-discovery search]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── POST /api/admin/route-discovery/fetch-gpx ─────────────────────────────────
// Fetches full geometry for a single OSM relation. Slow — call on demand.
// Handles nested sub-relations (EuroVelo-style) and simplifies large routes.
router.post('/fetch-gpx', async (req: Request, res: Response) => {
  const { osmId } = req.body;
  if (!osmId) return res.status(400).json({ error: 'osmId required' });

  // ">>" deep-recurses into nested sub-relations (needed for EuroVelo etc.)
  const query = `[out:json][timeout:300];
relation(${osmId});
(._; >>;);
out body qt;`;

  try {
    const data = await overpassQuery(query);
    const elements: any[] = data.elements || [];

    // Build lookup maps
    const nodeMap = new Map<number, { lat: number; lng: number }>();
    const elementMap = new Map<number, any>();
    for (const e of elements) {
      elementMap.set(e.id, e);
      if (e.type === 'node') nodeMap.set(e.id, { lat: e.lat, lng: e.lon });
    }

    const topRelation = elements.find(e => e.type === 'relation' && e.id === Number(osmId));
    if (!topRelation) return res.status(404).json({ error: 'Relation not found' });

    // Collect way IDs recursing into nested sub-relations
    const wayIds = collectWayIds(topRelation, elementMap);

    // Build way segments
    const wayMap = new Map<number, { lat: number; lng: number }[]>();
    for (const e of elements) {
      if (e.type === 'way') {
        const pts = (e.nodes || [])
          .map((nid: number) => nodeMap.get(nid))
          .filter(Boolean) as { lat: number; lng: number }[];
        wayMap.set(e.id, pts);
      }
    }

    // Chain ways into a continuous track
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

    // Adaptive D-P simplification: target ≤ 5000 points regardless of route length
    const epsilon = Math.max(0.0001, rawDistanceKm / (5000 * 111));
    const points = raw.length > 5000 ? simplifyPoints(raw, epsilon) : raw;
    const distanceKm = calcDistanceKm(points);

    console.log(`[route-discovery fetch-gpx] osmId=${osmId} raw=${raw.length}pts simplified=${points.length}pts dist=${distanceKm}km`);
    res.json({ points, distanceKm, pointCount: points.length, rawPointCount: raw.length });
  } catch (e: any) {
    console.error('[route-discovery fetch-gpx]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── POST /api/admin/route-discovery/import ────────────────────────────────────
// Creates a Trip + uploads the GPX from provided points.
router.post('/import', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { route, points, tripType = 'cycling' } = req.body;

  if (!route?.name || !points || points.length < 10) {
    return res.status(400).json({ error: 'Missing route name or insufficient points' });
  }

  try {
    // Build GPX XML from points
    const ptLines = (points as { lat: number; lng: number; ele?: number }[]).map(p =>
      `    <trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>`
    );
    const gpxXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <trk><name>${route.name.replace(/[<>&"]/g, '')}</name><trkseg>`,
      ...ptLines,
      '  </trkseg></trk>',
      '</gpx>',
    ].join('\n');

    // Calculate distance
    let distKm = 0;
    for (let i = 1; i < points.length; i++) {
      distKm += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    distKm = Math.round(distKm * 10) / 10;

    const description = [
      route.description || '',
      route.website ? `\n\nMás información: ${route.website}` : '',
      route.ref ? `\n\nReferencia: ${route.ref}` : '',
      `\n\nDistancia estimada: ${distKm} km`,
      `\nFuente: OpenStreetMap (ID: ${route.osmId})`,
    ].join('').trim();

    // Create the trip
    const tripResult = db.prepare(`
      INSERT INTO trips (user_id, title, description, trip_type, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'EUR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(authReq.user.id, route.name, description, tripType);

    const tripId = Number(tripResult.lastInsertRowid);

    // Save GPX track directly from provided points
    const pts = points as { lat: number; lng: number; ele?: number | null }[];
    const stats = calcStats(pts.map(p => ({ ...p, ele: p.ele ?? null })));
    const sortRow = db.prepare('SELECT COUNT(*) as n FROM gpx_tracks WHERE trip_id = ?').get(tripId) as { n: number };
    const trackResult = db.prepare(`
      INSERT INTO gpx_tracks
        (trip_id, user_id, track_name, orig_name, total_distance, total_elevation_gain,
         total_elevation_loss, max_elevation, min_elevation, point_count,
         start_lat, start_lng, end_lat, end_lng, points_json, waypoints_json, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      tripId, authReq.user.id,
      route.name, `${route.name}.gpx`,
      stats.totalDistance, stats.totalElevationGain, stats.totalElevationLoss,
      stats.maxElevation, stats.minElevation, pts.length,
      pts[0]?.lat, pts[0]?.lng,
      pts[pts.length - 1]?.lat, pts[pts.length - 1]?.lng,
      JSON.stringify(pts.map(p => ({ lat: p.lat, lng: p.lng, ele: p.ele ?? null }))),
      '[]', sortRow.n,
    );
    const trackId = Number(trackResult.lastInsertRowid);

    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    res.status(201).json({ trip, tripId });
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

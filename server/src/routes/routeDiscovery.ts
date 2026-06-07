import express, { Request, Response } from 'express';
import { authenticate, adminOnly } from '../middleware/auth';
import { getDb } from '../db';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();
router.use(authenticate, adminOnly);

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const COUNTRY_AREAS: Record<string, string> = {
  ES: '"ISO3166-1"="ES"',
  PT: '"ISO3166-1"="PT"',
  FR: '"ISO3166-1"="FR"',
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

async function overpassQuery(query: string): Promise<any> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Overpass error ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(tid);
  }
}

// ── POST /api/admin/route-discovery/search ────────────────────────────────────
// Searches OSM for cycling routes matching filters. Returns metadata only (fast).
router.post('/search', async (req: Request, res: Response) => {
  const { countries = ['ES'], minDistanceKm = 150, networks = ['icn', 'ncn', 'rcn'] } = req.body;

  const validCountries = (countries as string[]).filter(c => c in COUNTRY_AREAS);
  if (validCountries.length === 0) return res.status(400).json({ error: 'Invalid countries' });

  const networkFilter = networks.map((n: string) => `["network"="${n}"]`).join('');

  // Build union of queries per country
  const parts = validCountries.map(c => {
    const area = COUNTRY_AREAS[c];
    return `area[${area}]->.a${c};\n  relation["route"="bicycle"]${networkFilter}(area.a${c});`;
  });

  const query = `
[out:json][timeout:60];
${parts.join('\n')}
(${validCountries.map(c => `relation["route"="bicycle"]${networkFilter}(area.a${c});`).join('\n  ')});
out tags;
  `.trim();

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
router.post('/fetch-gpx', async (req: Request, res: Response) => {
  const { osmId } = req.body;
  if (!osmId) return res.status(400).json({ error: 'osmId required' });

  const query = `
[out:json][timeout:120];
relation(${osmId});
(._; >;);
out body qt;
  `.trim();

  try {
    const data = await overpassQuery(query);
    const elements: any[] = data.elements || [];

    // Build node map
    const nodeMap = new Map<number, { lat: number; lng: number }>();
    for (const e of elements) {
      if (e.type === 'node') nodeMap.set(e.id, { lat: e.lat, lng: e.lon });
    }

    // Get ordered way IDs from relation
    const relation = elements.find(e => e.type === 'relation');
    if (!relation) return res.status(404).json({ error: 'Relation not found' });

    const wayIds = (relation.members || [])
      .filter((m: any) => m.type === 'way')
      .map((m: any) => m.ref as number);

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
    const points: { lat: number; lng: number }[] = [];
    for (const wid of wayIds) {
      const seg = wayMap.get(wid);
      if (!seg || seg.length === 0) continue;
      if (points.length === 0) {
        points.push(...seg);
      } else {
        const last = points[points.length - 1];
        const first = seg[0];
        const firstDist = haversineKm(last.lat, last.lng, first.lat, first.lng);
        const lastNode = seg[seg.length - 1];
        const lastDist = haversineKm(last.lat, last.lng, lastNode.lat, lastNode.lng);
        if (lastDist < firstDist) {
          points.push(...[...seg].reverse());
        } else {
          points.push(...seg);
        }
      }
    }

    if (points.length < 10) return res.status(422).json({ error: 'Insufficient geometry' });

    const distanceKm = calcDistanceKm(points);
    res.json({ points, distanceKm, pointCount: points.length });
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

  const db = getDb();

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

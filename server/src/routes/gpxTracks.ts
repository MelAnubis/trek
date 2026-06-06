/**
 * gpxTracks.ts — Gestión de tracks GPX por viaje en Trek
 *
 * Rutas:
 *   GET    /api/trips/:id/gpx                          → lista tracks del viaje
 *   GET    /api/trips/:id/gpx/:trackId/points          → puntos del track
 *   POST   /api/trips/:id/gpx/upload                   → sube un fichero GPX
 *   POST   /api/trips/:id/gpx/:trackId/recalculate     → recalcula stats del track
 *   PATCH  /api/trips/:id/gpx/:trackId                 → renombra / activa / asigna día
 *   DELETE /api/trips/:id/gpx/:trackId                 → elimina track
 *   POST   /api/trips/:id/gpx/:trackId/split-by-days   → divide GPX en etapas por día
 */
import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth';
import { requireTripAccess } from '../middleware/tripAccess';
import { db } from '../db/database';
import type { AuthRequest } from '../types';

const router = express.Router({ mergeParams: true });

// ── GPX upload directory ──────────────────────────────────────────────────────
const gpxDir = path.join(__dirname, '../../uploads/gpx');
if (!fs.existsSync(gpxDir)) fs.mkdirSync(gpxDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, gpxDir),
  filename:    (_req, _file, cb) => cb(null, crypto.randomUUID() + '.gpx'),
});

const uploadGpx = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /gpx|xml/i.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.gpx');
    if (!ok) {
      const err: Error & { statusCode?: number } = new Error('Solo se aceptan ficheros GPX');
      err.statusCode = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// ── Haversine distance in meters ──────────────────────────────────────────────
function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 +
            Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Elevation smoothing (simple moving average, window = 7 points) ────────────
// Reduces GPS vertical noise before computing gain/loss.
function smoothElevation(
  pts: { ele: number | null }[],
  window = 7,
): (number | null)[] {
  const half = Math.floor(window / 2);
  return pts.map((_, i) => {
    const start = Math.max(0, i - half);
    const end   = Math.min(pts.length - 1, i + half);
    const vals  = [];
    for (let j = start; j <= end; j++) {
      if (pts[j].ele != null) vals.push(pts[j].ele as number);
    }
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
}

// ── Elevation stats from a sequence of points (segment-aware) ────────────────
//
// Fixes vs original implementation:
//  1. Threshold-hysteresis: lastSmoothedEle only updates when the threshold
//     IS crossed — this prevents noise from resetting the baseline on every
//     point and causing tiny fluctuations to be counted.
//  2. Elevation smoothed with a 7-point moving average before computing gain/loss.
//  3. Threshold raised from 2 m to 5 m to better match typical GPS vertical
//     accuracy (3–5 m RMS).
//
function computeElevationStats(
  pts: { ele: number | null }[],
): { gain: number; loss: number; max: number | null; min: number | null } {
  const ELE_THRESHOLD = 5; // metres — raised from 2 m to reduce GPS noise
  const smoothed = smoothElevation(pts);

  let gain = 0, loss = 0;
  let maxEle: number | null = null;
  let minEle: number | null = null;
  let ref: number | null = null; // reference elevation (only moves when threshold crossed)

  for (const ele of smoothed) {
    if (ele == null) continue;
    if (maxEle === null || ele > maxEle) maxEle = ele;
    if (minEle === null || ele < minEle) minEle = ele;

    if (ref === null) {
      ref = ele;
      continue;
    }

    const diff = ele - ref;
    if (diff > ELE_THRESHOLD) {
      gain += diff;
      ref = ele; // ← only update reference when threshold exceeded
    } else if (diff < -ELE_THRESHOLD) {
      loss += Math.abs(diff);
      ref = ele; // ← only update reference when threshold exceeded
    }
    // If |diff| ≤ threshold: DON'T update ref — noise is filtered out
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    max:  maxEle != null ? Math.round(maxEle) : null,
    min:  minEle != null ? Math.round(minEle) : null,
  };
}

// ── Minimal GPX parser (segment-aware) ───────────────────────────────────────
//
// Fixes vs original implementation:
//  1. Parses <trkseg> boundaries — distance and elevation are NOT computed
//     across segment gaps (GPS dropouts, tunnels, etc.).
//  2. Handles both lat-before-lon and lon-before-lat attribute order.
//  3. Falls back to treating all <trkpt> as one segment if no <trkseg> found.
//
function parseGpxBuffer(raw: string): {
  trackName: string;
  points: { lat: number; lng: number; ele: number | null; time: string | null }[];
  waypoints: { lat: number; lng: number; name: string }[];
  totalDistance: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  maxElevation: number | null;
  minElevation: number | null;
  durationSeconds: number | null;
} {
  const nameMatch = raw.match(/<name>([\s\S]*?)<\/name>/);
  const trackName = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : 'Track';

  // Parse a block of GPX text into trkpt objects
  function parseTrkpts(block: string) {
    // Handle lat/lon in either order
    const re = /<trkpt\s+[^>]*?(lat="([^"]+)"[^>]*?lon="([^"]+)"|lon="([^"]+)"[^>]*?lat="([^"]+)")[^>]*>([\s\S]*?)<\/trkpt>/g;
    const pts: { lat: number; lng: number; ele: number | null; time: string | null }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const lat = parseFloat(m[2] || m[5]);
      const lng = parseFloat(m[3] || m[4]);
      const inner = m[6];
      const eleM  = inner.match(/<ele>([\s\S]*?)<\/ele>/);
      const timeM = inner.match(/<time>([\s\S]*?)<\/time>/);
      if (!isNaN(lat) && !isNaN(lng)) {
        pts.push({
          lat, lng,
          ele:  eleM  ? parseFloat(eleM[1])  : null,
          time: timeM ? timeM[1].trim()       : null,
        });
      }
    }
    return pts;
  }

  // Try to split by <trkseg> first
  const segRe = /<trkseg[^>]*>([\s\S]*?)<\/trkseg>/g;
  const segments: ReturnType<typeof parseTrkpts>[] = [];
  let segM: RegExpExecArray | null;
  while ((segM = segRe.exec(raw)) !== null) {
    const pts = parseTrkpts(segM[1]);
    if (pts.length > 0) segments.push(pts);
  }

  // Fallback: no <trkseg> found — treat whole file as one segment
  if (segments.length === 0) {
    const pts = parseTrkpts(raw);
    if (pts.length > 0) segments.push(pts);
  }

  // Flatten all points (for storage) and compute stats per segment
  const allPoints = segments.flat();

  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  let maxElevation: number | null = null;
  let minElevation: number | null = null;

  for (const seg of segments) {
    // Distance: sum haversine within segment (NOT across segment boundaries)
    for (let i = 1; i < seg.length; i++) {
      totalDistance += haversineM(seg[i-1].lat, seg[i-1].lng, seg[i].lat, seg[i].lng);
    }

    // Elevation: smoothed + hysteresis threshold
    const eleStats = computeElevationStats(seg);
    totalElevationGain += eleStats.gain;
    totalElevationLoss += eleStats.loss;
    if (eleStats.max != null && (maxElevation === null || eleStats.max > maxElevation)) maxElevation = eleStats.max;
    if (eleStats.min != null && (minElevation === null || eleStats.min < minElevation)) minElevation = eleStats.min;
  }

  // Waypoints
  const wptRe = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/g;
  const waypoints: { lat: number; lng: number; name: string }[] = [];
  let wm: RegExpExecArray | null;
  while ((wm = wptRe.exec(raw)) !== null) {
    const lat = parseFloat(wm[1]);
    const lng = parseFloat(wm[2]);
    const wNameM = wm[3].match(/<name>([\s\S]*?)<\/name>/);
    if (!isNaN(lat) && !isNaN(lng)) {
      waypoints.push({ lat, lng, name: wNameM ? wNameM[1].trim() : 'Waypoint' });
    }
  }

  // Duration from timestamps
  let durationSeconds: number | null = null;
  const firstTime = allPoints[0]?.time;
  const lastTime  = allPoints[allPoints.length - 1]?.time;
  if (firstTime && lastTime) {
    const diff = (new Date(lastTime).getTime() - new Date(firstTime).getTime()) / 1000;
    if (diff > 0) durationSeconds = Math.round(diff);
  }

  return {
    trackName,
    points: allPoints,
    waypoints,
    totalDistance:      totalDistance / 1000,
    totalElevationGain: totalElevationGain,
    totalElevationLoss: totalElevationLoss,
    maxElevation,
    minElevation,
    durationSeconds,
  };
}

// ── Find nearest point index in GPX ──────────────────────────────────────────
function nearestPointIdx(
  points: { lat: number; lng: number }[],
  lat: number,
  lng: number,
  startFrom = 0
): number {
  let best = startFrom;
  let bestDist = Infinity;
  for (let i = startFrom; i < points.length; i++) {
    const d = haversineM(points[i].lat, points[i].lng, lat, lng);
    if (d < bestDist) { bestDist = d; best = i; }
    if (d < 50 && i > startFrom + 10) break;
  }
  return best;
}

// ── Compute stats for a slice of points (used by split-by-days) ──────────────
function computeStats(points: { lat: number; lng: number; ele: number | null }[]) {
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineM(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
  }
  const eleStats = computeElevationStats(points);
  return {
    totalDistance:      totalDistance / 1000,
    totalElevationGain: eleStats.gain,
    totalElevationLoss: eleStats.loss,
    maxElevation:       eleStats.max,
    minElevation:       eleStats.min,
  };
}

// ── Save track to DB ──────────────────────────────────────────────────────────
function saveTrack(
  tripId: string | number,
  userId: number,
  trackName: string,
  origName: string | null,
  points: { lat: number; lng: number; ele: number | null; time?: string | null }[],
  waypoints: { lat: number; lng: number; name: string }[],
  sortOrder: number,
  dayId?: number | null
): number {
  const stats = computeStats(points);
  const result = db.prepare(`
    INSERT INTO gpx_tracks
      (trip_id, user_id, track_name, orig_name,
       total_distance, total_elevation_gain, total_elevation_loss,
       max_elevation, min_elevation, point_count,
       start_lat, start_lng, end_lat, end_lng,
       points_json, waypoints_json, sort_order, day_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    tripId, userId, trackName, origName,
    stats.totalDistance, stats.totalElevationGain, stats.totalElevationLoss,
    stats.maxElevation, stats.minElevation, points.length,
    points[0]?.lat, points[0]?.lng,
    points[points.length - 1]?.lat, points[points.length - 1]?.lng,
    JSON.stringify(points), JSON.stringify(waypoints),
    sortOrder, dayId ?? null,
  );
  return Number(result.lastInsertRowid);
}

// ── GET /api/trips/:id/gpx ────────────────────────────────────────────────────
router.get('/', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId = (req as AuthRequest).params.id;
  try {
    const tracks = db.prepare(
      `SELECT id, trip_id, track_name, orig_name, total_distance, total_elevation_gain,
              total_elevation_loss, max_elevation, min_elevation, duration_seconds,
              point_count, start_lat, start_lng, end_lat, end_lng,
              ibp, sort_order, is_active, day_id, created_at
       FROM gpx_tracks WHERE trip_id = ? ORDER BY sort_order ASC, id ASC`
    ).all(tripId) as any[];
    res.json(tracks);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/trips/:id/gpx/:trackId/points ────────────────────────────────────
router.get('/:trackId/points', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;
  try {
    const track = db.prepare(
      'SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?'
    ).get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });
    res.json({
      ...track,
      points:    JSON.parse(track.points_json    || '[]'),
      waypoints: JSON.parse(track.waypoints_json || '[]'),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/trips/:id/gpx/upload ───────────────────────────────────────────
router.post('/upload', authenticate, requireTripAccess, uploadGpx.single('gpx'), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const tripId  = authReq.params.id;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const parsed = parseGpxBuffer(raw);

    if (parsed.points.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'GPX file has no track points' });
    }

    const sortRow = db.prepare('SELECT COUNT(*) as n FROM gpx_tracks WHERE trip_id = ?').get(tripId) as { n: number };
    const dayId = req.body.day_id ? parseInt(req.body.day_id) : null;

    const newId = saveTrack(
      tripId, authReq.user.id,
      parsed.trackName, req.file.originalname,
      parsed.points, parsed.waypoints || [],
      sortRow.n, dayId
    );

    // Intentar obtener IBP via API si hay clave configurada
    if (process.env.IBP_API_KEY) {
      try {
        const trip = db.prepare('SELECT trip_type FROM trips WHERE id = ?').get(tripId) as { trip_type: string } | undefined;
        const isTrekking = trip?.trip_type === 'trekking';
        const fetch = (await import('node-fetch')).default;
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('key', process.env.IBP_API_KEY);
        form.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        const r = await (fetch as any)('https://www.ibpindex.com/api/', {
          method: 'POST', body: form, headers: (form as any).getHeaders(), timeout: 30000,
        });
        const data = await (r as any).json();
        // Cycling → IBP para bicicleta; Trekking → IBP para senderismo (HKG)
        const ibp = isTrekking ? (data?.hkg?.ibp ?? data?.hiking?.ibp) : data?.bicycle?.ibp;
        if (ibp != null) {
          db.prepare('UPDATE gpx_tracks SET ibp = ? WHERE id = ?').run(Math.round(ibp), newId);
        }
      } catch (ibpErr: any) {
        console.warn('[gpx] IBP API error:', ibpErr.message);
      }
    }

    const track = db.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(newId) as any;
    res.status(201).json({
      ...track,
      points:    JSON.parse(track.points_json    || '[]'),
      waypoints: JSON.parse(track.waypoints_json || '[]'),
    });
  } catch (e: any) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[gpx upload]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/trips/:id/gpx/:trackId/recalculate ──────────────────────────────
// Recalculates distance + elevation stats from stored points without
// re-uploading the file. Use this after a bug-fix to update existing tracks.
router.post('/:trackId/recalculate', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;
  try {
    const track = db.prepare(
      'SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?'
    ).get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const points: { lat: number; lng: number; ele: number | null }[] =
      JSON.parse(track.points_json || '[]');
    if (points.length < 2) {
      return res.status(400).json({ error: 'Track has insufficient points' });
    }

    const stats = computeStats(points);
    db.prepare(`
      UPDATE gpx_tracks
      SET total_distance = ?, total_elevation_gain = ?, total_elevation_loss = ?,
          max_elevation = ?, min_elevation = ?
      WHERE id = ?
    `).run(
      stats.totalDistance, stats.totalElevationGain, stats.totalElevationLoss,
      stats.maxElevation, stats.minElevation,
      trackId
    );

    const updated = db.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(trackId) as any;
    res.json({ ...updated, points: [], waypoints: [] });
  } catch (e: any) {
    console.error('[gpx recalculate]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/trips/:id/gpx/:trackId/split-by-days ───────────────────────────
// Divide un GPX largo en etapas usando los lugares de inicio/fin de cada día
router.post('/:trackId/split-by-days', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const tripId  = authReq.params.id;
  const trackId = req.params.trackId;

  try {
    const track = db.prepare(
      'SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?'
    ).get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const allPoints: { lat: number; lng: number; ele: number | null; time: string | null }[] =
      JSON.parse(track.points_json || '[]');
    if (allPoints.length < 2) {
      return res.status(400).json({ error: 'Track has insufficient points' });
    }

    const days = db.prepare(
      `SELECT d.id, d.date, d.title, d.day_number
       FROM days d WHERE d.trip_id = ? ORDER BY d.date ASC, d.day_number ASC`
    ).all(tripId) as any[];

    if (days.length === 0) {
      return res.status(400).json({ error: 'No days found for this trip' });
    }

    const dayBounds: {
      dayId: number;
      title: string;
      startLat: number; startLng: number;
      endLat: number; endLng: number;
    }[] = [];

    for (const day of days) {
      const places = db.prepare(
        `SELECT p.lat, p.lng, p.name, a.order_index
         FROM day_assignments a
         JOIN places p ON p.id = a.place_id
         WHERE a.day_id = ? AND p.lat IS NOT NULL AND p.lng IS NOT NULL
         ORDER BY a.order_index ASC`
      ).all(day.id) as any[];

      if (places.length >= 1) {
        const last = places[places.length - 1];
        dayBounds.push({
          dayId:    day.id,
          title:    day.title || `Día ${day.day_number || day.id}`,
          startLat: last.lat, startLng: last.lng,
          endLat:   last.lat, endLng:   last.lng,
        });
      }
    }

    for (let i = 1; i < dayBounds.length; i++) {
      dayBounds[i].startLat = dayBounds[i - 1].endLat;
      dayBounds[i].startLng = dayBounds[i - 1].endLng;
    }
    if (dayBounds.length > 0) {
      dayBounds[0].startLat = allPoints[0].lat;
      dayBounds[0].startLng = allPoints[0].lng;
    }
    if (dayBounds.length === 0) {
      return res.status(400).json({ error: 'No days have places with coordinates' });
    }

    const created: any[] = [];
    let searchFrom = 0;

    db.prepare(
      'DELETE FROM gpx_tracks WHERE trip_id = ? AND day_id IS NOT NULL'
    ).run(tripId);

    for (let i = 0; i < dayBounds.length; i++) {
      const day = dayBounds[i];

      const startIdx = nearestPointIdx(allPoints, day.startLat, day.startLng, searchFrom);

      let endIdx: number;
      if (i === dayBounds.length - 1) {
        endIdx = allPoints.length - 1;
      } else {
        endIdx = nearestPointIdx(allPoints, day.endLat, day.endLng, startIdx);
        const nextDay = dayBounds[i + 1];
        const nextStartIdx = nearestPointIdx(allPoints, nextDay.startLat, nextDay.startLng, startIdx);
        const distEnd  = haversineM(allPoints[endIdx].lat, allPoints[endIdx].lng, day.endLat, day.endLng);
        const distNext = haversineM(allPoints[nextStartIdx].lat, allPoints[nextStartIdx].lng, day.endLat, day.endLng);
        endIdx = distEnd <= distNext ? endIdx : nextStartIdx;
      }

      if (endIdx <= startIdx) endIdx = Math.min(startIdx + 1, allPoints.length - 1);

      const slice = allPoints.slice(startIdx, endIdx + 1);
      if (slice.length < 2) continue;

      const newId = saveTrack(
        tripId, authReq.user.id,
        day.title, null,
        slice, [],
        i, day.dayId
      );

      searchFrom = endIdx;

      const saved = db.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(newId) as any;
      created.push({ ...saved, points: slice });
    }

    res.json({
      success: true,
      message: `GPX dividido en ${created.length} etapas`,
      tracks: created.map(t => ({ ...t, points: undefined, points_json: undefined, waypoints_json: undefined })),
    });
  } catch (e: any) {
    console.error('[gpx split]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/trips/:id/gpx/:trackId/split-manual ────────────────────────────
// Divide el GPX usando cortes manuales: array de { pointIndex, dayId }
// Convención: el dayId de un corte en X se asigna al segmento que LLEGA a X (antes del corte).
router.post('/:trackId/split-manual', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const tripId  = authReq.params.id;
  const trackId = req.params.trackId;

  try {
    const track = db.prepare(
      'SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?'
    ).get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const allPoints: { lat: number; lng: number; ele: number | null; time: string | null }[] =
      JSON.parse(track.points_json || '[]');
    if (allPoints.length < 2) {
      return res.status(400).json({ error: 'Track has insufficient points' });
    }

    const cuts: { pointIndex: number; dayId: number | null }[] = req.body.cuts || [];
    if (!Array.isArray(cuts)) {
      return res.status(400).json({ error: 'cuts must be an array' });
    }

    // Validate & sort cuts
    const sorted = [...cuts]
      .map(c => ({ pointIndex: Math.max(0, Math.min(Math.round(c.pointIndex), allPoints.length - 1)), dayId: c.dayId ?? null }))
      .sort((a, b) => a.pointIndex - b.pointIndex);

    // Build boundaries from cut positions
    const cutPoints = sorted.filter(c => c.pointIndex > 0 && c.pointIndex < allPoints.length - 1);
    const boundaries: number[] = [0, ...cutPoints.map(c => c.pointIndex), allPoints.length - 1];

    // Delete existing day-linked tracks for this trip
    db.prepare('DELETE FROM gpx_tracks WHERE trip_id = ? AND day_id IS NOT NULL').run(tripId);

    const created: any[] = [];

    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i];
      const to   = boundaries[i + 1];
      const slice = allPoints.slice(from, to + 1);
      if (slice.length < 2) continue;

      // dayId del corte que TERMINA este segmento (en boundaries[i+1])
      const cut = cutPoints.find(c => c.pointIndex === boundaries[i + 1]);
      // Si no hay corte al final (último segmento), no tiene día asignado por defecto
      const dayId = cut?.dayId ?? null;

      // Name: use day title if linked to a day
      let name = `Etapa ${i + 1}`;
      if (dayId) {
        const day = db.prepare('SELECT title, day_number FROM days WHERE id = ?').get(dayId) as any;
        if (day) name = day.title || `Día ${day.day_number || dayId}`;
      }

      const newId = saveTrack(tripId, authReq.user.id, name, null, slice, [], i, dayId);
      const saved = db.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(newId) as any;
      created.push({ ...saved, points_json: undefined, waypoints_json: undefined });
    }

    res.json({
      success: true,
      message: `GPX dividido en ${created.length} etapas`,
      tracks: created,
    });
  } catch (e: any) {
    console.error('[gpx split-manual]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/trips/:id/gpx/:trackId ─────────────────────────────────────────
router.patch('/:trackId', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;
  const { track_name, is_active, day_id } = req.body;
  try {
    const track = db.prepare('SELECT id FROM gpx_tracks WHERE id = ? AND trip_id = ?').get(trackId, tripId);
    if (!track) return res.status(404).json({ error: 'Track not found' });

    if (track_name !== undefined)
      db.prepare('UPDATE gpx_tracks SET track_name = ? WHERE id = ?').run(String(track_name).trim(), trackId);
    if (is_active !== undefined)
      db.prepare('UPDATE gpx_tracks SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, trackId);
    if (day_id !== undefined)
      db.prepare('UPDATE gpx_tracks SET day_id = ? WHERE id = ?').run(day_id === null ? null : Number(day_id), trackId);

    const updated = db.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(trackId) as any;
    res.json({ ...updated, points: [], waypoints: [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/trips/:id/gpx/:trackId ────────────────────────────────────────
router.delete('/:trackId', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;
  try {
    const track = db.prepare(
      'SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?'
    ).get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    if (track.orig_name) {
      const fp = path.join(gpxDir, track.orig_name);
      if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch { /* ignorar */ } }
    }

    db.prepare('DELETE FROM gpx_tracks WHERE id = ?').run(trackId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

// ── Nav photo upload directory ────────────────────────────────────────────────
const navPhotoDir = path.join(__dirname, '../../uploads/nav-photos');
if (!fs.existsSync(navPhotoDir)) fs.mkdirSync(navPhotoDir, { recursive: true });

const navPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, navPhotoDir),
  filename:    (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}.jpg`),
});

const uploadNavPhoto = multer({
  storage: navPhotoStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se aceptan imágenes'));
    }
    cb(null, true);
  },
});

// ── POST /api/trips/:id/gpx/nav-photos ───────────────────────────────────────
// Upload a geotagged photo taken during live navigation.
// Body (multipart): photo (file), lat, lng, altitude?, taken_at?, caption?
router.post('/nav-photos', authenticate, requireTripAccess, uploadNavPhoto.single('photo'), (req: Request, res: Response) => {
  const tripId = Number((req as AuthRequest).params.id);
  const userId = (req as AuthRequest).user!.userId;
  const file   = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No photo uploaded' });

  const lat      = parseFloat(req.body.lat);
  const lng      = parseFloat(req.body.lng);
  const altitude = req.body.altitude ? parseFloat(req.body.altitude) : null;
  const takenAt  = req.body.taken_at ?? new Date().toISOString();
  const caption  = req.body.caption ?? null;

  if (isNaN(lat) || isNaN(lng)) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'lat/lng requeridos' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO nav_photos (trip_id, user_id, filename, original_name, file_size, mime_type, lat, lng, altitude, taken_at, caption)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tripId, userId, file.filename, file.originalname, file.size, file.mimetype, lat, lng, altitude, takenAt, caption);

    res.json({
      id: result.lastInsertRowid,
      trip_id: tripId,
      filename: file.filename,
      lat, lng, altitude,
      taken_at: takenAt,
      caption,
      url: `/uploads/nav-photos/${file.filename}`,
    });
  } catch (e: any) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/trips/:id/gpx/nav-photos ────────────────────────────────────────
router.get('/nav-photos', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId = Number((req as AuthRequest).params.id);
  try {
    const photos = db.prepare(`
      SELECT id, filename, original_name, lat, lng, altitude, taken_at, caption,
             '/uploads/nav-photos/' || filename AS url
      FROM nav_photos
      WHERE trip_id = ?
      ORDER BY taken_at ASC
    `).all(tripId);
    res.json(photos);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/trips/:id/gpx/nav-photos/:photoId ────────────────────────────
router.delete('/nav-photos/:photoId', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId  = Number((req as AuthRequest).params.id);
  const photoId = Number(req.params.photoId);
  try {
    const photo = db.prepare('SELECT * FROM nav_photos WHERE id = ? AND trip_id = ?').get(photoId, tripId) as any;
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const fp = path.join(navPhotoDir, photo.filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch { /* ignore */ }
    db.prepare('DELETE FROM nav_photos WHERE id = ?').run(photoId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

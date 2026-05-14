/**
 * gpxTracks.ts — Gestión de tracks GPX por viaje en Trek
 *
 * Rutas:
 *   GET    /api/trips/:id/gpx                        → lista tracks del viaje
 *   GET    /api/trips/:id/gpx/:trackId/points        → puntos del track
 *   POST   /api/trips/:id/gpx/upload                 → sube un fichero GPX
 *   PATCH  /api/trips/:id/gpx/:trackId               → renombra / activa / asigna día
 *   DELETE /api/trips/:id/gpx/:trackId               → elimina track
 *   POST   /api/trips/:id/gpx/:trackId/split-by-days → divide GPX en etapas por día
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

// ── Minimal GPX parser ────────────────────────────────────────────────────────
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

  const trkptRe = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  const points: { lat: number; lng: number; ele: number | null; time: string | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(raw)) !== null) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    const inner = m[3];
    const eleM = inner.match(/<ele>([\s\S]*?)<\/ele>/);
    const timeM = inner.match(/<time>([\s\S]*?)<\/time>/);
    if (!isNaN(lat) && !isNaN(lng)) {
      points.push({ lat, lng, ele: eleM ? parseFloat(eleM[1]) : null, time: timeM ? timeM[1].trim() : null });
    }
  }

  const wptRe = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/g;
  const waypoints: { lat: number; lng: number; name: string }[] = [];
  while ((m = wptRe.exec(raw)) !== null) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    const wNameM = m[3].match(/<name>([\s\S]*?)<\/name>/);
    if (!isNaN(lat) && !isNaN(lng)) {
      waypoints.push({ lat, lng, name: wNameM ? wNameM[1].trim() : 'Waypoint' });
    }
  }

  function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
    const R = 6371000;
    const dLa = (la2 - la1) * Math.PI / 180;
    const dLo = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 +
              Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  let maxElevation: number | null = null;
  let minElevation: number | null = null;
  const ELE_THRESHOLD = 2;
  let lastSmoothedEle: number | null = null;

  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineM(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
    const ele = points[i].ele;
    if (ele != null) {
      if (maxElevation === null || ele > maxElevation) maxElevation = ele;
      if (minElevation === null || ele < minElevation) minElevation = ele;
      if (lastSmoothedEle !== null) {
        const diff = ele - lastSmoothedEle;
        if (diff > ELE_THRESHOLD) totalElevationGain += diff;
        else if (diff < -ELE_THRESHOLD) totalElevationLoss += Math.abs(diff);
      }
      lastSmoothedEle = ele;
    }
  }

  let durationSeconds: number | null = null;
  const first = points[0]?.time;
  const last = points[points.length - 1]?.time;
  if (first && last) {
    const diff = (new Date(last).getTime() - new Date(first).getTime()) / 1000;
    if (diff > 0) durationSeconds = Math.round(diff);
  }

  return {
    trackName, points, waypoints,
    totalDistance: totalDistance / 1000,
    totalElevationGain: Math.round(totalElevationGain),
    totalElevationLoss: Math.round(totalElevationLoss),
    maxElevation: maxElevation ? Math.round(maxElevation) : null,
    minElevation: minElevation ? Math.round(minElevation) : null,
    durationSeconds,
  };
}

// ── Haversine distance in meters ──────────────────────────────────────────────
function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 +
            Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    // Stop searching if we're getting farther after finding a close point
    if (d < 50 && i > startFrom + 10) break;
  }
  return best;
}

// ── Compute stats for a slice of points ──────────────────────────────────────
function computeStats(points: { lat: number; lng: number; ele: number | null }[]) {
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  let maxElevation: number | null = null;
  let minElevation: number | null = null;
  const ELE_THRESHOLD = 2;
  let lastEle: number | null = null;

  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineM(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
    const ele = points[i].ele;
    if (ele != null) {
      if (maxElevation === null || ele > maxElevation) maxElevation = ele;
      if (minElevation === null || ele < minElevation) minElevation = ele;
      if (lastEle !== null) {
        const diff = ele - lastEle;
        if (diff > ELE_THRESHOLD) totalElevationGain += diff;
        else if (diff < -ELE_THRESHOLD) totalElevationLoss += Math.abs(diff);
      }
      lastEle = ele;
    }
  }
  return {
    totalDistance: totalDistance / 1000,
    totalElevationGain: Math.round(totalElevationGain),
    totalElevationLoss: Math.round(totalElevationLoss),
    maxElevation: maxElevation ? Math.round(maxElevation) : null,
    minElevation: minElevation ? Math.round(minElevation) : null,
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
        const fetch = (await import('node-fetch')).default;
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('key', process.env.IBP_API_KEY);
        form.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        const r = await (fetch as any)('https://www.ibpindex.com/api/', {
          method: 'POST', body: form, headers: (form as any).getHeaders(), timeout: 30000,
        });
        const data = await (r as any).json();
        const ibp = data?.bicycle?.ibp;
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

// ── POST /api/trips/:id/gpx/:trackId/split-by-days ───────────────────────────
// Divide un GPX largo en etapas usando los lugares de inicio/fin de cada día
router.post('/:trackId/split-by-days', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const tripId  = authReq.params.id;
  const trackId = req.params.trackId;

  try {
    // Cargar el track completo
    const track = db.prepare(
      'SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?'
    ).get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const allPoints: { lat: number; lng: number; ele: number | null; time: string | null }[] =
      JSON.parse(track.points_json || '[]');
    if (allPoints.length < 2) {
      return res.status(400).json({ error: 'Track has insufficient points' });
    }

    // Cargar días del viaje con sus lugares ordenados
    const days = db.prepare(
      `SELECT d.id, d.date, d.title, d.day_number
       FROM days d WHERE d.trip_id = ? ORDER BY d.date ASC, d.day_number ASC`
    ).all(tripId) as any[];

    if (days.length === 0) {
      return res.status(400).json({ error: 'No days found for this trip' });
    }

    // Para cada día, obtener el primer y último lugar con coordenadas
    const dayBounds: {
      dayId: number;
      title: string;
      startLat: number; startLng: number;
      endLat: number; endLng: number;
    }[] = [];

    for (const day of days) {
      const places = db.prepare(
        `SELECT p.lat, p.lng, p.name, a.order_index
         FROM assignments a
         JOIN places p ON p.id = a.place_id
         WHERE a.day_id = ? AND p.lat IS NOT NULL AND p.lng IS NOT NULL
         ORDER BY a.order_index ASC`
      ).all(day.id) as any[];

      if (places.length >= 1) {
        const first = places[0];
        const last  = places[places.length - 1];
        dayBounds.push({
          dayId:    day.id,
          title:    day.title || `Día ${day.day_number || day.id}`,
          startLat: first.lat, startLng: first.lng,
          endLat:   last.lat,  endLng:   last.lng,
        });
      }
    }

    if (dayBounds.length === 0) {
      return res.status(400).json({ error: 'No days have places with coordinates' });
    }

    // Dividir el GPX en etapas
    const created: any[] = [];
    let searchFrom = 0;

    // Borrar tracks con day_id existentes para este viaje (re-split limpio)
    db.prepare(
      'DELETE FROM gpx_tracks WHERE trip_id = ? AND day_id IS NOT NULL'
    ).run(tripId);

    for (let i = 0; i < dayBounds.length; i++) {
      const day = dayBounds[i];

      // Encontrar punto más cercano al inicio del día
      const startIdx = nearestPointIdx(allPoints, day.startLat, day.startLng, searchFrom);

      // Encontrar punto más cercano al fin del día (buscar desde startIdx)
      let endIdx: number;
      if (i === dayBounds.length - 1) {
        // Último día — usar el último punto del GPX
        endIdx = allPoints.length - 1;
      } else {
        endIdx = nearestPointIdx(allPoints, day.endLat, day.endLng, startIdx);
        // Si el siguiente día empieza donde este termina, el endIdx es el startIdx del siguiente
        const nextDay = dayBounds[i + 1];
        const nextStartIdx = nearestPointIdx(allPoints, nextDay.startLat, nextDay.startLng, startIdx);
        // Usar el más cercano al final del día actual
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

/**
 * gpxTracks.ts — Gestión de tracks GPX por viaje en Trek
 *
 * Rutas:
 *   GET    /api/trips/:id/gpx              → lista tracks del viaje
 *   POST   /api/trips/:id/gpx/upload       → sube un fichero GPX
 *   PATCH  /api/trips/:id/gpx/:trackId     → renombra / activa-desactiva
 *   DELETE /api/trips/:id/gpx/:trackId     → elimina track
 *   POST   /api/trips/:id/gpx/recalc       → recalcula elevación con DEM
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

// ── Minimal GPX parser (no external deps) ────────────────────────────────────
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
  // Track name
  const nameMatch = raw.match(/<name>([\s\S]*?)<\/name>/);
  const trackName = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : 'Track';

  // Track points
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
      points.push({
        lat, lng,
        ele:  eleM  ? parseFloat(eleM[1])  : null,
        time: timeM ? timeM[1].trim()       : null,
      });
    }
  }

  // Waypoints
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

  // Stats
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
    totalDistance += haversineM(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat,     points[i].lng,
    );
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

  // Duration
  let durationSeconds: number | null = null;
  const first = points[0]?.time;
  const last  = points[points.length - 1]?.time;
  if (first && last) {
    const diff = (new Date(last).getTime() - new Date(first).getTime()) / 1000;
    if (diff > 0) durationSeconds = Math.round(diff);
  }

  return {
    trackName,
    points,
    waypoints,
    totalDistance: totalDistance / 1000,   // km
    totalElevationGain: Math.round(totalElevationGain),
    totalElevationLoss: Math.round(totalElevationLoss),
    maxElevation: maxElevation ? Math.round(maxElevation) : null,
    minElevation: minElevation ? Math.round(minElevation) : null,
    durationSeconds,
  };
}

// ── GET /api/trips/:id/gpx ────────────────────────────────────────────────────
router.get('/', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId = (req as AuthRequest).params.tripId || (req as AuthRequest).params.id;
  try {
    const tracks = db.prepare(
      `SELECT id, trip_id, track_name, orig_name, total_distance, total_elevation_gain,
              total_elevation_loss, max_elevation, min_elevation, duration_seconds,
              point_count, start_lat, start_lng, end_lat, end_lng,
              ibp, sort_order, is_active, created_at
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

    const result = db.prepare(`
      INSERT INTO gpx_tracks
        (trip_id, user_id, track_name, orig_name,
         total_distance, total_elevation_gain, total_elevation_loss,
         max_elevation, min_elevation, duration_seconds, point_count,
         start_lat, start_lng, end_lat, end_lng,
         points_json, waypoints_json, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      tripId,
      authReq.user.id,
      parsed.trackName,
      req.file.originalname,
      parsed.totalDistance,
      parsed.totalElevationGain,
      parsed.totalElevationLoss,
      parsed.maxElevation,
      parsed.minElevation,
      parsed.durationSeconds,
      parsed.points.length,
      parsed.points[0]?.lat,
      parsed.points[0]?.lng,
      parsed.points[parsed.points.length - 1]?.lat,
      parsed.points[parsed.points.length - 1]?.lng,
      JSON.stringify(parsed.points),
      JSON.stringify(parsed.waypoints || []),
      sortRow.n,
    );

    const newId = result.lastInsertRowid;

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

// ── PATCH /api/trips/:id/gpx/:trackId ─────────────────────────────────────────
router.patch('/:trackId', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;
  const { track_name, is_active } = req.body;
  try {
    const track = db.prepare('SELECT id FROM gpx_tracks WHERE id = ? AND trip_id = ?').get(trackId, tripId);
    if (!track) return res.status(404).json({ error: 'Track not found' });

    if (track_name !== undefined)
      db.prepare('UPDATE gpx_tracks SET track_name = ? WHERE id = ?').run(String(track_name).trim(), trackId);
    if (is_active !== undefined)
      db.prepare('UPDATE gpx_tracks SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, trackId);

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

    // Intentar borrar el fichero físico
    if (track.orig_name) {
      const fp = path.join(gpxDir, track.orig_name);
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch { /* ignorar */ }
      }
    }

    db.prepare('DELETE FROM gpx_tracks WHERE id = ?').run(trackId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

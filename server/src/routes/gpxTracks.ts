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
// Encuentra el índice del punto del track más cercano a (lat, lng), buscando
// desde `startFrom` hasta `endBound` (exclusivo). Los tracks son
// secuenciales, así que nunca se busca hacia atrás. Devuelve también la
// distancia al mejor punto encontrado, para que quien llama decida si merece
// la pena ampliar la búsqueda.
//
// IMPORTANTE: en una ruta circular o con tramos que se repiten (p.ej. el
// Pirinexus, que en 8 etapas pasa varias veces cerca de las mismas zonas),
// una búsqueda sin límite hasta el final del track puede "saltar" a una
// vuelta posterior del bucle que por casualidad quede más cerca en línea
// recta, tragándose varias etapas de golpe. Por eso quien llama debe acotar
// `endBound` a una ventana razonable alrededor de donde debería caer el
// punto, y solo ampliar la búsqueda si de verdad no hay nada cerca dentro de
// esa ventana.
// Normaliza un nombre de lugar para comparar sin acentos ni mayúsculas.
function normName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
// Distancia de Levenshtein simple, para tolerar pequeñas erratas de tecleo
// (p.ej. "Campodron" vs "Camprodon").
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
// Busca, entre los waypoints del propio track GPX, el que mejor encaje con
// una frase (nombre de pueblo), con tolerancia a erratas de tecleo.
function findWaypointMatch(
  waypoints: { lat: number; lng: number; name: string }[],
  phrase: string
): { lat: number; lng: number; name: string } | null {
  const target = normName(phrase);
  if (waypoints.length === 0 || !target) return null;
  let best: { lat: number; lng: number; name: string } | null = null;
  let bestScore = Infinity;
  for (const wp of waypoints) {
    const wn = normName(wp.name || '');
    if (!wn) continue;
    if (wn === target || wn.includes(target) || target.includes(wn)) return wp;
    const dist = levenshtein(wn, target);
    const score = dist / Math.max(wn.length, target.length);
    if (score < bestScore) { bestScore = score; best = wp; }
  }
  // Tolerancia: hasta ~30% de caracteres distintos (erratas menores)
  return bestScore <= 0.3 ? best : null;
}
// El destino del día (extraído del título "X a Y" → "Y", o el título
// completo si no sigue ese patrón). Sirve de respaldo cuando el día no
// tiene ningún "lugar" del itinerario con coordenadas.
function findWaypointForDay(
  waypoints: { lat: number; lng: number; name: string }[],
  dayTitle: string
): { lat: number; lng: number; name: string } | null {
  if (!dayTitle) return null;
  const parts = dayTitle.split(/\s+a\s+/i);
  return findWaypointMatch(waypoints, parts.length > 1 ? parts[parts.length - 1] : dayTitle);
}
// El origen del día (la parte "X" antes de " a Y" del título). Se usa solo
// para el Día 1, para saber dónde empieza de verdad la ruta del usuario
// cuando el GPX es un bucle cerrado grabado empezando en otro punto
// distinto (ver más abajo).
function findWaypointForOrigin(
  waypoints: { lat: number; lng: number; name: string }[],
  dayTitle: string
): { lat: number; lng: number; name: string } | null {
  if (!dayTitle) return null;
  const parts = dayTitle.split(/\s+a\s+/i);
  if (parts.length < 2) return null;
  return findWaypointMatch(waypoints, parts[0]);
}

function nearestPointIdx(
  points: { lat: number; lng: number }[],
  lat: number,
  lng: number,
  startFrom = 0,
  endBound = points.length
): { idx: number; dist: number } {
  let best = startFrom;
  let bestDist = Infinity;
  const upper = Math.min(endBound, points.length);
  for (let i = startFrom; i < upper; i++) {
    const d = haversineM(points[i].lat, points[i].lng, lat, lng);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return { idx: best, dist: bestDist };
}

// Como nearestPointIdx, pero primero prueba dentro de una ventana acotada
// (para no saltar a una vuelta posterior de una ruta circular) y solo si no
// hay nada razonablemente cerca dentro de ella, la amplía — de forma
// progresiva, nunca directamente a "todo el track" — para seguir
// encontrando el punto correcto cuando el lugar del día está a varios
// kilómetros de la ruta grabada (un alojamiento en un pueblo cercano, no
// justo en el camino).
//
// El umbral es generoso (5 km) a propósito: es habitual que el lugar de
// una etapa (hotel, pueblo) no esté literalmente sobre el track. Solo si de
// verdad no hay nada ni remotamente cerca se amplía la ventana, y siempre
// duplicándola en vez de saltar a una búsqueda global — así una ruta
// circular no puede "enganchar" una vuelta muy posterior solo porque quede
// más cerca en línea recta.
const FAR_FALLBACK_THRESHOLD_M = 10000;
function findBoundaryIdx(
  points: { lat: number; lng: number }[],
  lat: number,
  lng: number,
  startFrom: number,
  windowEnd: number
): number {
  let end = windowEnd;
  let best = nearestPointIdx(points, lat, lng, startFrom, end);
  while (best.dist > FAR_FALLBACK_THRESHOLD_M && end < points.length) {
    end = Math.min(points.length, end + (end - startFrom || 1));
    best = nearestPointIdx(points, lat, lng, startFrom, end);
  }
  return best.idx;
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

// ── Open Elevation enrichment ────────────────────────────────────────────────
// Default: Open-Meteo (free, no API key, no rate limit, global SRTM 90m, up to 1000 pts/batch).
// Override with a custom Open-Elevation-compatible server via OPEN_ELEVATION_URL.
async function enrichWithElevation(
  points: { lat: number; lng: number; ele: number | null; time?: string | null }[],
): Promise<{ lat: number; lng: number; ele: number | null; time?: string | null }[]> {
  const result = [...points];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele == null) indices.push(i);
  }
  if (indices.length === 0) return result;

  const customUrl = process.env.OPEN_ELEVATION_URL?.trim();

  if (customUrl) {
    // Custom Open-Elevation-compatible server (opentopodata / open-elevation format)
    const baseUrl = customUrl.replace(/\/$/, '');
    const isRateLimited = baseUrl.includes('opentopodata.org');
    const BATCH = 100;
    const DELAY = isRateLimited ? 1100 : 0;

    for (let b = 0; b < indices.length; b += BATCH) {
      if (b > 0 && DELAY > 0) await new Promise(r => setTimeout(r, DELAY));
      const batch = indices.slice(b, b + BATCH);
      const locs  = batch.map(i => `${points[i].lat},${points[i].lng}`).join('|');
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 15000);
        let r: Response;
        try { r = await fetch(`${baseUrl}?locations=${locs}`, { signal: controller.signal }); }
        finally { clearTimeout(tid); }
        if (!r.ok) { console.warn('[elevation] custom API error', r.status); continue; }
        const data: any = await r.json();
        const elevs: any[] = data.results ?? data.elevations ?? [];
        for (let j = 0; j < batch.length && j < elevs.length; j++) {
          const ele = elevs[j]?.elevation ?? elevs[j]?.ele;
          if (ele != null && !isNaN(Number(ele))) {
            result[batch[j]] = { ...result[batch[j]], ele: Math.round(Number(ele) * 10) / 10 };
          }
        }
      } catch (err: any) { console.warn('[elevation] batch failed:', err.message); }
    }
  } else {
    // Default: Open-Meteo elevation API — free, no key, no rate limit, SRTM 90m global
    const BATCH = 1000;
    for (let b = 0; b < indices.length; b += BATCH) {
      const batch = indices.slice(b, b + BATCH);
      const lats = batch.map(i => points[i].lat).join(',');
      const lngs = batch.map(i => points[i].lng).join(',');
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 20000);
        let r: Response;
        try {
          r = await fetch(
            `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,
            { signal: controller.signal },
          );
        } finally { clearTimeout(tid); }
        if (!r.ok) { console.warn('[elevation] open-meteo error', r.status); continue; }
        const data: any = await r.json();
        const elevs: number[] = data.elevation ?? [];
        for (let j = 0; j < batch.length && j < elevs.length; j++) {
          const ele = elevs[j];
          if (ele != null && !isNaN(ele)) {
            result[batch[j]] = { ...result[batch[j]], ele: Math.round(ele * 10) / 10 };
          }
        }
      } catch (err: any) { console.warn('[elevation] open-meteo batch failed:', err.message); }
    }
  }

  return result;
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

    // Enrich with elevation if the GPX has no altitude data and an elevation API is available
    const hasElevation = parsed.points.some(p => p.ele != null);
    let finalPoints = parsed.points;
    if (!hasElevation) {
      try {
        finalPoints = await enrichWithElevation(parsed.points);
        console.log(`[gpx] elevation enriched: ${finalPoints.filter(p => p.ele != null).length}/${finalPoints.length} points`);
      } catch (err: any) {
        console.warn('[gpx] elevation enrichment failed:', err.message);
      }
    }

    const sortRow = db.prepare('SELECT COUNT(*) as n FROM gpx_tracks WHERE trip_id = ?').get(tripId) as { n: number };
    const dayId = req.body.day_id ? parseInt(req.body.day_id) : null;

    const newId = saveTrack(
      tripId, authReq.user.id,
      parsed.trackName, req.file.originalname,
      finalPoints, parsed.waypoints || [],
      sortRow.n, dayId
    );

    // Intentar obtener IBP via API si hay clave configurada
    if (process.env.IBP_API_KEY) {
      try {
        const trip = db.prepare('SELECT trip_type FROM trips WHERE id = ?').get(tripId) as { trip_type: string } | undefined;
        const isTrekking = trip?.trip_type === 'trekking';
        const form = new FormData();
        form.append('key', process.env.IBP_API_KEY);
        const fileBuffer = fs.readFileSync(req.file.path);
        const fileBlob = new Blob([fileBuffer], { type: 'application/gpx+xml' });
        form.append('file', fileBlob, req.file.originalname);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        let r: Response;
        try {
          r = await fetch('https://www.ibpindex.com/api/', { method: 'POST', body: form, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        const data = await r.json();
        // Cycling → IBP para bicicleta; Trekking → IBP para senderismo (clave "hiking", acrónimo HKG)
        const ibp = isTrekking ? (data?.hiking?.ibp ?? data?.hkg?.ibp) : data?.bicycle?.ibp;
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

// ── POST /api/trips/:id/gpx/:trackId/recalculate-ibp ─────────────────────────
// Re-sends stored track points to IBPIndex API and updates the ibp column.
router.post('/:trackId/recalculate-ibp', authenticate, requireTripAccess, async (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;

  if (!process.env.IBP_API_KEY) return res.status(400).json({ error: 'IBP_API_KEY not configured' });

  try {
    const track = db.prepare('SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?').get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const points: { lat: number; lng: number; ele: number | null }[] = JSON.parse(track.points_json || '[]');
    if (points.length < 2) return res.status(400).json({ error: 'Track has insufficient points' });

    // Rebuild minimal GPX from stored points
    const ptLines = points.map(p =>
      `    <trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>`
    );
    const gpxXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <trk><name>${track.track_name}</name><trkseg>`,
      ...ptLines,
      '  </trkseg></trk>',
      '</gpx>',
    ].join('\n');

    const trip = db.prepare('SELECT trip_type FROM trips WHERE id = ?').get(tripId) as { trip_type: string } | undefined;
    const isTrekking = trip?.trip_type === 'trekking';

    const form = new FormData();
    form.append('key', process.env.IBP_API_KEY);
    form.append('file', new Blob([gpxXml], { type: 'application/gpx+xml' }), `${track.track_name}.gpx`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let r: Response;
    try {
      r = await fetch('https://www.ibpindex.com/api/', { method: 'POST', body: form, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    const data = await r.json() as any;
    const ibpRaw = isTrekking ? (data?.hiking?.ibp ?? data?.hkg?.ibp) : data?.bicycle?.ibp;
    if (ibpRaw == null) return res.status(502).json({ error: 'IBP not returned by API' });

    const ibp = Math.round(Number(ibpRaw));
    db.prepare('UPDATE gpx_tracks SET ibp = ? WHERE id = ?').run(ibp, trackId);
    res.json({ ibp });
  } catch (e: any) {
    console.error('[gpx recalculate-ibp]', e);
    res.status(500).json({ error: e.message });
  }
});


// ── POST /api/trips/:id/gpx/:trackId/fetch-elevation ─────────────────────────
// Fetches elevation data for a track's points using the configured Open Elevation API.
// Only enriches points that currently have null elevation.
router.post('/:trackId/fetch-elevation', authenticate, requireTripAccess, async (req: Request, res: Response) => {
  const tripId  = (req as AuthRequest).params.id;
  const trackId = req.params.trackId;

  try {
    const track = db.prepare('SELECT * FROM gpx_tracks WHERE id = ? AND trip_id = ?').get(trackId, tripId) as any;
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const points: { lat: number; lng: number; ele: number | null; time?: string | null }[] =
      JSON.parse(track.points_json || '[]');
    if (points.length < 2) return res.status(400).json({ error: 'Track has insufficient points' });

    const enriched = await enrichWithElevation(points);
    const filled = enriched.filter(p => p.ele != null).length;

    const stats = computeStats(enriched);
    db.prepare(`
      UPDATE gpx_tracks
      SET points_json = ?,
          total_elevation_gain = ?, total_elevation_loss = ?,
          max_elevation = ?, min_elevation = ?
      WHERE id = ?
    `).run(
      JSON.stringify(enriched),
      stats.totalElevationGain, stats.totalElevationLoss,
      stats.maxElevation, stats.minElevation,
      trackId,
    );

    const updated = db.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(trackId) as any;
    res.json({
      ...updated,
      points: enriched,
      waypoints: JSON.parse(updated.waypoints_json || '[]'),
      enriched: filled,
      total: enriched.length,
    });
  } catch (e: any) {
    console.error('[gpx fetch-elevation]', e);
    res.status(500).json({ error: e.message });
  }
});

// Divide un GPX largo en etapas usando los lugares de inicio/fin de cada día
router.post('/:trackId/split-by-days', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const tripId  = authReq.params.id;
  const trackId = req.params.trackId;
  // Days the user explicitly does not want to use as split boundaries
  // (e.g. a rest day, or a day already covered by another track). Their
  // places are skipped entirely when building the day-by-day stages.
  const excludeDayIds: Set<number> = new Set(
    Array.isArray(req.body?.excludeDayIds) ? req.body.excludeDayIds.map((id: any) => Number(id)) : []
  );

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
    const trackWaypoints: { lat: number; lng: number; name: string }[] =
      JSON.parse(track.waypoints_json || '[]');

    const days = (db.prepare(
      `SELECT d.id, d.date, d.title, d.day_number
       FROM days d WHERE d.trip_id = ? ORDER BY d.date ASC, d.day_number ASC`
    ).all(tripId) as any[]).filter(d => !excludeDayIds.has(Number(d.id)));

    if (days.length === 0) {
      return res.status(400).json({ error: 'No days found for this trip' });
    }

    const dayBounds: {
      dayId: number;
      title: string;
      startLat: number; startLng: number;
      endLat: number; endLng: number;
      boundarySource: string;
      boundaryName: string;
    }[] = [];
    const skippedNoPlaces: string[] = [];
    const usedWaypointFallback: string[] = [];

    for (const day of days) {
      const places = db.prepare(
        `SELECT p.lat, p.lng, p.name, a.order_index
         FROM day_assignments a
         JOIN places p ON p.id = a.place_id
         WHERE a.day_id = ? AND p.lat IS NOT NULL AND p.lng IS NOT NULL
         ORDER BY a.order_index ASC`
      ).all(day.id) as any[];

      const title = day.title || `Día ${day.day_number || day.id}`;

      if (places.length >= 1) {
        const last = places[places.length - 1];
        dayBounds.push({
          dayId:    day.id,
          title,
          startLat: last.lat, startLng: last.lng,
          endLat:   last.lat, endLng:   last.lng,
          boundarySource: 'place',
          boundaryName: last.name || '(sin nombre)',
        });
        continue;
      }

      // Sin ningún lugar del itinerario con coordenadas: probamos con los
      // waypoints que trae el propio GPX (habitual en rutas descargadas,
      // uno por etapa), buscando el que coincide con el nombre del día
      // (p.ej. título "Girona a Olot" → waypoint "Olot").
      const wp = findWaypointForDay(trackWaypoints, title);
      if (wp) {
        dayBounds.push({
          dayId:    day.id,
          title,
          startLat: wp.lat, startLng: wp.lng,
          endLat:   wp.lat, endLng:   wp.lng,
          boundarySource: 'waypoint',
          boundaryName: wp.name,
        });
        usedWaypointFallback.push(`${title} → ${wp.name}`);
        continue;
      }

      // Ni lugar del itinerario ni waypoint del track: no hay dónde
      // enganchar el corte, así que este día se queda sin track propio.
      // Lo reportamos explícitamente en vez de saltarlo en silencio, para
      // poder diagnosticar por qué salen menos etapas de las esperadas.
      skippedNoPlaces.push(title);
    }

    for (let i = 1; i < dayBounds.length; i++) {
      dayBounds[i].startLat = dayBounds[i - 1].endLat;
      dayBounds[i].startLng = dayBounds[i - 1].endLng;
    }
    if (dayBounds.length === 0) {
      return res.status(400).json({ error: 'No days have places with coordinates' });
    }

    // Si el GPX es un bucle cerrado (empieza y acaba prácticamente en el
    // mismo sitio — habitual en rutas circulares tipo Pirinexus), el punto
    // donde alguien empezó a GRABAR no tiene por qué coincidir con dónde el
    // usuario empieza su viaje. Si eso pasa, el resto de días puede quedar
    // "antes" que el día 1 dentro del array grabado, y como solo buscamos
    // hacia delante, esos días nunca se encuentran.
    //
    // Solución: si el título del día 1 sigue el patrón "Origen a Destino" y
    // "Origen" coincide con un waypoint del track, rotamos el array de
    // puntos para que empiece ahí — convirtiendo el bucle en una secuencia
    // lineal que sí sigue el orden real del viaje del usuario.
    let workingPoints = allPoints;
    const trackIsLoop = allPoints.length > 1 &&
      haversineM(
        allPoints[0].lat, allPoints[0].lng,
        allPoints[allPoints.length - 1].lat, allPoints[allPoints.length - 1].lng
      ) < 500;
    let rotatedFrom: { name: string; km: number } | null = null;
    if (trackIsLoop) {
      const originWp = findWaypointForOrigin(trackWaypoints, dayBounds[0].title);
      if (originWp) {
        const rIdx = nearestPointIdx(allPoints, originWp.lat, originWp.lng, 0, allPoints.length).idx;
        if (rIdx > 0 && rIdx < allPoints.length - 1) {
          workingPoints = [...allPoints.slice(rIdx), ...allPoints.slice(0, rIdx)];
          rotatedFrom = { name: originWp.name, km: 0 };
        }
      }
    }

    dayBounds[0].startLat = workingPoints[0].lat;
    dayBounds[0].startLng = workingPoints[0].lng;

    const created: any[] = [];
    let searchFrom = 0;
    const skippedDegenerate: string[] = [];
    const debugInfo: any[] = [];

    db.prepare(
      'DELETE FROM gpx_tracks WHERE trip_id = ? AND day_id IS NOT NULL'
    ).run(tripId);

    for (let i = 0; i < dayBounds.length; i++) {
      const day = dayBounds[i];

      // Ventana de búsqueda proporcional al track que queda por repartir
      // entre los días que quedan. x3 de margen para admitir días más
      // cortos/largos que la media, sin permitir que un lugar ambiguo (por
      // ejemplo, una ruta circular que vuelve a pasar cerca del mismo
      // pueblo) salte varias etapas de golpe hacia una vuelta posterior.
      const remainingDays = dayBounds.length - i;
      const remainingPoints = workingPoints.length - searchFrom;
      const avgChunk = Math.max(1, Math.floor(remainingPoints / remainingDays));
      const windowEnd = Math.min(workingPoints.length, searchFrom + avgChunk * 3);

      const startIdx = findBoundaryIdx(workingPoints, day.startLat, day.startLng, searchFrom, windowEnd);

      // Si el día vuelve al mismo punto de partida (rutas en bucle que
      // salen y regresan al mismo lugar), buscar "el más cercano" desde el
      // propio inicio encontraría el propio inicio (distancia ≈0) y la
      // etapa saldría vacía. Forzamos un avance mínimo antes de buscar el
      // punto de regreso.
      const minGap = Math.max(1, Math.floor(avgChunk * 0.3));
      const endSearchFrom = Math.min(startIdx + minGap, workingPoints.length - 1);

      let endIdx: number;
      if (i === dayBounds.length - 1) {
        endIdx = workingPoints.length - 1;
      } else {
        endIdx = findBoundaryIdx(workingPoints, day.endLat, day.endLng, endSearchFrom, windowEnd);
        const nextDay = dayBounds[i + 1];
        const nextStartIdx = findBoundaryIdx(workingPoints, nextDay.startLat, nextDay.startLng, endSearchFrom, windowEnd);
        const distEnd  = haversineM(workingPoints[endIdx].lat, workingPoints[endIdx].lng, day.endLat, day.endLng);
        const distNext = haversineM(workingPoints[nextStartIdx].lat, workingPoints[nextStartIdx].lng, day.endLat, day.endLng);
        endIdx = distEnd <= distNext ? endIdx : nextStartIdx;
      }

      if (endIdx <= startIdx) endIdx = Math.min(startIdx + 1, workingPoints.length - 1);

      const matchDist = Math.round(haversineM(workingPoints[endIdx].lat, workingPoints[endIdx].lng, day.endLat, day.endLng));
      debugInfo.push({
        day: day.title,
        boundarySource: day.boundarySource,
        boundaryName: day.boundaryName,
        boundaryLatLng: [day.endLat, day.endLng],
        startIdx, endIdx, windowEnd,
        matchedLatLng: [workingPoints[endIdx].lat, workingPoints[endIdx].lng],
        matchDistM: matchDist,
      });

      const slice = workingPoints.slice(startIdx, endIdx + 1);
      if (slice.length < 2) { skippedDegenerate.push(day.title); continue; }

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

    const allSkipped = [...skippedNoPlaces, ...skippedDegenerate];
    const parts = [`GPX dividido en ${created.length} etapas`];
    if (rotatedFrom) {
      parts.push(`Track circular: reordenado para empezar en "${rotatedFrom.name}" (origen del Día 1)`);
    }
    if (usedWaypointFallback.length > 0) {
      parts.push(`Usados waypoints del GPX para días sin lugar propio: ${usedWaypointFallback.join(', ')}`);
    }
    if (allSkipped.length > 0) {
      parts.push(`Días sin etapa propia: ${allSkipped.join(', ')} (ni lugar del itinerario ni waypoint del GPX con nombre parecido, o su tramo no se pudo separar del día vecino)`);
    }
    res.json({
      success: true,
      message: parts.join('. '),
      skippedNoPlaces,
      skippedDegenerate,
      usedWaypointFallback,
      rotatedFrom,
      debug: debugInfo,
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

/**
 * tracking.ts — Tracking en vivo (5.7.1): Trek as an Overland server.
 *
 * Rutas:
 *   POST   /api/tracking/overland                  → (token del dispositivo) recibe tandas de Overland
 *   GET    /api/tracking/devices                   → (auth) mis dispositivos, con última posición y estado
 *   POST   /api/tracking/devices                   → (auth) nuevo dispositivo; devuelve su token UNA vez
 *   PATCH  /api/tracking/devices/:id               → (auth) renombrar / días de conservación
 *   POST   /api/tracking/devices/:id/token         → (auth) token nuevo (el anterior deja de valer)
 *   DELETE /api/tracking/devices/:id               → (auth) borra el dispositivo y sus puntos
 *   GET    /api/tracking/devices/:id/track         → (auth) puntos entre from y to
 *   GET    /api/tracking/devices/:id/days          → (auth) días con puntos (calendario)
 *   GET    /api/tracking/devices/:id/gpx           → (auth) descarga GPX de un rango
 *   POST   /api/tracking/devices/:id/save-route    → (auth) guarda un rango como ruta de un viaje
 *   POST   /api/tracking/devices/:id/share         → (auth) crea/alarga el enlace público
 *   DELETE /api/tracking/devices/:id/share         → (auth) lo retira
 *   GET    /api/tracking/public/:token             → (público) lo que ve quien tiene el enlace
 */
import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import * as tracking from '../services/trackingService';
import { saveTrack } from './gpxTracks';
import { broadcastToUser } from '../websocket';

const router = express.Router();

const MAX_NAME = 60;

function tokenFrom(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header === 'string' && /^bearer /i.test(header)) return header.slice(7).trim();
  // Overland iOS users sometimes put the token in the URL instead.
  const q = req.query.token;
  return typeof q === 'string' ? q : '';
}

// ── Overland receiver ──────────────────────────────────────────────────────
router.post('/tracking/overland', (req: Request, res: Response) => {
  const token = tokenFrom(req);
  const device = tracking.deviceByToken(token);
  // Anything but {"result":"ok"} keeps the batch on the phone, which is what an
  // unknown token should do: nothing is lost while the user fixes the setting.
  if (!device) return res.status(401).json({ result: 'unauthorized' });
  if (!tracking.allowRequest(device.token_hash)) return res.status(429).json({ result: 'rate_limited' });

  const result = tracking.ingestOverland(device, req.body);
  if (result.stored > 0 || result.statuses > 0) {
    // The owner's open map follows the phone without polling.
    broadcastToUser(device.user_id, { type: 'tracking:update', device: tracking.getDevice(device.user_id, device.id) });
  }
  res.json({ result: 'ok', ...result });
});

// ── Public share ───────────────────────────────────────────────────────────
router.get('/tracking/public/:token', (req: Request, res: Response) => {
  const data = tracking.getPublicShare(req.params.token);
  if (!data) return res.status(404).json({ error: 'Invalid or expired link' });
  res.json(data);
});

// ── Devices (owner) ────────────────────────────────────────────────────────
function deviceId(req: Request): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, MAX_NAME);
  return s || null;
}

function range(req: Request): { from: string; to: string; maxAccuracy?: number } | null {
  const from = tracking.parseInstant(req.query.from ?? (req.body && req.body.from));
  const to = tracking.parseInstant(req.query.to ?? (req.body && req.body.to));
  if (!from || !to || from > to) return null;
  const accRaw = Number(req.query.max_accuracy ?? (req.body && req.body.max_accuracy));
  return { from, to, maxAccuracy: Number.isFinite(accRaw) && accRaw > 0 ? accRaw : undefined };
}

router.get('/tracking/devices', authenticate, (req: Request, res: Response) => {
  res.json({ devices: tracking.listDevices((req as AuthRequest).user.id) });
});

router.post('/tracking/devices', authenticate, (req: Request, res: Response) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  const userId = (req as AuthRequest).user.id;
  if (tracking.listDevices(userId).length >= 20) return res.status(400).json({ error: 'Too many devices' });
  res.status(201).json(tracking.createDevice(userId, name));
});

router.patch('/tracking/devices/:id', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const patch: { name?: string; retention_days?: number | null } = {};
  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    patch.name = name;
  }
  if (req.body?.retention_days !== undefined) {
    const r = req.body.retention_days;
    if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 3650)) return res.status(400).json({ error: 'Invalid retention_days' });
    patch.retention_days = r;
  }
  const device = tracking.updateDevice((req as AuthRequest).user.id, id, patch);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ device });
});

router.post('/tracking/devices/:id/token', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  const out = id ? tracking.regenerateToken((req as AuthRequest).user.id, id) : null;
  if (!out) return res.status(404).json({ error: 'Device not found' });
  res.json(out);
});

router.delete('/tracking/devices/:id', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  if (!id || !tracking.deleteDevice((req as AuthRequest).user.id, id)) return res.status(404).json({ error: 'Device not found' });
  res.json({ success: true });
});

router.get('/tracking/devices/:id/track', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  const r = range(req);
  if (!id || !r) return res.status(400).json({ error: 'from/to required (ISO)' });
  const out = tracking.getTrack((req as AuthRequest).user.id, id, r.from, r.to, r.maxAccuracy);
  if (!out) return res.status(404).json({ error: 'Device not found' });
  res.json(out);
});

router.get('/tracking/devices/:id/days', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const offset = Number(req.query.offset ?? 0);
  const days = tracking.getDays((req as AuthRequest).user.id, id, Number.isFinite(offset) ? offset : 0);
  if (!days) return res.status(404).json({ error: 'Device not found' });
  res.json({ days });
});

router.get('/tracking/devices/:id/gpx', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  const r = range(req);
  if (!id || !r) return res.status(400).json({ error: 'from/to required (ISO)' });
  const out = tracking.exportGpx((req as AuthRequest).user.id, id, r.from, r.to, r.maxAccuracy);
  if (!out) return res.status(404).json({ error: 'Device not found' });
  const file = out.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'track';
  res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}.gpx"`);
  res.send(out.xml);
});

router.post('/tracking/devices/:id/save-route', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  const r = range(req);
  const tripId = Number(req.body?.trip_id);
  const dayId = req.body?.day_id == null || req.body.day_id === '' ? null : Number(req.body.day_id);
  if (!id || !r || !Number.isInteger(tripId) || (dayId !== null && !Number.isInteger(dayId))) {
    return res.status(400).json({ error: 'from, to and trip_id required' });
  }
  const out = tracking.saveAsRoute((req as AuthRequest).user.id, id, {
    ...r, tripId, dayId, name: typeof req.body?.name === 'string' ? req.body.name : undefined,
  }, saveTrack as never);
  if ('error' in out) return res.status(out.status).json({ error: out.error });
  res.status(201).json(out);
});

router.post('/tracking/devices/:id/share', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  const hours = Number(req.body?.hours ?? 24);
  const label = typeof req.body?.label === 'string' ? req.body.label : null;
  const device = id ? tracking.startShare((req as AuthRequest).user.id, id, Number.isFinite(hours) ? hours : 24, label) : null;
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ device });
});

router.delete('/tracking/devices/:id/share', authenticate, (req: Request, res: Response) => {
  const id = deviceId(req);
  const device = id ? tracking.stopShare((req as AuthRequest).user.id, id) : null;
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ device });
});

export default router;

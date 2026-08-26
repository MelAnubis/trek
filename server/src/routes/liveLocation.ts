/**
 * liveLocation.ts — Compartir ubicación en vivo mediante un enlace público
 *
 * No depende de ningún Trip: cualquier usuario autenticado puede iniciar un
 * share y mandar el enlace a quien quiera, sin que esa persona necesite
 * cuenta en Trek.
 *
 * Rutas:
 *   POST /api/live-location/start        → (auth) crea/reanuda el share, devuelve el token
 *   POST /api/live-location/stop         → (auth) desactiva el share activo del usuario
 *   GET  /api/live-location/mine         → (auth) estado del share activo del usuario, si hay
 *   POST /api/live-location/:token/point → (auth) añade un punto GPS al share
 *   GET  /api/live-location/:token       → (público) posición actual + track, para el visor
 */
import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import * as liveLocationService from '../services/liveLocationService';

const router = express.Router();

const MAX_LABEL_LENGTH = 80;

router.post('/live-location/start', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  let { label } = req.body || {};
  if (label !== undefined) {
    if (typeof label !== 'string') return res.status(400).json({ error: 'Invalid label' });
    label = label.trim().slice(0, MAX_LABEL_LENGTH);
  }
  const result = liveLocationService.startShare(authReq.user.id, label || undefined);
  res.status(result.created ? 201 : 200).json(result);
});

router.post('/live-location/stop', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  liveLocationService.stopShare(authReq.user.id);
  res.json({ success: true });
});

router.get('/live-location/mine', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const mine = liveLocationService.getMine(authReq.user.id);
  res.json(mine ? { token: mine.token, label: mine.label, expires_at: mine.expires_at } : { token: null });
});

router.post('/live-location/:token/point', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { token } = req.params;
  const { lat, lng, accuracy, altitude, speed, recorded_at } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat/lng required' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng out of range' });
  }

  const ok = liveLocationService.addPoint(authReq.user.id, token, {
    lat, lng,
    accuracy: typeof accuracy === 'number' ? accuracy : null,
    altitude: typeof altitude === 'number' ? altitude : null,
    speed: typeof speed === 'number' ? speed : null,
    recorded_at: typeof recorded_at === 'string' ? recorded_at : undefined,
  });
  if (!ok) return res.status(404).json({ error: 'Share not found, not yours, or no longer active' });
  res.json({ success: true });
});

// Public — no auth. This is the endpoint the person you share the link with hits.
router.get('/live-location/:token', (req: Request, res: Response) => {
  const { token } = req.params;
  const data = liveLocationService.getPublicStatus(token);
  if (!data) return res.status(404).json({ error: 'Invalid or expired link' });
  res.json(data);
});

export default router;

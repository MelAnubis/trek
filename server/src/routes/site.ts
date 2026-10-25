import express, { NextFunction, Request, Response } from 'express';
import { authenticate, adminOnly } from '../middleware/auth';
import { getAppConfig } from '../services/authService';
import { getSiteHome, getSiteRoute, getSiteStory, isPublicTrip, sitePhotoOwner, setSiteJournal, clearSiteCache } from '../services/siteService';
import { buildTripGpx, gpxFilename } from '../services/tripGpxExport';
import { streamPhoto } from '../services/memories/photoResolverService';

/**
 * /api/site — la zona pública. Todo se lee sin login salvo el GPX (hace
 * falta cuenta: es el gancho para registrarse) y el interruptor de admin.
 */
const router = express.Router();

// Un límite por IP para lo que se sirve sin login.
const WINDOW = 60_000;
const MAX = 240;
const hits = new Map<string, { n: number; t: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > WINDOW) hits.delete(k); }, WINDOW).unref?.();
function limit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > WINDOW) hits.set(key, { n: 1, t: now });
  else if (++h.n > MAX) { res.status(429).json({ error: 'Too many requests' }); return; }
  next();
}
router.use(limit);

router.get('/', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(getSiteHome(!!getAppConfig(null).allow_registration));
});

router.get('/routes/:id', (req: Request, res: Response) => {
  const data = getSiteRoute(Number(req.params.id));
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'public, max-age=60');
  res.json(data);
});

// El GPX, solo con cuenta.
router.get('/routes/:id/gpx', authenticate, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!isPublicTrip(id)) return res.status(404).json({ error: 'Not found' });
  const out = buildTripGpx(id);
  if (!out) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${gpxFilename(out.title)}"`);
  res.send(out.xml);
});

router.get('/stories/:slug', (req: Request, res: Response) => {
  const data = getSiteStory(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.get('/photos/:photoId/:kind', async (req: Request, res: Response) => {
  const id = Number(req.params.photoId);
  const owner = Number.isFinite(id) ? sitePhotoOwner(id) : null;
  if (!owner) return res.status(404).json({ error: 'Not found' });
  await streamPhoto(res, owner, id, req.params.kind === 'thumbnail' ? 'thumbnail' : 'original');
});

// Admin: una travesía pasa a ser (o deja de ser) fuente de «Relatos».
router.put('/journals/:journeyId', authenticate, adminOnly, (req: Request, res: Response) => {
  const ok = setSiteJournal(Number(req.params.journeyId), req.body?.on === true);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  clearSiteCache();
  res.json({ ok: true, site_journal: req.body?.on === true });
});

export default router;

/**
 * arte.ts — Mapas ilustrados («Arte») dentro de Trek.
 *
 * La app es estática (HTML + módulos JS) y usa rutas relativas, así que todo
 * cuelga de /api/arte/ y se carga en un iframe del mismo origen:
 *
 *   GET  /api/arte/                       → la app (index.html, js, css, fuentes)
 *   GET  /api/arte/data/*                 → catálogo e ilustraciones (primero la copia sincronizada)
 *   POST /api/arte/api/overpass           → Overpass con caché de 30 días
 *   GET  /api/arte/api/terreno/z/x/y.png  → teselas de elevación con caché de 90 días
 *   GET  /api/arte/api/peticion/estado    → 204 si se pueden pedir dibujos desde la app
 *   POST /api/arte/api/peticion           → crea la petición de dibujo
 *   GET  /api/arte/trek/rutas             → rutas del usuario (planificador, tracks, excursiones)
 *   GET  /api/arte/trek/rutas/:tipo/:id   → esa ruta como GPX
 *   …    /api/arte/trek/composiciones     → composiciones guardadas del usuario
 *
 * Todo exige sesión y el permiso «arte_use» (Admin → Permisos).
 */
import express, { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../types';
import { checkPermission } from '../services/permissions';
import {
  arteAppDir,
  syncedDataDir,
  overpassQuery,
  terrainTile,
  drawingRequestsEnabled,
  drawingRequestAllowed,
  createDrawingRequest,
} from '../services/arteService';
import {
  listUserRoutes,
  userRouteGpx,
  listCompositions,
  getComposition,
  getCompositionImage,
  saveComposition,
  deleteComposition,
  validCompositionId,
  type RouteKind,
} from '../services/arteTrekService';

const router = express.Router();

router.use(authenticate);
router.use((req: Request, res: Response, next: NextFunction) => {
  const user = (req as AuthRequest).user;
  if (!checkPermission('arte_use', user.role, null, user.id, false)) {
    res.status(403).json({ error: 'No tienes acceso a los mapas ilustrados' });
    return;
  }
  next();
});

// ── Overpass ────────────────────────────────────────────────────────────────

router.post('/api/overpass', async (req: Request, res: Response) => {
  const query = typeof req.body?.data === 'string' ? req.body.data : '';
  if (!query || query.length > 20_000) {
    res.status(400).json({ error: 'Consulta no válida' });
    return;
  }
  try {
    const { file, cache } = await overpassQuery(query);
    res.setHeader('X-Cache', cache);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json');
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'OpenStreetMap no responde', detail: e instanceof Error ? e.message : undefined });
  }
});

// ── Teselas de elevación ────────────────────────────────────────────────────

router.get('/api/terreno/:z/:x/:file', async (req: Request, res: Response) => {
  const m = /^(\d{1,7})\.png$/.exec(req.params.file);
  if (!m || !/^\d{1,2}$/.test(req.params.z) || !/^\d{1,7}$/.test(req.params.x)) {
    res.status(404).end();
    return;
  }
  const tile = await terrainTile(Number(req.params.z), Number(req.params.x), Number(m[1]));
  if (!tile) {
    res.status(404).end();
    return;
  }
  res.setHeader('X-Cache', tile.cache);
  res.setHeader('Cache-Control', 'private, max-age=7776000');
  res.type('image/png');
  fs.createReadStream(tile.file).on('error', () => res.destroy()).pipe(res);
});

// ── Peticiones de dibujo ────────────────────────────────────────────────────

router.get('/api/peticion/estado', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(drawingRequestsEnabled() ? 204 : 503).end();
});

router.post('/api/peticion', async (req: Request, res: Response) => {
  if (!drawingRequestsEnabled()) {
    res.status(503).json({ error: 'Peticiones de dibujo sin configurar' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body : '';
  if (!title || title.length > 250 || !body || body.length > 60_000) {
    res.status(400).json({ error: 'Petición no válida' });
    return;
  }
  if (!drawingRequestAllowed((req as AuthRequest).user.id)) {
    res.status(429).json({ error: 'Demasiadas peticiones seguidas' });
    return;
  }
  try {
    const out = await createDrawingRequest({ title, body });
    if (out.status === 201) {
      const issue = out.body as { number?: number; html_url?: string };
      res.status(201).json({ number: issue?.number, html_url: issue?.html_url });
      return;
    }
    // 401/403/404: el token del servidor caducó o no tiene permiso «Issues».
    res.status([401, 403, 404].includes(out.status) ? out.status : 502).json({ error: 'El repositorio de ilustraciones rechazó la petición' });
  } catch {
    res.status(502).json({ error: 'No se pudo enviar la petición' });
  }
});

router.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Rutas de Trek como GPX ──────────────────────────────────────────────────

router.get('/trek/rutas', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ rutas: listUserRoutes((req as AuthRequest).user.id) });
});

router.get('/trek/rutas/:tipo/:id', (req: Request, res: Response) => {
  const tipo = req.params.tipo;
  const id = Number(req.params.id);
  if (!['planner', 'track', 'tour'].includes(tipo) || !Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: 'Ruta no encontrada' });
    return;
  }
  const route = userRouteGpx((req as AuthRequest).user.id, tipo as RouteKind, id);
  if (!route) {
    res.status(404).json({ error: 'Ruta no encontrada' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ nombre: route.name, gpx: route.gpx });
});

// ── Composiciones guardadas ─────────────────────────────────────────────────

router.get('/trek/composiciones', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ composiciones: listCompositions((req as AuthRequest).user.id) });
});

router.get('/trek/composiciones/:id', (req: Request, res: Response) => {
  const comp = validCompositionId(req.params.id) ? getComposition((req as AuthRequest).user.id, req.params.id) : null;
  if (!comp) {
    res.status(404).json({ error: 'Composición no encontrada' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(comp);
});

router.get('/trek/composiciones/:id/imagen', (req: Request, res: Response) => {
  const image = validCompositionId(req.params.id) ? getCompositionImage((req as AuthRequest).user.id, req.params.id) : null;
  if (!image) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type('image/jpeg').send(image);
});

router.put('/trek/composiciones/:id', (req: Request, res: Response) => {
  if (!validCompositionId(req.params.id)) {
    res.status(400).json({ error: 'Identificador no válido' });
    return;
  }
  const out = saveComposition((req as AuthRequest).user.id, req.params.id, req.body);
  if ('error' in out) {
    res.status(out.status).json({ error: out.error });
    return;
  }
  res.json(out.summary);
});

router.delete('/trek/composiciones/:id', (req: Request, res: Response) => {
  if (validCompositionId(req.params.id)) deleteComposition((req as AuthRequest).user.id, req.params.id);
  res.status(204).end();
});

router.use('/trek', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── App estática ────────────────────────────────────────────────────────────

const appDir = arteAppDir();

function staticHeaders(res: Response, filePath: string): void {
  if (/\.(woff2|png|svg|jpe?g|webp)$/i.test(filePath)) res.setHeader('Cache-Control', 'private, max-age=2592000');
  else res.setHeader('Cache-Control', 'no-cache');
}

// Catálogo e ilustraciones: siempre la última versión; la copia sincronizada tiene prioridad.
const dataHeaders = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-cache');
};
router.use('/data', express.static(syncedDataDir, { index: false, fallthrough: true, setHeaders: dataHeaders }));
if (appDir) {
  router.use('/data', express.static(path.join(appDir, 'data'), { index: false, fallthrough: true, setHeaders: dataHeaders }));
}
router.use('/data', (_req: Request, res: Response) => {
  res.status(404).end();
});

if (appDir) {
  router.use(express.static(appDir, { index: 'index.html', setHeaders: staticHeaders }));
}
router.use((_req: Request, res: Response) => {
  res.status(404).type('text/plain').send(appDir ? 'Not found' : 'Mapas ilustrados no instalados en este servidor');
});

export default router;

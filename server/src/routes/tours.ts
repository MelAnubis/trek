import express, { Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { requireTripAccess } from '../middleware/tripAccess';
import { broadcast } from '../websocket';
import { checkPermission } from '../services/permissions';
import type { AuthRequest } from '../types';
import {
  TourError, copyTour, createTour, deleteTour, exportTourGpx, getTourDetail, getTourItem, gpxFileName, importChoiceSchema,
  importTracks, listTourTypes, listTours, placePayload, previewTrack, readTrackFile, restoreRecorded, tourWriteSchema, updateTour,
} from '../services/toursService';

/**
 * /api/trips/:tripId/tours — Tours (de liketrek/TREK v5.0.0), mismas rutas y
 * respuestas que la v5 para lo que trae este puerto: tipos, lista, detalle,
 * crear, editar (409 si la excursión cambió entretanto), copiar, volver al
 * track grabado, borrar y GPX (exportar, e importar GPX/KML con vista previa).
 */
const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const canEdit = (req: Request) => {
  const a = req as AuthRequest;
  return checkPermission('place_edit', a.user.role, a.trip!.user_id, a.user.id, a.trip!.user_id !== a.user.id);
};
const socketId = (req: Request) => req.headers['x-socket-id'] as string | undefined;

function announce(req: Request, tripId: string, placeId: number, created: boolean) {
  const place = placePayload(placeId);
  if (place) broadcast(tripId, created ? 'place:created' : 'place:updated', { place }, socketId(req));
  broadcast(tripId, 'tour:changed', { placeId, tour: getTourItem(tripId, placeId) }, socketId(req));
}

function fail(res: Response, e: unknown) {
  if (e instanceof TourError) return res.status(e.status).json({ error: e.message, ...e.body });
  console.error('[tours]', e);
  return res.status(500).json({ error: 'Tour could not be saved' });
}

router.get('/types', authenticate, requireTripAccess, (_req: Request, res: Response) => {
  res.json({ tourTypes: listTourTypes() });
});

router.get('/', authenticate, requireTripAccess, (req: Request, res: Response) => {
  res.json({ tours: listTours(req.params.tripId), tourTypes: listTourTypes() });
});

// Static sub-routes before the :placeId ones.
router.post('/import/gpx/preview', authenticate, requireTripAccess, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const tracks = readTrackFile(req.file.buffer, req.file.originalname || 'track.gpx');
    if (!tracks.length) return res.status(422).json({ error: 'The file holds no track' });
    res.json({ file_name: req.file.originalname, tracks: tracks.map(previewTrack) });
  } catch {
    res.status(422).json({ error: 'The file could not be read' });
  }
});

router.post('/import/gpx', authenticate, requireTripAccess, upload.single('file'), (req: Request, res: Response) => {
  // Checked in the handler, never by a guard in front of a multipart body.
  if (!canEdit(req)) return res.status(403).json({ error: 'No permission' });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  let choices: unknown;
  try { choices = JSON.parse(String(req.body?.choices ?? '[]')); } catch { return res.status(400).json({ error: 'Invalid choices' }); }
  const parsed = importChoiceSchema.safeParse({ choices });
  if (!parsed.success) return res.status(400).json({ error: 'Invalid choices', issues: parsed.error.issues });
  try {
    const tracks = readTrackFile(req.file.buffer, req.file.originalname || 'track.gpx');
    const ids = importTracks(req.params.tripId, tracks, parsed.data.choices, req.file.originalname || 'track.gpx');
    ids.forEach(id => announce(req, req.params.tripId, id, true));
    res.status(201).json({ tours: ids.map(id => getTourItem(req.params.tripId, id)) });
  } catch (e) { fail(res, e); }
});

router.get('/:placeId/export.gpx', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const out = exportTourGpx(req.params.tripId, Number(req.params.placeId));
  if (!out) return res.status(404).json({ error: 'Tour not found' });
  res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${gpxFileName(out.name)}"`);
  res.send(out.xml);
});

router.get('/:placeId', authenticate, requireTripAccess, (req: Request, res: Response) => {
  const d = getTourDetail(req.params.tripId, Number(req.params.placeId));
  if (!d) return res.status(404).json({ error: 'Tour not found' });
  res.json(d);
});

router.post('/', authenticate, requireTripAccess, express.json({ limit: '2mb' }), (req: Request, res: Response) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'No permission' });
  const parsed = tourWriteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tour', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
  try {
    const id = createTour(req.params.tripId, parsed.data);
    announce(req, req.params.tripId, id, true);
    res.status(201).json({ tour: getTourItem(req.params.tripId, id) });
  } catch (e) { fail(res, e); }
});

router.put('/:placeId', authenticate, requireTripAccess, express.json({ limit: '2mb' }), (req: Request, res: Response) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'No permission' });
  const parsed = tourWriteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tour', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
  const placeId = Number(req.params.placeId);
  try {
    updateTour(req.params.tripId, placeId, parsed.data);
    announce(req, req.params.tripId, placeId, false);
    res.json({ tour: getTourItem(req.params.tripId, placeId) });
  } catch (e) { fail(res, e); }
});

router.post('/:placeId/copy', authenticate, requireTripAccess, (req: Request, res: Response) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'No permission' });
  try {
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;
    const id = copyTour(req.params.tripId, Number(req.params.placeId), name);
    announce(req, req.params.tripId, id, true);
    res.status(201).json({ tour: getTourItem(req.params.tripId, id) });
  } catch (e) { fail(res, e); }
});

router.post('/:placeId/restore-recorded', authenticate, requireTripAccess, (req: Request, res: Response) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'No permission' });
  const placeId = Number(req.params.placeId);
  try {
    restoreRecorded(req.params.tripId, placeId);
    announce(req, req.params.tripId, placeId, false);
    res.json({ tour: getTourItem(req.params.tripId, placeId) });
  } catch (e) { fail(res, e); }
});

router.delete('/:placeId', authenticate, requireTripAccess, (req: Request, res: Response) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'No permission' });
  const placeId = Number(req.params.placeId);
  if (!deleteTour(req.params.tripId, placeId)) return res.status(404).json({ error: 'Tour not found' });
  broadcast(req.params.tripId, 'place:deleted', { placeId }, socketId(req));
  broadcast(req.params.tripId, 'tour:deleted', { placeId }, socketId(req));
  res.json({ success: true });
});

export default router;

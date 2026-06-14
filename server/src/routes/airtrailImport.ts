import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { isAddonEnabled } from '../services/adminService';
import { ADDON_IDS } from '../addons';
import { verifyTripAccess } from '../services/reservationService';
import { checkPermission } from '../services/permissions';
import { importAirtrailFlights } from '../services/airtrail/airtrailImport';

const router = express.Router({ mergeParams: true });

/** Gate on the airtrail addon. */
function addonGate(req: Request, res: Response, next: express.NextFunction): void {
  if (!isAddonEnabled(ADDON_IDS.AIRTRAIL)) {
    res.status(404).json({ error: 'AirTrail addon is not enabled' });
    return;
  }
  next();
}

/**
 * POST /api/trips/:tripId/reservations/import/airtrail
 *
 * Turn selected AirTrail flights into reservations in the given trip.
 * Trip-scoped (reservation_edit) and addon-gated. Flights are re-fetched
 * server-side with the caller's own key so the client cannot inject data.
 */
router.post('/', addonGate, authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const { flightIds } = req.body as { flightIds?: string[] };

  if (!flightIds || !Array.isArray(flightIds) || flightIds.length === 0) {
    return res.status(400).json({ error: 'flightIds must be a non-empty array' });
  }

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('reservation_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id)) {
    return res.status(403).json({ error: 'No permission' });
  }

  try {
    const result = await importAirtrailFlights(
      tripId,
      authReq.user.id,
      flightIds,
      req.headers['x-socket-id'] as string | undefined,
    );
    return res.json(result);
  } catch (err: any) {
    const status = err?.status === 400 ? 400 : 502;
    return res.status(status).json({ error: err?.message || 'AirTrail import failed' });
  }
});

export default router;

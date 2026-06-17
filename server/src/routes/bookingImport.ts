import express, { Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { broadcast } from '../websocket';
import { checkPermission } from '../services/permissions';
import { AuthRequest } from '../types';
import { verifyTripAccess, createReservation } from '../services/reservationService';
import { createPlace } from '../services/placeService';
import { searchNominatim } from '../services/mapsService';
import { db } from '../db/database';
import { isKitineraryAvailable, extractBooking } from '../services/kitinerary-extractor';
import { mapReservations } from '../services/kitinerary-mapper';
import type { ParsedBookingItem } from '../services/kitinerary.types';

const router = express.Router({ mergeParams: true });

const ACCEPTED_EXTS = new Set(['.eml', '.pdf', '.pkpass', '.html', '.htm', '.txt']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

// ---------------------------------------------------------------------------
// GET /api/health/features  — served from app.ts via this router too.
// We expose it here for convenience but it is also re-exported at the app level.
// ---------------------------------------------------------------------------

/**
 * POST /api/trips/:tripId/reservations/import/booking
 * Accepts up to 5 booking confirmation files (EML, PDF, PKPass, HTML, TXT).
 * Returns a preview list without persisting anything.
 */
router.post('/booking', authenticate, upload.array('files', MAX_FILES), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('reservation_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id)) {
    return res.status(403).json({ error: 'No permission' });
  }

  if (!isKitineraryAvailable()) {
    return res.status(503).json({ error: 'KItinerary extractor is not available on this server' });
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  // Validate extensions
  for (const f of files) {
    const ext = ('.' + f.originalname.toLowerCase().split('.').pop()) as string;
    if (!ACCEPTED_EXTS.has(ext)) {
      return res.status(400).json({ error: `Unsupported file type: ${f.originalname}. Accepted: EML, PDF, PKPass, HTML, TXT` });
    }
  }

  const allItems: ParsedBookingItem[] = [];
  const allWarnings: string[] = [];

  for (const file of files) {
    let kiItems;
    try {
      kiItems = await extractBooking(file.buffer, file.originalname);
    } catch (err) {
      allWarnings.push(`${file.originalname}: extraction failed — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (kiItems.length === 0) {
      allWarnings.push(`${file.originalname}: no reservations found`);
      continue;
    }

    const { items, warnings } = mapReservations(kiItems, file.originalname);
    allItems.push(...items);
    allWarnings.push(...warnings);
  }

  res.json({ items: allItems, warnings: allWarnings });
});

/**
 * POST /api/trips/:tripId/reservations/import/booking/confirm
 * Persists the user-confirmed subset of parsed items.
 */
router.post('/booking/confirm', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;

  const trip = verifyTripAccess(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!checkPermission('reservation_edit', authReq.user.role, trip.user_id, authReq.user.id, trip.user_id !== authReq.user.id)) {
    return res.status(403).json({ error: 'No permission' });
  }

  const items: ParsedBookingItem[] | undefined = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const socketId = req.headers['x-socket-id'] as string | undefined;
  const created: any[] = [];

  for (const item of items) {
    try {
      const { _venue, _accommodation, source: _src, ...reservationData } = item;

      // Auto-create a place row for venue-based reservations
      let placeId: number | undefined;
      if (_venue?.name) {
        let lat = _venue.lat;
        let lng = _venue.lng;
        if (lat == null && (_venue.address || _venue.name)) {
          try {
            const queries = [
              _venue.address ? `${_venue.name} ${_venue.address}` : null,
              _venue.address ?? null,
              _venue.name,
            ].filter((q): q is string => !!q);

            for (const q of queries) {
              const results = await searchNominatim(q);
              const hit = results[0];
              if (hit?.lat != null && hit?.lng != null) {
                lat = hit.lat;
                lng = hit.lng;
                break;
              }
            }
          } catch {
            // geocoding failure is non-fatal
          }
        }

        const place = createPlace(tripId, {
          name: _venue.name,
          lat,
          lng,
          address: _venue.address,
          website: _venue.website,
          phone: _venue.phone,
        });
        placeId = (place as any).id;
        broadcast(tripId, 'place:created', { place }, socketId);
      }

      // Build create_accommodation for hotel reservations.
      let createAccommodation: { place_id?: number; start_day_id?: number; end_day_id?: number; check_in?: string; check_out?: string; confirmation?: string } | undefined;
      if (item.type === 'hotel' && _accommodation) {
        const startDayId = resolveDayId(tripId, _accommodation.check_in);
        const endDayId   = resolveDayId(tripId, _accommodation.check_out);
        createAccommodation = {
          place_id: placeId,
          start_day_id: startDayId ?? undefined,
          end_day_id:   endDayId   ?? undefined,
          check_in:     _accommodation.check_in,
          check_out:    _accommodation.check_out,
          confirmation: _accommodation.confirmation,
        };
      }

      const { reservation, accommodationCreated } = createReservation(tripId, {
        ...reservationData,
        place_id: placeId,
        create_accommodation: createAccommodation,
      } as any);

      broadcast(tripId, 'reservation:created', { reservation }, socketId);
      if (accommodationCreated) {
        broadcast(tripId, 'accommodation:created', {}, socketId);
      }

      created.push(reservation);
    } catch (err) {
      console.error(`[booking-import] Failed to create reservation "${item.title}":`, err instanceof Error ? err.message : err);
    }
  }

  res.json({ created });
});

function resolveDayId(tripId: string, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const date = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const row = db.prepare('SELECT id FROM days WHERE trip_id = ? AND date = ? LIMIT 1').get(tripId, date) as { id: number } | undefined;
  return row?.id ?? null;
}

export default router;

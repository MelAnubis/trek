import { db } from '../../db/database';
import { getAlbumPhotos, listAlbums } from './immichService';
import { getOrCreateTrekPhoto } from './photoResolverService';
import { createTrip } from '../tripService';
import { createPlace } from '../placeService';
import { createAssignment } from '../assignmentService';
import { createJourney, linkPhotoToEntry } from '../journeyService';
import { reverseGeocode } from '../mapsService';
import { haversineM, saveTrack } from '../../routes/gpxTracks';

/**
 * Imports a Travesía from an Immich album: the photos' own EXIF GPS builds
 * the route, the stops, and the places — no manual entry needed. Reuses the
 * existing Trip->Journey auto-sync pipeline (see journeyService.ts's
 * addTripToJourney/syncTripPlaces) rather than inventing a parallel one:
 * Places, Days and gpx_tracks are all Trip-scoped in this schema, so the
 * import is backed by a real (but pre-archived — see below) Trip, and every
 * existing rendering path (Studio's map/stats/places elements, the PDF
 * export) works on the imported data for free.
 */

export interface ExifPoint {
  assetId: string;
  lat: number;
  lng: number;
  /** ISO timestamp — Immich's own fileCreatedAt/createdAt, already normalized by getAlbumPhotos(). */
  takenAt: string;
}

export interface Stop {
  points: ExifPoint[];
  centroidLat: number;
  centroidLng: number;
  startTime: string;
  endTime: string;
  /** YYYY-MM-DD, from the first point's takenAt. */
  date: string;
}

/**
 * Not user-configurable via a persisted setting yet, but threaded through as
 * per-import overrides at every layer (here, the orchestration function
 * below, and the route) rather than hardcoded inline, so exposing them as a
 * real setting later is additive, not a rewrite.
 */
export const DEFAULT_MAX_GAP_MINUTES = 180;
export const DEFAULT_MAX_RADIUS_METERS = 400;

export interface ClusterOptions {
  maxGapMinutes?: number;
  maxRadiusMeters?: number;
}

/**
 * Groups a journey's photos into stops by GPS proximity — a time gap over
 * `maxGapMinutes` OR a jump past `maxRadiusMeters` from the stop's running
 * centroid starts a new one. Distance is measured from the centroid, not
 * just the previous point, so a slow walk around one plaza (each photo a
 * little further than the last) doesn't fragment into many stops.
 */
export function clusterStops(points: ExifPoint[], opts?: ClusterOptions): Stop[] {
  const maxGapMs = (opts?.maxGapMinutes ?? DEFAULT_MAX_GAP_MINUTES) * 60_000;
  const maxRadiusM = opts?.maxRadiusMeters ?? DEFAULT_MAX_RADIUS_METERS;

  const sorted = [...points].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
  const stops: Stop[] = [];
  let current: ExifPoint[] = [];
  let sumLat = 0;
  let sumLng = 0;

  const flush = () => {
    if (!current.length) return;
    stops.push({
      points: current,
      centroidLat: sumLat / current.length,
      centroidLng: sumLng / current.length,
      startTime: current[0].takenAt,
      endTime: current[current.length - 1].takenAt,
      date: current[0].takenAt.slice(0, 10),
    });
    current = [];
    sumLat = 0;
    sumLng = 0;
  };

  for (const p of sorted) {
    if (current.length) {
      const prev = current[current.length - 1];
      const gapMs = new Date(p.takenAt).getTime() - new Date(prev.takenAt).getTime();
      const distM = haversineM(sumLat / current.length, sumLng / current.length, p.lat, p.lng);
      if (gapMs > maxGapMs || distM > maxRadiusM) flush();
    }
    current.push(p);
    sumLat += p.lat;
    sumLng += p.lng;
  }
  flush();

  return stops;
}

/** ≥1.1s between Nominatim calls — same throttle atlasService.ts's own reverse-geocoding uses. */
let lastNominatimCall = 0;
async function throttleNominatim(): Promise<void> {
  const elapsed = Date.now() - lastNominatimCall;
  if (elapsed < 1100) await new Promise(r => setTimeout(r, 1100 - elapsed));
  lastNominatimCall = Date.now();
}

export interface ImportJourneyOptions extends ClusterOptions {
  title?: string;
}

export interface ImportJourneyResult {
  journeyId: number;
  tripId: number;
  stopCount: number;
  photoCount: number;
}

export async function importJourneyFromAlbum(
  userId: number,
  albumId: string,
  opts: ImportJourneyOptions = {},
): Promise<ImportJourneyResult> {
  const albumsResult = await listAlbums(userId);
  if (albumsResult.error) throw Object.assign(new Error(albumsResult.error), { status: albumsResult.status || 502 });
  const album = albumsResult.albums?.find(a => a.id === albumId);
  if (!album) throw Object.assign(new Error('Album not found'), { status: 404 });

  const photosResult = await getAlbumPhotos(userId, albumId);
  if (photosResult.error) throw Object.assign(new Error(photosResult.error), { status: photosResult.status || 502 });

  const points: ExifPoint[] = (photosResult.assets || [])
    .filter((a: any) => a.lat != null && a.lng != null && a.takenAt)
    .map((a: any) => ({ assetId: a.id, lat: a.lat, lng: a.lng, takenAt: a.takenAt }));

  if (!points.length) throw Object.assign(new Error('No geotagged photos found in this album'), { status: 422 });

  const stops = clusterStops(points, { maxGapMinutes: opts.maxGapMinutes, maxRadiusMeters: opts.maxRadiusMeters });

  // Reverse-geocode each stop's centroid, sequentially (Nominatim usage
  // policy) — a failed lookup falls back to a generic label rather than
  // failing the whole import over one bad geocode.
  const stopNames: string[] = [];
  for (let i = 0; i < stops.length; i++) {
    await throttleNominatim();
    const geo = await reverseGeocode(String(stops[i].centroidLat), String(stops[i].centroidLng)).catch(() => null);
    stopNames.push(geo?.name || `Stop ${i + 1}`);
  }

  const dates = stops.map(s => s.date).sort();
  const title = opts.title?.trim() || album.albumName || 'Immich import';
  const { tripId } = createTrip(userId, { title, start_date: dates[0], end_date: dates[dates.length - 1] });

  // This is imported travel that already happened — mark the backing trip
  // done/archived immediately rather than leaving it to look "upcoming".
  db.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(tripId);

  // createTrip's own generateDays() caps at MAX_TRIP_DAYS — a stop whose
  // date falls past that cutoff (an album spanning an unusually long range)
  // simply has no day to attach to and is skipped below, rather than
  // crashing the import.
  const dayIdByDate = new Map<string, number>();
  for (const row of db.prepare('SELECT id, date FROM days WHERE trip_id = ?').all(tripId) as { id: number; date: string | null }[]) {
    if (row.date) dayIdByDate.set(row.date, row.id);
  }

  const placeIdByStopIndex = new Map<number, number>();
  for (let i = 0; i < stops.length; i++) {
    const dayId = dayIdByDate.get(stops[i].date);
    if (!dayId) continue;
    const place = createPlace(String(tripId), {
      name: stopNames[i],
      lat: stops[i].centroidLat,
      lng: stops[i].centroidLng,
    }) as { id: number };
    createAssignment(dayId, place.id, null);
    placeIdByStopIndex.set(i, place.id);
  }

  // One synthetic GPX track per day that has enough points to draw a route —
  // reuses the same distance/elevation math (computeStats -> saveTrack) a
  // real uploaded GPX file gets, so Studio's map/stats elements and the PDF
  // export render this exactly like a recorded track.
  const pointsByDate = new Map<string, ExifPoint[]>();
  for (const stop of stops) {
    if (!dayIdByDate.has(stop.date)) continue;
    const arr = pointsByDate.get(stop.date) || [];
    arr.push(...stop.points);
    pointsByDate.set(stop.date, arr);
  }
  let sortOrder = 0;
  for (const [date, pts] of pointsByDate) {
    if (pts.length < 2) continue;
    const sortedPts = [...pts].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
    saveTrack(
      tripId, userId, title, 'immich-import',
      sortedPts.map(p => ({ lat: p.lat, lng: p.lng, ele: null, time: p.takenAt })),
      [], sortOrder++, dayIdByDate.get(date),
    );
  }

  // Pull the album's actual photos into the trip's pool. taken_at is set
  // directly from the EXIF already fetched above — no second per-photo
  // Immich round-trip the way resolveAndStoreTakenAt's lazy backfill would need.
  for (const p of points) {
    const trekPhotoId = getOrCreateTrekPhoto('immich', p.assetId, userId);
    db.prepare('UPDATE trek_photos SET taken_at = COALESCE(taken_at, ?) WHERE id = ?').run(p.takenAt, trekPhotoId);
    db.prepare(
      'INSERT OR IGNORE INTO trip_photos (trip_id, user_id, photo_id, shared, album_link_id) VALUES (?, ?, ?, 0, ?)'
    ).run(tripId, userId, trekPhotoId, null);
  }

  // Create the journey linked to the trip — this cascades (addTripToJourney)
  // to skeleton entries per place-with-a-day-assignment and copies the
  // trip's photos into the journey gallery, both automatically.
  const journey = createJourney(userId, { title, trip_ids: [tripId] }) as { id: number };

  // Associate each stop's own photos with its (now-promoted) entry, instead
  // of leaving every imported photo sitting in the gallery unlinked.
  const entryRows = db.prepare(
    'SELECT id, source_place_id FROM journey_entries WHERE journey_id = ? AND source_trip_id = ?'
  ).all(journey.id, tripId) as { id: number; source_place_id: number }[];
  const entryIdByPlaceId = new Map(entryRows.map(e => [e.source_place_id, e.id]));

  const galleryRows = db.prepare(`
    SELECT gp.id as galleryId, tp.asset_id
    FROM journey_photos gp JOIN trek_photos tp ON tp.id = gp.photo_id
    WHERE gp.journey_id = ? AND tp.provider = 'immich'
  `).all(journey.id) as { galleryId: number; asset_id: string }[];
  const galleryIdByAssetId = new Map(galleryRows.map(r => [r.asset_id, r.galleryId]));

  for (let i = 0; i < stops.length; i++) {
    const placeId = placeIdByStopIndex.get(i);
    if (placeId == null) continue;
    const entryId = entryIdByPlaceId.get(placeId);
    if (!entryId) continue;
    for (const p of stops[i].points) {
      const galleryId = galleryIdByAssetId.get(p.assetId);
      if (galleryId != null) linkPhotoToEntry(entryId, galleryId, userId);
    }
  }

  return { journeyId: journey.id, tripId: Number(tripId), stopCount: stops.length, photoCount: points.length };
}

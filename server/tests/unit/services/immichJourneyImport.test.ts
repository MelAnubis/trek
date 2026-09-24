/**
 * Unit/integration tests for immichJourneyImport (IMMICHIMPORT-001 through IMMICHIMPORT-015).
 * clusterStops() is pure and tested directly; importJourneyFromAlbum() is
 * tested against a real in-memory SQLite DB (same harness journeyService.test.ts
 * uses) with the Immich HTTP layer and reverse geocoding mocked at the
 * module boundary — everything downstream (createTrip, createPlace,
 * createAssignment, saveTrack, createJourney, linkPhotoToEntry) runs for real.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

// -- DB setup — same hoisting pattern journeyService.test.ts uses: vi.mock
// factories are hoisted above any top-level const, so the raw DB (a
// node_modules package require, which resolves fine at hoist-time unlike a
// relative project path) has to be built inside vi.hoisted(). Schema and
// migrations are applied afterwards via normal imports in beforeAll below,
// which is why getPlaceWithTags/canAccessTrip/isOwner here are real
// implementations against that DB rather than journeyService.test.ts's own
// stubs — placeService.createPlace() (unlike that file's raw-SQL factories)
// actually calls getPlaceWithTags and needs a working one.

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const getPlaceWithTags = (placeId: number | string) => {
    const place = db.prepare(`
      SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?
    `).get(placeId);
    if (!place) return null;
    const tags = db.prepare('SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?').all(placeId);
    return {
      ...place,
      category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null,
      tags,
    };
  };
  const canAccessTrip = (tripId: number | string, userId: number) => db.prepare(`
    SELECT t.id, t.user_id FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
    WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
  `).get(userId, tripId, userId);
  const isOwner = (tripId: number | string, userId: number) => !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);

  const mock = { db, closeDb: () => {}, reinitialize: () => {}, getPlaceWithTags, canAccessTrip, isOwner };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/websocket', () => ({ broadcastToUser: vi.fn(), broadcast: vi.fn() }));

const mockListAlbums = vi.fn();
const mockGetAlbumPhotos = vi.fn();
vi.mock('../../../src/services/memories/immichService', () => ({
  listAlbums: (...args: unknown[]) => mockListAlbums(...args),
  getAlbumPhotos: (...args: unknown[]) => mockGetAlbumPhotos(...args),
  getAssetInfo: vi.fn(),
  streamImmichAsset: vi.fn(),
  fetchImmichThumbnailBytes: vi.fn(),
}));

const mockReverseGeocode = vi.fn();
vi.mock('../../../src/services/mapsService', () => ({
  reverseGeocode: (...args: unknown[]) => mockReverseGeocode(...args),
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser } from '../../helpers/factories';
import {
  clusterStops, importJourneyFromAlbum, type GeoPoint,
} from '../../../src/services/memories/immichJourneyImport';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  mockListAlbums.mockReset();
  mockGetAlbumPhotos.mockReset();
  mockReverseGeocode.mockReset();
});
afterAll(() => testDb.close());

function point(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return { assetId: 'a', source: 'photo', lat: 48.8584, lng: 2.2945, takenAt: '2026-06-01T10:00:00.000Z', ...overrides };
}

describe('clusterStops', () => {
  it('IMMICHIMPORT-001: photos close in time and place merge into a single stop', () => {
    const pts = [
      point({ assetId: 'a1', takenAt: '2026-06-01T10:00:00.000Z' }),
      point({ assetId: 'a2', takenAt: '2026-06-01T10:05:00.000Z', lat: 48.8586, lng: 2.2947 }),
    ];
    const stops = clusterStops(pts);
    expect(stops).toHaveLength(1);
    expect(stops[0].points.map(p => p.assetId)).toEqual(['a1', 'a2']);
  });

  it('IMMICHIMPORT-002: a time gap past maxGapMinutes splits into two stops even at the same spot', () => {
    const pts = [
      point({ assetId: 'a1', takenAt: '2026-06-01T09:00:00.000Z' }),
      point({ assetId: 'a2', takenAt: '2026-06-01T13:00:00.000Z' }), // 4h later, default threshold is 3h
    ];
    const stops = clusterStops(pts);
    expect(stops).toHaveLength(2);
  });

  it('IMMICHIMPORT-003: a distance jump past maxRadiusMeters splits into two stops even within the time window', () => {
    const pts = [
      point({ assetId: 'a1', lat: 48.8584, lng: 2.2945, takenAt: '2026-06-01T10:00:00.000Z' }),
      point({ assetId: 'a2', lat: 35.6586, lng: 139.7454, takenAt: '2026-06-01T10:05:00.000Z' }), // Tokyo, minutes later
    ];
    const stops = clusterStops(pts);
    expect(stops).toHaveLength(2);
  });

  it('IMMICHIMPORT-004: unsorted input is sorted by takenAt before clustering', () => {
    const pts = [
      point({ assetId: 'later', takenAt: '2026-06-01T10:05:00.000Z' }),
      point({ assetId: 'earlier', takenAt: '2026-06-01T10:00:00.000Z' }),
    ];
    const stops = clusterStops(pts);
    expect(stops[0].points.map(p => p.assetId)).toEqual(['earlier', 'later']);
    expect(stops[0].startTime).toBe('2026-06-01T10:00:00.000Z');
    expect(stops[0].endTime).toBe('2026-06-01T10:05:00.000Z');
  });

  it('IMMICHIMPORT-005: custom thresholds are honoured over the defaults', () => {
    const pts = [
      point({ assetId: 'a1', takenAt: '2026-06-01T10:00:00.000Z' }),
      point({ assetId: 'a2', takenAt: '2026-06-01T10:30:00.000Z' }), // 30 min gap
    ];
    expect(clusterStops(pts)).toHaveLength(1); // under the default 180 min
    expect(clusterStops(pts, { maxGapMinutes: 20 })).toHaveLength(2); // now over threshold
  });

  it('IMMICHIMPORT-006: an empty input returns no stops', () => {
    expect(clusterStops([])).toEqual([]);
  });

  it('IMMICHIMPORT-007: a stop\'s centroid is the mean of its points, not just the first one', () => {
    const stops = clusterStops([
      point({ assetId: 'a1', lat: 48.0, lng: 2.0, takenAt: '2026-06-01T10:00:00.000Z' }),
      point({ assetId: 'a2', lat: 48.002, lng: 2.002, takenAt: '2026-06-01T10:01:00.000Z' }),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].centroidLat).toBeCloseTo(48.001, 5);
    expect(stops[0].centroidLng).toBeCloseTo(2.001, 5);
  });
});

describe('importJourneyFromAlbum', () => {
  function seedAlbum() {
    mockListAlbums.mockResolvedValue({
      albums: [{ id: 'album-1', albumName: 'Test Album', assetCount: 4, startDate: '2026-06-01', endDate: '2026-06-03', albumThumbnailAssetId: null, shared: false }],
    });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [
        { id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', city: null, country: null, lat: 48.8584, lng: 2.2945 },
        { id: 'a2', takenAt: '2026-06-01T10:05:00.000Z', city: null, country: null, lat: 48.8586, lng: 2.2947 },
        { id: 'a3', takenAt: '2026-06-03T14:00:00.000Z', city: null, country: null, lat: 35.6586, lng: 139.7454 },
        { id: 'a4', takenAt: '2026-06-03T14:10:00.000Z', city: null, country: null, lat: 35.6588, lng: 139.7456 },
      ],
    });
    mockReverseGeocode
      .mockResolvedValueOnce({ name: 'Eiffel Tower', address: 'Paris, France' })
      .mockResolvedValueOnce({ name: 'Shibuya Crossing', address: 'Tokyo, Japan' });
  }

  it('IMMICHIMPORT-008: builds a trip (archived), a journey, places, gpx tracks and linked photos from an album with two distinct stops', async () => {
    const { user } = createUser(testDb);
    seedAlbum();

    const result = await importJourneyFromAlbum(user.id, 'album-1', {});
    expect(result.stopCount).toBe(2);
    expect(result.photoCount).toBe(4);
    expect(result.totalAssetCount).toBe(4);
    expect(result.totalDatesInAlbum).toBe(2); // every photo here is geotagged, so this matches stopCount

    const trip = testDb.prepare('SELECT * FROM trips WHERE id = ?').get(result.tripId) as any;
    expect(trip.title).toBe('Test Album');
    expect(trip.is_archived).toBe(1); // marked done — this is already-taken travel, per the user's own request

    // createTrip's own generateDays() spans the whole date range, including
    // the gap day (06-02) between the two stops, with no assignment on it.
    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY date').all(result.tripId) as any[];
    expect(days.map(d => d.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);

    const places = testDb.prepare('SELECT * FROM places WHERE trip_id = ? ORDER BY id').all(result.tripId) as any[];
    expect(places.map(p => p.name)).toEqual(['Eiffel Tower', 'Shibuya Crossing']);
    expect(places[0].lat).toBeCloseTo(48.8585, 3);

    const assignments = testDb.prepare(`
      SELECT da.* FROM day_assignments da JOIN days d ON da.day_id = d.id WHERE d.trip_id = ?
    `).all(result.tripId);
    expect(assignments).toHaveLength(2);

    const tracks = testDb.prepare('SELECT * FROM gpx_tracks WHERE trip_id = ? ORDER BY id').all(result.tripId) as any[];
    expect(tracks).toHaveLength(2);
    expect(tracks[0].point_count).toBe(2);
    expect(tracks[0].total_distance).toBeGreaterThan(0);

    const journey = testDb.prepare('SELECT * FROM journeys WHERE id = ?').get(result.journeyId) as any;
    expect(journey.title).toBe('Test Album');

    const journeyTrips = testDb.prepare('SELECT * FROM journey_trips WHERE journey_id = ? AND trip_id = ?').get(result.journeyId, result.tripId);
    expect(journeyTrips).toBeTruthy();

    const entries = testDb.prepare('SELECT * FROM journey_entries WHERE journey_id = ? ORDER BY entry_date').all(result.journeyId) as any[];
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.location_name)).toEqual(['Eiffel Tower', 'Shibuya Crossing']);
    // Photos linked promote a skeleton entry to a real one.
    expect(entries.every(e => e.type === 'entry')).toBe(true);

    const entryPhotoCounts = entries.map(e =>
      (testDb.prepare('SELECT COUNT(*) as n FROM journey_entry_photos WHERE entry_id = ?').get(e.id) as { n: number }).n
    );
    expect(entryPhotoCounts).toEqual([2, 2]);
  });

  it('IMMICHIMPORT-009: a failed reverse-geocode falls back to a generic "Stop N" label rather than failing the import', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'Test Album', assetCount: 2, startDate: '2026-06-01', endDate: '2026-06-01' }] });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [
        { id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: 48.8584, lng: 2.2945 },
        { id: 'a2', takenAt: '2026-06-01T10:05:00.000Z', lat: 48.8586, lng: 2.2947 },
      ],
    });
    mockReverseGeocode.mockRejectedValue(new Error('nominatim down'));

    const result = await importJourneyFromAlbum(user.id, 'album-1', {});
    const places = testDb.prepare('SELECT * FROM places WHERE trip_id = ?').all(result.tripId) as any[];
    expect(places[0].name).toBe('Stop 1');
  });

  it('IMMICHIMPORT-010: an album with no geotagged photos throws rather than creating an empty trip/journey', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'No GPS Album' }] });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [{ id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: null, lng: null }],
    });

    await expect(importJourneyFromAlbum(user.id, 'album-1', {})).rejects.toThrow();
    expect(testDb.prepare('SELECT COUNT(*) as n FROM trips').get()).toEqual({ n: 0 });
  });

  it('IMMICHIMPORT-011: custom clustering thresholds passed through to the import collapse two otherwise-distinct stops into one', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'One Big Stop' }] });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [
        { id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: 48.8584, lng: 2.2945 },
        { id: 'a2', takenAt: '2026-06-01T10:05:00.000Z', lat: 48.9000, lng: 2.3500 }, // ~5km away — over the default 400m radius
      ],
    });
    mockReverseGeocode.mockResolvedValue({ name: 'Big Stop', address: null });

    const result = await importJourneyFromAlbum(user.id, 'album-1', { maxRadiusMeters: 10000 });
    expect(result.stopCount).toBe(1);
  });

  it('IMMICHIMPORT-012: the album\'s own name is used as the trip/journey title when none is given', async () => {
    const { user } = createUser(testDb);
    seedAlbum();
    const result = await importJourneyFromAlbum(user.id, 'album-1', {});
    const trip = testDb.prepare('SELECT title FROM trips WHERE id = ?').get(result.tripId) as { title: string };
    expect(trip.title).toBe('Test Album');
  });

  it('IMMICHIMPORT-013: an explicit title overrides the album name', async () => {
    const { user } = createUser(testDb);
    seedAlbum();
    const result = await importJourneyFromAlbum(user.id, 'album-1', { title: 'My Custom Trip' });
    const trip = testDb.prepare('SELECT title FROM trips WHERE id = ?').get(result.tripId) as { title: string };
    expect(trip.title).toBe('My Custom Trip');
  });

  it('IMMICHIMPORT-014: an unknown album id throws a 404-flavoured error', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [] });
    await expect(importJourneyFromAlbum(user.id, 'does-not-exist', {})).rejects.toMatchObject({ status: 404 });
  });

  it('IMMICHIMPORT-015: reports totalAssetCount/totalDatesInAlbum even when most of the album\'s photos have no GPS, so a partial import is diagnosable rather than a silent surprise', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'Mostly Ungeotagged Album' }] });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [
        // Day 1: geotagged — becomes a stop.
        { id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: 48.8584, lng: 2.2945 },
        // Days 2-4: present in the album (so they count toward totalDatesInAlbum)
        // but never geotagged — e.g. location services were off, or the
        // photo was re-shared and stripped of EXIF — so they can't become a stop.
        { id: 'a2', takenAt: '2026-06-02T10:00:00.000Z', lat: null, lng: null },
        { id: 'a3', takenAt: '2026-06-03T10:00:00.000Z', lat: null, lng: null },
        { id: 'a4', takenAt: '2026-06-04T10:00:00.000Z', lat: null, lng: null },
      ],
    });
    mockReverseGeocode.mockResolvedValueOnce({ name: 'Eiffel Tower', address: null });

    const result = await importJourneyFromAlbum(user.id, 'album-1', {});
    expect(result.stopCount).toBe(1);
    expect(result.photoCount).toBe(1);
    expect(result.totalAssetCount).toBe(4);
    expect(result.totalDatesInAlbum).toBe(4);
  });

  function gpx(points: { lat: number; lng: number; time: string; ele?: number }[]): string {
    const trkpts = points
      .map(p => `<trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}<time>${p.time}</time></trkpt>`)
      .join('');
    return `<?xml version="1.0"?><gpx><trk><name>Track</name><trkseg>${trkpts}</trkseg></trk></gpx>`;
  }

  it('IMMICHIMPORT-016: an attached GPX track fills a day with no geotagged photo at all', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'GPX Fill' }] });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [{ id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: 48.8584, lng: 2.2945 }],
    });
    mockReverseGeocode
      .mockResolvedValueOnce({ name: 'Eiffel Tower', address: null })
      .mockResolvedValueOnce({ name: 'GPX Stop', address: null });

    const gpxRaw = gpx([
      { lat: 41.4036, lng: 2.1744, time: '2026-06-02T09:00:00.000Z' },
      { lat: 41.4040, lng: 2.1750, time: '2026-06-02T09:05:00.000Z' },
    ]);

    const result = await importJourneyFromAlbum(user.id, 'album-1', {
      gpxFiles: [{ raw: gpxRaw, originalName: 'day2.gpx' }],
    });

    expect(result.stopCount).toBe(2); // photo stop (06-01) + GPX-only stop (06-02)
    expect(result.gpxPointCount).toBe(2);
    expect(result.gpxFilesSkipped).toEqual([]);

    const days = testDb.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY date').all(result.tripId) as any[];
    expect(days.map(d => d.date)).toContain('2026-06-02');

    // Only one track: the 06-01 day has a single photo point (not enough to
    // draw a route on its own), while the GPX-covered 06-02 day has two.
    const tracks = testDb.prepare('SELECT * FROM gpx_tracks WHERE trip_id = ? ORDER BY id').all(result.tripId) as any[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].orig_name).toBe('gpx-import');
    expect(tracks[0].point_count).toBe(2);
  });

  it('IMMICHIMPORT-017: GPX points take priority over photo points for a day\'s saved track when both are present', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'GPX Priority' }] });
    // Two sparse photo points on 06-01 — would normally become the day's track.
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [
        { id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: 48.8584, lng: 2.2945 },
        { id: 'a2', takenAt: '2026-06-01T18:00:00.000Z', lat: 48.8590, lng: 2.2950 },
      ],
    });
    mockReverseGeocode.mockResolvedValue({ name: 'Some Stop', address: null });

    // A denser GPX for the same day (06-01) with 3 points — should win.
    const gpxRaw = gpx([
      { lat: 48.8580, lng: 2.2940, time: '2026-06-01T09:00:00.000Z' },
      { lat: 48.8585, lng: 2.2946, time: '2026-06-01T09:30:00.000Z' },
      { lat: 48.8595, lng: 2.2955, time: '2026-06-01T10:00:00.000Z' },
    ]);

    const result = await importJourneyFromAlbum(user.id, 'album-1', {
      gpxFiles: [{ raw: gpxRaw, originalName: 'day1.gpx' }],
      maxGapMinutes: 24 * 60, // keep photos + GPX in the same stop window
    });

    const tracks = testDb.prepare('SELECT * FROM gpx_tracks WHERE trip_id = ?').all(result.tripId) as any[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].orig_name).toBe('gpx-import');
    expect(tracks[0].point_count).toBe(3); // the GPX's own 3 points, not the 2 photo points
  });

  it('IMMICHIMPORT-018: a GPX file with fewer than 2 usable (timestamped) points is skipped and reported', async () => {
    const { user } = createUser(testDb);
    seedAlbum();

    const singlePointGpx = gpx([{ lat: 10, lng: 10, time: '2026-06-01T10:00:00.000Z' }]);
    const noTimeGpx = '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="10" lon="10"></trkpt><trkpt lat="11" lon="11"></trkpt></trkseg></trk></gpx>';

    const result = await importJourneyFromAlbum(user.id, 'album-1', {
      gpxFiles: [
        { raw: singlePointGpx, originalName: 'too-short.gpx' },
        { raw: noTimeGpx, originalName: 'no-time.gpx' },
      ],
    });

    expect(result.gpxPointCount).toBe(0);
    expect(result.gpxFilesSkipped.sort()).toEqual(['no-time.gpx', 'too-short.gpx']);
  });

  it('IMMICHIMPORT-020: once a GPX is attached to the import, a day with only sparse photo points and no matching GPX gets no per-day track at all — not the old 2-point photo-only fallback', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'Partial GPX Coverage' }] });
    mockGetAlbumPhotos.mockResolvedValue({
      assets: [
        // 06-01: two geotagged photos, but no GPX covers this day.
        { id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: 48.8584, lng: 2.2945 },
        { id: 'a2', takenAt: '2026-06-01T10:05:00.000Z', lat: 48.8586, lng: 2.2947 },
        // 06-03: a photo too, but the attached GPX is what should back this day's track.
        { id: 'a3', takenAt: '2026-06-03T14:00:00.000Z', lat: 41.4036, lng: 2.1744 },
      ],
    });
    mockReverseGeocode.mockResolvedValue({ name: 'Some Stop', address: null });

    const gpxRaw = gpx([
      { lat: 41.4036, lng: 2.1744, time: '2026-06-03T14:00:00.000Z' },
      { lat: 41.4040, lng: 2.1750, time: '2026-06-03T14:10:00.000Z' },
      { lat: 41.4045, lng: 2.1760, time: '2026-06-03T14:20:00.000Z' },
    ]);

    const result = await importJourneyFromAlbum(user.id, 'album-1', {
      gpxFiles: [{ raw: gpxRaw, originalName: 'day3.gpx' }],
    });

    // Both stops (and their places/entries) still exist — this is only
    // about which days get a route track, not about dropping content.
    expect(result.stopCount).toBe(2);

    const tracks = testDb.prepare('SELECT * FROM gpx_tracks WHERE trip_id = ? ORDER BY id').all(result.tripId) as any[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].orig_name).toBe('gpx-import');
    expect(tracks[0].start_lat).toBeCloseTo(41.4036, 3);

    const places = testDb.prepare('SELECT * FROM places WHERE trip_id = ? ORDER BY id').all(result.tripId) as any[];
    expect(places).toHaveLength(2); // day 06-01's place is still created, just with no route track
  });

  it('IMMICHIMPORT-019: an import with only unusable GPX files and no geotagged photos still throws', async () => {
    const { user } = createUser(testDb);
    mockListAlbums.mockResolvedValue({ albums: [{ id: 'album-1', albumName: 'Nothing Usable' }] });
    mockGetAlbumPhotos.mockResolvedValue({ assets: [{ id: 'a1', takenAt: '2026-06-01T10:00:00.000Z', lat: null, lng: null }] });

    const singlePointGpx = gpx([{ lat: 10, lng: 10, time: '2026-06-01T10:00:00.000Z' }]);

    await expect(importJourneyFromAlbum(user.id, 'album-1', {
      gpxFiles: [{ raw: singlePointGpx, originalName: 'too-short.gpx' }],
    })).rejects.toThrow();
    expect(testDb.prepare('SELECT COUNT(*) as n FROM trips').get()).toEqual({ n: 0 });
  });
});

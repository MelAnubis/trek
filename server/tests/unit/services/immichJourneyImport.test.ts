/**
 * Unit/integration tests for immichJourneyImport (IMMICHIMPORT-001 through IMMICHIMPORT-014).
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
  clusterStops, importJourneyFromAlbum, type ExifPoint,
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

function point(overrides: Partial<ExifPoint> = {}): ExifPoint {
  return { assetId: 'a', lat: 48.8584, lng: 2.2945, takenAt: '2026-06-01T10:00:00.000Z', ...overrides };
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
});

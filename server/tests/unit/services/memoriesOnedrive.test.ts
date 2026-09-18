/**
 * Unit tests for memories/oneDriveService — trip date-range filtering and
 * album sync.
 *
 * Regression coverage for two bugs found while reviewing the OneDrive
 * gallery mechanics:
 *  1. searchPhotos() used to fall back to a OneDrive item's upload
 *     (`createdDateTime`) timestamp when EXIF `takenDateTime` was missing,
 *     which let photos with no real capture-date signal match a trip's date
 *     range purely because of when they happened to be uploaded.
 *  2. searchPhotos() computed the `to` boundary as midnight of the end date
 *     instead of end-of-day, silently excluding the whole last day of a trip.
 *  3. syncAlbumAssets() built one malformed Selection object per photo
 *     (`{ assetId, provider }` instead of `{ provider, asset_ids: [...] }`),
 *     so addTripPhotos()'s `for (const raw of selection.asset_ids)` loop threw
 *     on every sync — linking/syncing a OneDrive album added nothing.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`
        SELECT t.id FROM trips t
        LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
        WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
      `).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/websocket', () => ({ broadcast: vi.fn() }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip } from '../../helpers/factories';
import { encrypt_api_key } from '../../../src/services/apiKeyCrypto';
import { searchPhotos, syncAlbumAssets } from '../../../src/services/memories/oneDriveService';

createTables(testDb);
runMigrations(testDb);

function connectOneDrive(userId: number): void {
  testDb.prepare(`
    UPDATE users SET
      onedrive_access_token = ?,
      onedrive_refresh_token = ?,
      onedrive_token_expiry = ?
    WHERE id = ?
  `).run(
    encrypt_api_key('fake-access-token'),
    encrypt_api_key('fake-refresh-token'),
    Math.floor(Date.now() / 1000) + 3600,
    userId,
  );
}

// Drives every Graph call the service makes: children listing for the
// "photos" special folder (search) and for a specific album folder (sync).
// No pagination/subfolders needed for these tests.
function mockGraphFetch(items: any[]) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/me/drive/special/photos/children') || u.includes('/me/drive/items/album-1/children')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: items }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({ value: [] }) } as any;
  });
}

describe('oneDriveService.searchPhotos — trip date-range filtering', () => {
  beforeEach(() => {
    resetTestDb(testDb);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('excludes a photo with no EXIF/filesystem capture date even if its OneDrive upload time falls inside the range', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);

    // Uploaded (createdDateTime) mid-trip, but with no real capture-date
    // signal at all — this is exactly the "unrelated photo shows up" bug.
    const items = [
      {
        id: 'no-exif-1',
        name: 'random.jpg',
        image: { width: 100, height: 100 },
        createdDateTime: '2026-06-15T12:00:00Z',
        // no `photo` facet, no `fileSystemInfo`
      },
    ];
    vi.stubGlobal('fetch', mockGraphFetch(items));

    const result: any = await searchPhotos(user.id, '2026-06-01', '2026-06-30');
    expect(result.assets).toHaveLength(0);
  });

  it('includes a photo whose fileSystemInfo preserves the real capture date even without an EXIF taken date', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);

    const items = [
      {
        id: 'fsinfo-1',
        name: 'synced.jpg',
        image: { width: 100, height: 100 },
        createdDateTime: '2026-09-01T09:00:00Z', // uploaded well after the trip
        fileSystemInfo: { createdDateTime: '2026-06-10T14:30:00Z' },
      },
    ];
    vi.stubGlobal('fetch', mockGraphFetch(items));

    const result: any = await searchPhotos(user.id, '2026-06-01', '2026-06-30');
    expect(result.assets.map((a: any) => a.id)).toEqual(['fsinfo-1']);
    expect(result.assets[0].takenAt).toBe('2026-06-10T14:30:00Z');
  });

  it('includes photos taken late on the trip\'s last day (end-of-day boundary, not midnight)', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);

    const items = [
      {
        id: 'last-day-evening',
        name: 'sunset.jpg',
        photo: { takenDateTime: '2026-06-30T21:45:00Z' },
        image: { width: 100, height: 100 },
        createdDateTime: '2026-06-30T21:45:00Z',
      },
    ];
    vi.stubGlobal('fetch', mockGraphFetch(items));

    const result: any = await searchPhotos(user.id, '2026-06-01', '2026-06-30');
    expect(result.assets.map((a: any) => a.id)).toEqual(['last-day-evening']);
  });

  it('excludes a photo taken the day before the trip starts', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);

    const items = [
      {
        id: 'too-early',
        name: 'before-trip.jpg',
        photo: { takenDateTime: '2026-05-31T23:00:00Z' },
        image: { width: 100, height: 100 },
        createdDateTime: '2026-05-31T23:00:00Z',
      },
    ];
    vi.stubGlobal('fetch', mockGraphFetch(items));

    const result: any = await searchPhotos(user.id, '2026-06-01', '2026-06-30');
    expect(result.assets).toHaveLength(0);
  });
});

describe('oneDriveService.syncAlbumAssets — linking an album to a trip', () => {
  beforeEach(() => {
    resetTestDb(testDb);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('adds every photo in the album to the trip (Selection must group asset_ids, not one per photo)', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    const trip = createTrip(testDb, user.id, { start_date: '2026-06-01', end_date: '2026-06-30' });

    const items = [
      { id: 'album-photo-1', name: 'a.jpg', image: {}, createdDateTime: '2026-06-05T10:00:00Z' },
      { id: 'album-photo-2', name: 'b.jpg', image: {}, createdDateTime: '2026-06-06T10:00:00Z' },
    ];
    vi.stubGlobal('fetch', mockGraphFetch(items));

    const result = await syncAlbumAssets(user.id, String(trip.id), 'album-1', true, undefined);

    expect(result.success).toBe(true);
    expect(result.added).toBe(2);

    const rows = testDb.prepare(`
      SELECT tkp.asset_id FROM trip_photos tp
      JOIN trek_photos tkp ON tkp.id = tp.photo_id
      WHERE tp.trip_id = ? AND tkp.provider = 'onedrive'
    `).all(trip.id) as { asset_id: string }[];
    expect(rows.map(r => r.asset_id).sort()).toEqual(['album-photo-1', 'album-photo-2']);
  });
});

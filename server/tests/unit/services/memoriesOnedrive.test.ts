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
import { searchPhotos, syncAlbumAssets, listAlbums, streamOneDriveAsset, __resetOneDriveIndexCache, __resetOneDriveThumbCache } from '../../../src/services/memories/oneDriveService';

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
    if (u.includes('/me/drive/special/photos/delta') || u.includes('/me/drive/special/photos/children') || u.includes('/me/drive/items/album-1/children')) {
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
    __resetOneDriveIndexCache();
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

// ── The cached photo index (delta first, folder walk as fallback) ─────────────

const ok = (body: any, headers: Record<string, string> = {}) => ({
  ok: true, status: 200, headers: { get: (k: string) => headers[k] ?? null }, json: async () => body,
}) as any;
const fail = (status: number, headers: Record<string, string> = {}) => ({
  ok: false, status, statusText: 'err', headers: { get: (k: string) => headers[k] ?? null }, json: async () => ({ error: { message: `HTTP ${status}` } }),
}) as any;
const photo = (id: string, taken: string, parentId = 'f-root') => ({ id, name: `${id}.jpg`, photo: { takenDateTime: taken }, image: {}, parentReference: { id: parentId } });

describe('oneDriveService — cached photo index', () => {
  beforeEach(() => {
    resetTestDb(testDb);
    __resetOneDriveIndexCache();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ONEDRIVE-IDX-001: follows delta pages, and a second search (or page) reuses the index instead of re-walking', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/me/drive/special/photos/delta?')) return ok({ value: [photo('p1', '2026-04-22T10:00:00Z')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/special/photos/delta(token=abc)' });
      if (u.includes('delta(token=abc)')) return ok({ value: [photo('p2', '2026-04-25T10:00:00Z'), photo('old', '2025-01-01T10:00:00Z')] });
      return ok({ value: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first: any = await searchPhotos(user.id, '2026-04-22', '2026-04-26');
    expect(first.assets.map((a: any) => a.id)).toEqual(['p2', 'p1']); // newest first
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBe(2);

    const again: any = await searchPhotos(user.id, '2026-04-22', '2026-04-26', 2, 1);
    expect(again.assets.map((a: any) => a.id)).toEqual(['p1']);
    expect(fetchMock.mock.calls.length).toBe(calls); // no new Graph calls
  });

  it('ONEDRIVE-IDX-002: when delta is unavailable, falls back to walking the folders (subfolders included)', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/delta')) return fail(400);
      if (u.includes('/me/drive/special/photos/children')) return ok({ value: [{ id: 'sub', name: 'Cid', folder: {} }, photo('top', '2026-04-23T09:00:00Z')] });
      if (u.includes('/me/drive/items/sub/children')) return ok({ value: [photo('deep', '2026-04-24T09:00:00Z', 'sub')] });
      return ok({ value: [] });
    }));
    const res: any = await searchPhotos(user.id, '2026-04-22', '2026-04-26');
    expect(res.assets.map((a: any) => a.id).sort()).toEqual(['deep', 'top']);
  });

  it('ONEDRIVE-IDX-003: a Graph call that never answers is cut off by the timeout instead of hanging the search', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    vi.stubGlobal('fetch', vi.fn(async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }));
    const res: any = await searchPhotos(user.id, '2026-04-22', '2026-04-26');
    expect(res.assets).toEqual([]);
    expect(res.partial).toBe(true);
  });

  it('ONEDRIVE-IDX-004: a throttled (429) answer is retried once after Retry-After', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/me/drive/special/photos/delta')) {
        n++;
        return n === 1 ? fail(429, { 'Retry-After': '0' }) : ok({ value: [photo('p1', '2026-04-22T10:00:00Z')] });
      }
      return ok({ value: [] });
    }));
    const res: any = await searchPhotos(user.id, '2026-04-22', '2026-04-26');
    expect(res.assets.map((a: any) => a.id)).toEqual(['p1']);
    expect(n).toBe(2);
  });

  it('ONEDRIVE-IDX-005: albums come from folders holding photos in the drive index — counted, named, auto-dated folders skipped', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/me/drive/bundles')) return ok({ value: [] });
      if (u.includes('/me/drive/root/delta')) return ok({ value: [
        { id: 'root', name: 'root', folder: {} },
        { id: 'cid', name: 'Camino del Cid', folder: {}, parentReference: { id: 'root' } },
        { id: 'y2026', name: '2026', folder: {}, parentReference: { id: 'root' } },
        { id: 'docs', name: 'Documentos', folder: {}, parentReference: { id: 'root' } },
        photo('a', '2026-04-22T10:00:00Z', 'cid'),
        photo('b', '2026-04-23T10:00:00Z', 'cid'),
        photo('c', '2026-04-23T10:00:00Z', 'y2026'),
        { id: 'pdf', name: 'factura.pdf', file: { mimeType: 'application/pdf' }, parentReference: { id: 'docs' } },
      ] });
      return ok({ value: [] });
    }));
    const res: any = await listAlbums(user.id);
    expect(res.albums).toEqual([{ id: 'cid', name: 'Camino del Cid', count: 2 }]);
  });
});

// ── Thumbnails: one token refresh, bounded concurrency, cached bytes ─────────

function fakeRes() {
  const r: any = { statusCode: 200, headers: {} as Record<string, string>, body: null as any, headersSent: false };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; r.headersSent = true; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.end = (b?: any) => { r.body = b; r.headersSent = true; return r; };
  return r;
}

describe('oneDriveService — thumbnails', () => {
  beforeEach(() => {
    resetTestDb(testDb);
    __resetOneDriveThumbCache();
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  const imgResp = () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as any;

  it('ONEDRIVE-THUMB-001: 30 thumbnails at once never run more than 4 Graph lookups in parallel', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    let inFlight = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('https://graph.microsoft.com') && u.includes('/thumbnails')) {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return ok({ value: [{ large: { url: `https://cdn.example/img-${inFlight}` } }] });
      }
      return imgResp();
    }));
    const resps = Array.from({ length: 30 }, () => fakeRes());
    await Promise.all(resps.map((r, i) => streamOneDriveAsset(r, user.id, `item${i}`, 'thumbnail')));
    expect(peak).toBeLessThanOrEqual(4);
    expect(resps.every(r => r.statusCode === 200 && Buffer.isBuffer(r.body))).toBe(true);
  });

  it('ONEDRIVE-THUMB-002: a second request for the same thumbnail is served from cache', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    const f = vi.fn(async (url: string) => String(url).includes('/thumbnails') ? ok({ value: [{ large: { url: 'https://cdn.example/x' } }] }) : imgResp());
    vi.stubGlobal('fetch', f);
    await streamOneDriveAsset(fakeRes(), user.id, 'same', 'thumbnail');
    const n = f.mock.calls.length;
    const r = fakeRes();
    await streamOneDriveAsset(r, user.id, 'same', 'thumbnail');
    expect(f.mock.calls.length).toBe(n);
    expect(r.statusCode).toBe(200);
  });

  it('ONEDRIVE-THUMB-003: a failed lookup is reported (not a silent 404) and throttling maps to 503', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    vi.stubGlobal('fetch', vi.fn(async () => fail(429, { 'Retry-After': '0' })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = fakeRes();
    await streamOneDriveAsset(r, user.id, 'throttled', 'thumbnail');
    expect(r.statusCode).toBe(503);
    expect(warn.mock.calls.some(c => String(c[0]).includes('throttled'))).toBe(true);
    warn.mockRestore();
  });

  it('ONEDRIVE-THUMB-004: with an expired token, many simultaneous requests share one refresh', async () => {
    const { user } = createUser(testDb);
    connectOneDrive(user.id);
    testDb.prepare('UPDATE users SET onedrive_token_expiry = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 10, user.id);
    let refreshes = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes('/oauth2/v2.0/token')) {
        refreshes++;
        await new Promise(r => setTimeout(r, 10));
        return { ok: true, status: 200, json: async () => ({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 }) } as any;
      }
      if (u.includes('/thumbnails')) return ok({ value: [{ large: { url: 'https://cdn.example/x' } }] });
      return imgResp();
    }));
    await Promise.all(Array.from({ length: 10 }, (_, i) => streamOneDriveAsset(fakeRes(), user.id, `t${i}`, 'thumbnail')));
    expect(refreshes).toBe(1);
  });
});

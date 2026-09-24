/**
 * Journey photo GPS-pin tests (PHOTOGPS-001..005).
 *
 * Covers resolveAndStoreGps (Immich + local EXIF), idempotency (a photo
 * that already has lat/lng is never re-resolved), and that the journey API
 * response actually carries the resolved position through.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

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
    canAccessTrip: () => null,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

// Per-asset-id EXIF GPS the fake Immich returns — set per test. Absent
// entries resolve to an empty exifInfo, matching a photo with no location.
const immichGps = vi.hoisted(() => new Map<string, { lat: number; lng: number }>());
const immichCallCount = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../src/websocket', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), setupWebSocket: vi.fn(), getOnlineUserIds: vi.fn(() => []) }));

vi.mock('../../src/utils/ssrfGuard', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/ssrfGuard')>('../../src/utils/ssrfGuard');
  return {
    ...actual,
    safeFetch: vi.fn((url: string) => {
      const u = String(url);
      const match = /\/api\/assets\/([^/]+)$/.exec(u);
      if (match) {
        immichCallCount.n++;
        const assetId = match[1];
        const gps = immichGps.get(assetId);
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({
            id: assetId,
            fileCreatedAt: '2020-01-01T00:00:00.000Z',
            exifInfo: gps ? { latitude: gps.lat, longitude: gps.lng } : {},
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, json: () => Promise.resolve({}) });
    }),
  };
});

// exifr.parse (taken_at) resolves undefined — not this file's concern.
// exifr.gps resolves to whatever the test queues, same reasoning as
// journeyPhotoTakenAt.test.ts's exifQueue: no real JPEG-with-EXIF fixture needed.
const gpsQueue = vi.hoisted(() => [] as ({ latitude: number; longitude: number } | undefined)[]);
vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(() => Promise.resolve(undefined)),
    gps: vi.fn(() => Promise.resolve(gpsQueue.length ? gpsQueue.shift() : undefined)),
  },
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createJourney, createJourneyEntry } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { encrypt_api_key } from '../../src/services/apiKeyCrypto';
import { resolveAndStoreGps } from '../../src/services/memories/photoResolverService';
import fs from 'fs';
import path from 'path';

const app: Application = createApp();

function connectImmich(userId: number) {
  testDb.prepare('UPDATE users SET immich_url = ?, immich_api_key = ? WHERE id = ?')
    .run('https://immich.example.com', encrypt_api_key('valid-key'), userId);
}

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  immichGps.clear();
  immichCallCount.n = 0;
  gpsQueue.length = 0;
  testDb.prepare(
    "INSERT OR REPLACE INTO addons (id, name, description, type, icon, enabled, sort_order) VALUES ('journey', 'Journey', 'Travel journal', 'global', 'Compass', 1, 35)"
  ).run();
});

describe('resolveAndStoreGps — Immich', () => {
  it('PHOTOGPS-001: an Immich provider photo with EXIF GPS gets its position stored', async () => {
    const { user } = createUser(testDb);
    connectImmich(user.id);
    const journey = createJourney(testDb, user.id);
    immichGps.set('asset-pyrenees', { lat: 42.600223, lng: 0.69924 });

    const res = await request(app)
      .post(`/api/journeys/${journey.id}/gallery/provider-photos`)
      .set('Cookie', authCookie(user.id))
      .send({ provider: 'immich', asset_id: 'asset-pyrenees' });

    expect(res.status).toBe(201);

    const row = testDb.prepare(`
      SELECT tp.lat, tp.lng FROM journey_photos gp JOIN trek_photos tp ON tp.id = gp.photo_id
      WHERE gp.journey_id = ? AND tp.asset_id = ?
    `).get(journey.id, 'asset-pyrenees') as { lat: number; lng: number };
    expect(row.lat).toBeCloseTo(42.600223);
    expect(row.lng).toBeCloseTo(0.69924);
  });

  it('PHOTOGPS-002: resolveAndStoreGps is a no-op (and makes no API call) once lat/lng are already set', async () => {
    const { user } = createUser(testDb);
    connectImmich(user.id);
    const journey = createJourney(testDb, user.id);
    immichGps.set('asset-dup', { lat: 10, lng: 20 });

    const res = await request(app)
      .post(`/api/journeys/${journey.id}/gallery/provider-photos`)
      .set('Cookie', authCookie(user.id))
      .send({ provider: 'immich', asset_id: 'asset-dup' });
    // The route resolves both taken_at and GPS on add, so the fake Immich
    // sees two calls for this one photo — not this test's own concern, but
    // pinned here so the "not called again" assertion below has a real
    // baseline to compare against.
    const callsAfterAdd = immichCallCount.n;
    expect(callsAfterAdd).toBe(2);

    const photoId = testDb.prepare(
      `SELECT tp.id FROM journey_photos gp JOIN trek_photos tp ON tp.id = gp.photo_id WHERE gp.id = ?`
    ).get(res.body.id) as { id: number };

    const again = await resolveAndStoreGps(photoId.id, user.id);
    expect(again).toEqual({ lat: 10, lng: 20 });
    expect(immichCallCount.n).toBe(callsAfterAdd); // not called again
  });

  it('PHOTOGPS-003: an Immich photo with no EXIF GPS leaves lat/lng null rather than throwing', async () => {
    const { user } = createUser(testDb);
    connectImmich(user.id);
    const journey = createJourney(testDb, user.id);
    // 'asset-no-gps' has no entry in immichGps -> empty exifInfo.

    const res = await request(app)
      .post(`/api/journeys/${journey.id}/gallery/provider-photos`)
      .set('Cookie', authCookie(user.id))
      .send({ provider: 'immich', asset_id: 'asset-no-gps' });
    expect(res.status).toBe(201);

    const row = testDb.prepare(`
      SELECT tp.lat, tp.lng FROM journey_photos gp JOIN trek_photos tp ON tp.id = gp.photo_id
      WHERE gp.journey_id = ? AND tp.asset_id = ?
    `).get(journey.id, 'asset-no-gps') as { lat: number | null; lng: number | null };
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
  });
});

describe('resolveAndStoreGps — local EXIF', () => {
  it('PHOTOGPS-004: a local photo upload extracts GPS from EXIF and stores it', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const entry = createJourneyEntry(testDb, journey.id, user.id);

    const uploadsDir = path.join(__dirname, '../../uploads/journey');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `test-gps-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from('not a real jpeg'));

    try {
      gpsQueue.push({ latitude: 48.8566, longitude: 2.3522 });

      const res = await request(app)
        .post(`/api/journeys/entries/${entry.id}/photos`)
        .set('Cookie', authCookie(user.id))
        .attach('photos', path.join(uploadsDir, filename), 'photo.jpg');

      expect(res.status).toBe(201);
      const photoId = res.body.photos[0].photo_id;
      const row = testDb.prepare('SELECT lat, lng FROM trek_photos WHERE id = ?').get(photoId) as { lat: number; lng: number };
      expect(row.lat).toBeCloseTo(48.8566);
      expect(row.lng).toBeCloseTo(2.3522);
    } finally {
      try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch {}
    }
  });

  it('PHOTOGPS-005: a local photo with no GPS EXIF leaves lat/lng null rather than throwing', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const entry = createJourneyEntry(testDb, journey.id, user.id);

    const uploadsDir = path.join(__dirname, '../../uploads/journey');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `test-nogps-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from('not a real jpeg'));

    try {
      // gpsQueue stays empty — exifr.gps() resolves undefined, as it would for a screenshot.
      const res = await request(app)
        .post(`/api/journeys/entries/${entry.id}/photos`)
        .set('Cookie', authCookie(user.id))
        .attach('photos', path.join(uploadsDir, filename), 'photo.jpg');

      expect(res.status).toBe(201);
      const photoId = res.body.photos[0].photo_id;
      const row = testDb.prepare('SELECT lat, lng FROM trek_photos WHERE id = ?').get(photoId) as { lat: number | null; lng: number | null };
      expect(row.lat).toBeNull();
      expect(row.lng).toBeNull();
    } finally {
      try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch {}
    }
  });
});

describe('journey API response', () => {
  it('PHOTOGPS-006: a linked photo\'s lat/lng are exposed on the entry\'s photo list, not just resolved server-side', async () => {
    const { user } = createUser(testDb);
    connectImmich(user.id);
    const journey = createJourney(testDb, user.id);
    const entry = createJourneyEntry(testDb, journey.id, user.id);
    immichGps.set('asset-exposed', { lat: 35.6762, lng: 139.6503 });

    const addRes = await request(app)
      .post(`/api/journeys/entries/${entry.id}/provider-photos`)
      .set('Cookie', authCookie(user.id))
      .send({ provider: 'immich', asset_id: 'asset-exposed' });
    expect(addRes.status).toBe(201);

    const res = await request(app).get(`/api/journeys/${journey.id}`).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    const foundEntry = res.body.entries.find((e: any) => e.id === entry.id);
    expect(foundEntry.photos[0].lat).toBeCloseTo(35.6762);
    expect(foundEntry.photos[0].lng).toBeCloseTo(139.6503);
  });
});

/**
 * POST /api/maps/lodging-near — alojamientos de una localidad. Las fuentes (caché de teselas de OpenStreetMap y
 * Google Places) están simuladas: se prueba la fusión, el orden, los estados y la validación.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Application } from 'express';
import request from 'supertest';

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
    getPlaceWithTags: (placeId: number) => {
      const place: any = db.prepare(`SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`).get(placeId);
      if (!place) return null;
      const tags = db.prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`).all(placeId);
      return { ...place, category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null, tags };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));


const tilesMock = vi.fn();
const googleAvailableMock = vi.fn();
const googleSearchMock = vi.fn();
vi.mock('../../src/services/lodgingTileService', async (orig) => ({
  ...(await orig<typeof import('../../src/services/lodgingTileService')>()),
  getTilePois: (...a: unknown[]) => tilesMock(...a),
}));
vi.mock('../../src/services/googleLodgingService', () => ({
  googleLodgingAvailable: (...a: unknown[]) => googleAvailableMock(...a),
  searchGoogleLodgingNear: (...a: unknown[]) => googleSearchMock(...a),
  resetGoogleLodgingCache: () => {},
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { resetLodgingNearLimiter } from '../../src/routes/maps';
import { similarNames } from '../../src/services/lodgingOptionsService';

const app: Application = createApp();
beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb); loginAttempts.clear(); mfaAttempts.clear(); resetLodgingNearLimiter();
  tilesMock.mockReset(); googleAvailableMock.mockReset(); googleSearchMock.mockReset();
  tilesMock.mockResolvedValue({ pois: [], buckets: 0, failedBuckets: 0, failedTiles: 0, staleTiles: 0, fallbackTiles: 0, errors: [] });
  googleAvailableMock.mockReturnValue(false);
  googleSearchMock.mockResolvedValue([]);
});
afterAll(() => { testDb.close(); });

// Alcaudete (Jaén). 0,001° de latitud ≈ 111 m.
const C = { lat: 37.5912, lng: -4.0888 };
const post = (userId: number, b: object) => request(app).post('/api/maps/lodging-near').set('Cookie', authCookie(userId)).send(b as object);
const osm = (n: number, name: string, dLat = 0) => ({ osm_id: `node:${n}`, name, lat: C.lat + dLat, lng: C.lng });
const tiles = (pois: unknown[], over: Record<string, unknown> = {}) => ({ pois, buckets: 1, failedBuckets: 0, failedTiles: 0, staleTiles: 0, fallbackTiles: 0, errors: [], ...over });

describe('similarNames', () => {
  it('LN-001 — same hotel seen by two sources, ignoring accents, case and decoration', () => {
    expect(similarNames('Hotel Sercotel Alcaudete', 'hotel sercotel alcaudete')).toBe(true);
    expect(similarNames('Hostal El Olivo', 'El Olivo')).toBe(true);
    expect(similarNames('Casa Rural La Fuente', 'Casa rural La Fuente de Alcaudete')).toBe(true);
    expect(similarNames('Pensión Mª José', 'Pension Ma Jose')).toBe(true);
  });
  it('LN-002 — different places are not merged', () => {
    expect(similarNames('Hotel Sercotel', 'Hostal Rey')).toBe(false);
    expect(similarNames('Hotel', '')).toBe(false);
    expect(similarNames('Casa Ana', 'Casa Eva')).toBe(false);
  });
});

describe('POST /maps/lodging-near', () => {
  it('LN-003 — requires auth and valid coordinates / radius', async () => {
    expect((await request(app).post('/api/maps/lodging-near').send(C)).status).toBe(401);
    const { user } = createUser(testDb);
    expect((await post(user.id, {})).status).toBe(400);
    expect((await post(user.id, { lat: 'x', lng: 1 })).status).toBe(400);
    expect((await post(user.id, { lat: 95, lng: 1 })).status).toBe(400);
    expect((await post(user.id, { ...C, radius: 10 })).status).toBe(400);
    expect((await post(user.id, { ...C, radius: 99999 })).status).toBe(400);
    expect(tilesMock).not.toHaveBeenCalled();
  });

  it('LN-004 — OpenStreetMap only: sorted by distance, nameless lodgings dropped, status reported', async () => {
    const { user } = createUser(testDb);
    tilesMock.mockResolvedValue(tiles([osm(1, 'Hotel Lejos', 0.015), osm(2, 'Hostal Centro', 0.001), osm(3, '', 0.002), osm(4, 'Casa Rural Olivo', 0.005)]));
    const r = await post(user.id, C);
    expect(r.status).toBe(200);
    expect(r.body.options.map((o: any) => o.name)).toEqual(['Hostal Centro', 'Casa Rural Olivo', 'Hotel Lejos']);
    expect(r.body.options[0]).toMatchObject({ id: 'osm:node:2', sources: ['osm'], osm_id: 'node:2' });
    expect(r.body.options[0].distance_m).toBeGreaterThan(100); expect(r.body.options[0].distance_m).toBeLessThan(125);
    expect(r.body.sources).toMatchObject({ osm: 'ok', google: 'no-key' });
    expect(r.body.center).toEqual(C);
    expect(r.body.radius_m).toBe(2500);
    // el caché de teselas se consulta con una línea de un punto alrededor del centro
    expect(tilesMock.mock.calls[0][0]).toBe('lodging');
    expect(tilesMock.mock.calls[0][1][0]).toEqual([C.lat, C.lng]);
    expect(tilesMock.mock.calls[0][2]).toBe(2500);
  });

  it('LN-005 — with a Google key, both sources are merged and a hotel present in both appears ONCE with both sources', async () => {
    const { user } = createUser(testDb);
    googleAvailableMock.mockReturnValue(true);
    tilesMock.mockResolvedValue(tiles([osm(1, 'Hotel Sercotel Alcaudete', 0.002)]));
    googleSearchMock.mockResolvedValue([
      { id: 'g1', name: 'Hotel Sercotel Alcaudete', lat: C.lat + 0.0021, lng: C.lng },       // el mismo, a ~10 m
      { id: 'g2', name: 'Casa Rural La Fuente', lat: C.lat + 0.004, lng: C.lng },
    ]);
    const r = await post(user.id, { ...C, radius: 3000 });
    expect(r.body.options).toHaveLength(2);
    expect(r.body.options[0]).toMatchObject({ name: 'Hotel Sercotel Alcaudete', sources: ['osm', 'google'], osm_id: 'node:1', google_place_id: 'g1' });
    expect(r.body.options[1]).toMatchObject({ name: 'Casa Rural La Fuente', sources: ['google'], google_place_id: 'g2', id: 'google:g2' });
    expect(r.body.sources.google).toBe('used');
    expect(googleSearchMock).toHaveBeenCalledWith(user.id, C.lat, C.lng, 3000);
  });

  it('LN-006 — same name but far apart are different places (two "Hostal Central" in different streets of a big town)', async () => {
    const { user } = createUser(testDb);
    googleAvailableMock.mockReturnValue(true);
    tilesMock.mockResolvedValue(tiles([osm(1, 'Hostal Central', 0.001)]));
    googleSearchMock.mockResolvedValue([{ id: 'g1', name: 'Hostal Central', lat: C.lat + 0.02, lng: C.lng }]);   // a ~2,2 km
    const r = await post(user.id, C);
    expect(r.body.options).toHaveLength(2);
  });

  it('LN-007 — a Google failure keeps the OpenStreetMap list and says why', async () => {
    const { user } = createUser(testDb);
    googleAvailableMock.mockReturnValue(true);
    googleSearchMock.mockRejectedValue(Object.assign(new Error('Places API (New) has not been used'), { status: 403 }));
    tilesMock.mockResolvedValue(tiles([osm(1, 'Hostal Centro', 0.001)]));
    const r = await post(user.id, C);
    expect(r.status).toBe(200);
    expect(r.body.options).toHaveLength(1);
    expect(r.body.sources.google).toBe('failed');
    expect(r.body.sources.errors.join(' ')).toContain('Places API (New)');
  });

  it('LN-008 — OpenStreetMap partial / failed is reported, and Google alone still gives options', async () => {
    const { user } = createUser(testDb);
    googleAvailableMock.mockReturnValue(true);
    googleSearchMock.mockResolvedValue([{ id: 'g1', name: 'Hotel Uno', lat: C.lat + 0.001, lng: C.lng }]);
    tilesMock.mockResolvedValue(tiles([], { failedBuckets: 1, failedTiles: 2, errors: ['overpass-api.de: HTTP 504'] }));
    const r = await post(user.id, C);
    expect(r.body.sources.osm).toBe('failed');
    expect(r.body.sources.errors).toContain('overpass-api.de: HTTP 504');
    expect(r.body.options.map((o: any) => o.name)).toEqual(['Hotel Uno']);

    tilesMock.mockResolvedValue(tiles([osm(1, 'Hostal A', 0.001)], { failedBuckets: 1 }));
    expect((await post(user.id, C)).body.sources.osm).toBe('partial');
  });

  it('LN-009 — if the tile service throws, the request still succeeds with the failed status', async () => {
    const { user } = createUser(testDb);
    tilesMock.mockRejectedValue(new Error('db locked'));
    const r = await post(user.id, C);
    expect(r.status).toBe(200);
    expect(r.body.options).toEqual([]);
    expect(r.body.sources.osm).toBe('failed');
  });

  it('LN-010 — at most 40 options, and a per-user hourly limit', async () => {
    const { user } = createUser(testDb); const { user: other } = createUser(testDb);
    tilesMock.mockResolvedValue(tiles(Array.from({ length: 60 }, (_, i) => osm(i + 1, `Alojamiento ${i + 1}`, i * 0.0001))));
    expect((await post(user.id, C)).body.options).toHaveLength(40);
    for (let i = 0; i < 39; i++) expect((await post(user.id, C)).status).toBe(200);
    expect((await post(user.id, C)).status).toBe(429);
    expect((await post(other.id, C)).status).toBe(200);
  });
});

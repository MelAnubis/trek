/**
 * Route planner integration tests — /api/planner (saved routes) and
 * POST /api/maps/pois/along-route. The Overpass call itself is mocked.
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

// Default mock: resolveGoogleMapsUrl rejects with 400 (SSRF-like behaviour for
// URLs that look internal); individual tests override with mockResolvedValueOnce.
const alongMock = vi.fn();
vi.mock('../../src/services/mapsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/mapsService')>()),
  searchOverpassPoisAlongRoute: (...args: unknown[]) => alongMock(...args),
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';

const app: Application = createApp();

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => { resetTestDb(testDb); loginAttempts.clear(); mfaAttempts.clear(); alongMock.mockReset(); });
afterAll(() => { testDb.close(); });

function track(n: number) {
  return Array.from({ length: n }, (_, i) => [40 + i * 0.0001, -3, 500 + (i % 100)]);
}
const body = (over: Record<string, unknown> = {}) => ({
  name: 'Camino', orig_name: 'camino.gpx', points: track(50), cuts: [{ index: 20 }],
  waypoints: [{ id: 'w1', name: 'Fuente', lat: 40.1, lng: -3, type: 'water', osm_id: 'node:1' }],
  settings: { stageKm: 40 }, total_distance_km: 54.5, elevation_gain: 49, elevation_loss: 0, ...over,
});

describe('Planner auth', () => {
  it('PLAN-001 — requires authentication', async () => {
    expect((await request(app).get('/api/planner')).status).toBe(401);
    expect((await request(app).post('/api/planner').send(body())).status).toBe(401);
  });
});

describe('Planner CRUD', () => {
  it('PLAN-002 — create, list (without points) and get (with points)', async () => {
    const { user } = createUser(testDb);
    const c = await request(app).post('/api/planner').set('Cookie', authCookie(user.id)).send(body());
    expect(c.status).toBe(201);
    expect(c.body.route.point_count).toBe(50);
    expect(c.body.route.stage_count).toBe(2);

    const list = await request(app).get('/api/planner').set('Cookie', authCookie(user.id));
    expect(list.body.routes).toHaveLength(1);
    expect(list.body.routes[0].points).toBeUndefined();
    expect(list.body.routes[0].total_distance_km).toBe(54.5);

    const g = await request(app).get(`/api/planner/${c.body.route.id}`).set('Cookie', authCookie(user.id));
    expect(g.status).toBe(200);
    expect(g.body.route.points).toHaveLength(50);
    expect(g.body.route.cuts).toEqual([{ index: 20 }]);
    expect(g.body.route.waypoints[0].osm_id).toBe('node:1');
    expect(g.body.route.settings.stageKm).toBe(40);
  });

  it('PLAN-003 — accepts a large track (≈ 20k points, beyond the global 100kb JSON limit)', async () => {
    const { user } = createUser(testDb);
    const r = await request(app).post('/api/planner').set('Cookie', authCookie(user.id)).send(body({ points: track(20000), cuts: [] }));
    expect(r.status).toBe(201);
    expect(r.body.route.point_count).toBe(20000);
  });

  it('PLAN-004 — partial update keeps points and recomputes stage_count', async () => {
    const { user } = createUser(testDb);
    const c = await request(app).post('/api/planner').set('Cookie', authCookie(user.id)).send(body());
    const id = c.body.route.id;
    const u = await request(app).put(`/api/planner/${id}`).set('Cookie', authCookie(user.id))
      .send({ name: 'Renombrada', cuts: [{ index: 10, name: 'Dos' }, { index: 30 }], waypoints: [] });
    expect(u.status).toBe(200);
    expect(u.body.route.name).toBe('Renombrada');
    expect(u.body.route.stage_count).toBe(3);
    expect(u.body.route.points).toHaveLength(50);
    expect(u.body.route.cuts[0]).toEqual({ index: 10, name: 'Dos' });
    expect(u.body.route.waypoints).toEqual([]);
  });

  it('PLAN-005 — delete', async () => {
    const { user } = createUser(testDb);
    const c = await request(app).post('/api/planner').set('Cookie', authCookie(user.id)).send(body());
    const d = await request(app).delete(`/api/planner/${c.body.route.id}`).set('Cookie', authCookie(user.id));
    expect(d.status).toBe(200);
    expect((await request(app).get(`/api/planner/${c.body.route.id}`).set('Cookie', authCookie(user.id))).status).toBe(404);
  });

  it('PLAN-006 — routes are private to their owner', async () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    const c = await request(app).post('/api/planner').set('Cookie', authCookie(a.id)).send(body());
    const id = c.body.route.id;
    expect((await request(app).get(`/api/planner/${id}`).set('Cookie', authCookie(b.id))).status).toBe(404);
    expect((await request(app).put(`/api/planner/${id}`).set('Cookie', authCookie(b.id)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/planner/${id}`).set('Cookie', authCookie(b.id))).status).toBe(404);
    expect((await request(app).get('/api/planner').set('Cookie', authCookie(b.id))).body.routes).toHaveLength(0);
    expect((await request(app).get(`/api/planner/${id}`).set('Cookie', authCookie(a.id))).status).toBe(200);
  });
});

describe('Planner validation', () => {
  it.each([
    ['missing name', { name: '  ' }],
    ['too few points', { points: track(1) }],
    ['bad coordinate', { points: [[95, 0, null], [1, 1, null]] }],
    ['cut at the start', { cuts: [{ index: 0 }] }],
    ['cut beyond the end', { cuts: [{ index: 49 }] }],
    ['bad waypoint', { waypoints: [{ id: 'x', name: 'y', lat: 'no', lng: 1 }] }],
    ['settings not an object', { settings: [1, 2] }],
  ])('PLAN-007 — rejects %s', async (_label, over) => {
    const { user } = createUser(testDb);
    const r = await request(app).post('/api/planner').set('Cookie', authCookie(user.id)).send(body(over as Record<string, unknown>));
    expect(r.status).toBe(400);
  });

  it('PLAN-008 — replacing points with fewer ones rejects cuts that no longer fit', async () => {
    const { user } = createUser(testDb);
    const c = await request(app).post('/api/planner').set('Cookie', authCookie(user.id)).send(body());
    const u = await request(app).put(`/api/planner/${c.body.route.id}`).set('Cookie', authCookie(user.id)).send({ points: track(10) });
    expect(u.status).toBe(400);
  });
});

describe('POST /maps/pois/along-route', () => {
  const line = [[40, -3], [40.5, -3]];

  it('PLAN-009 — validates input', async () => {
    const { user } = createUser(testDb);
    const post = (b: unknown) => request(app).post('/api/maps/pois/along-route').set('Cookie', authCookie(user.id)).send(b as object);
    expect((await post({ line })).status).toBe(400);
    expect((await post({ category: 'nope', line })).status).toBe(400);
    expect((await post({ category: 'water', line: [[40, -3]] })).status).toBe(400);
    expect((await post({ category: 'water', line: [[200, -3], [1, 1]] })).status).toBe(400);
    expect(alongMock).not.toHaveBeenCalled();
  });

  it('PLAN-010 — returns the service result and forwards radius', async () => {
    const { user } = createUser(testDb);
    alongMock.mockResolvedValueOnce({ pois: [{ osm_id: 'node:9', name: '', lat: 40.2, lng: -3, category: 'water' }], truncated: false });
    const r = await request(app).post('/api/maps/pois/along-route').set('Cookie', authCookie(user.id))
      .send({ category: 'water', line, radius: 1500 });
    expect(r.status).toBe(200);
    expect(r.body.pois[0].osm_id).toBe('node:9');
    expect(alongMock).toHaveBeenCalledWith('water', [[40, -3], [40.5, -3]], 1500);
  });

  it('PLAN-011 — requires authentication and surfaces upstream errors', async () => {
    expect((await request(app).post('/api/maps/pois/along-route').send({ category: 'water', line })).status).toBe(401);
    const { user } = createUser(testDb);
    alongMock.mockRejectedValueOnce(Object.assign(new Error('Overpass request failed'), { status: 502 }));
    const r = await request(app).post('/api/maps/pois/along-route').set('Cookie', authCookie(user.id)).send({ category: 'water', line });
    expect(r.status).toBe(502);
  });
});

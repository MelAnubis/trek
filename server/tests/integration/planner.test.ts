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

// ── Biblioteca: carpetas, favoritos, filtros, paginación y mapa general ───────
async function mk(userId: number, name: string, over: Record<string, unknown> = {}) {
  const r = await request(app).post('/api/planner').set('Cookie', authCookie(userId)).send(body({ name, ...over }));
  expect(r.status).toBe(201);
  return r.body.route as { id: number };
}
const list = (userId: number, qs = '') => request(app).get(`/api/planner${qs}`).set('Cookie', authCookie(userId));

describe('Planner library', () => {
  it('PLAN-030 — stores a ~100 point preview, never the full track, in list rows', async () => {
    const { user } = createUser(testDb);
    await mk(user.id, 'Larga', { points: track(5000), cuts: [] });
    const r = await list(user.id);
    const row = r.body.routes[0];
    expect(row.points).toBeUndefined();
    expect(row.preview.length).toBe(100);
    expect(row.preview[0]).toEqual([40, -3]);
    expect(row.favorite).toBe(false);
    expect(row.folder).toBeNull();
  });

  it('PLAN-031 — search is case-insensitive and treats % and _ literally', async () => {
    const { user } = createUser(testDb);
    await mk(user.id, 'Camino de Santiago'); await mk(user.id, 'Ruta 100%'); await mk(user.id, 'Ruta 1000');
    expect((await list(user.id, '?q=santiago')).body.total).toBe(1);
    expect((await list(user.id, '?q=100%25')).body.routes.map((r: any) => r.name)).toEqual(['Ruta 100%']);
    expect((await list(user.id, '?q=ruta_')).body.total).toBe(0);
  });

  it('PLAN-032 — folders and favourites: set, filter, counters (always over all routes)', async () => {
    const { user } = createUser(testDb);
    const a = await mk(user.id, 'A'); const b = await mk(user.id, 'B'); await mk(user.id, 'C');
    const put = (id: number, data: object) => request(app).put(`/api/planner/${id}`).set('Cookie', authCookie(user.id)).send(data);
    expect((await put(a.id, { folder: ' Verano 2026 ', favorite: true })).status).toBe(200);
    expect((await put(b.id, { folder: 'Verano 2026' })).status).toBe(200);

    const inFolder = await list(user.id, '?folder=' + encodeURIComponent('Verano 2026'));
    expect(inFolder.body.routes.map((r: any) => r.name).sort()).toEqual(['A', 'B']);
    expect((await list(user.id, '?favorite=1')).body.routes.map((r: any) => r.name)).toEqual(['A']);
    expect((await list(user.id, '?unfiled=1')).body.routes.map((r: any) => r.name)).toEqual(['C']);
    // los contadores no dependen del filtro activo
    expect(inFolder.body.folders).toEqual([{ name: 'Verano 2026', count: 2 }]);
    expect(inFolder.body.totals).toEqual({ all: 3, favorites: 1, unfiled: 1 });

    // quitar carpeta con null o ''
    expect((await put(a.id, { folder: null })).body.route.folder).toBeNull();
    expect((await put(b.id, { folder: '   ' })).body.route.folder).toBeNull();
  });

  it('PLAN-033 — organising a route (folder/favourite) does not change its "recent" order; editing does', async () => {
    const { user } = createUser(testDb);
    const a = await mk(user.id, 'A'); await mk(user.id, 'B');
    testDb.prepare("UPDATE planner_routes SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(a.id);
    await request(app).put(`/api/planner/${a.id}`).set('Cookie', authCookie(user.id)).send({ favorite: true, folder: 'X' });
    expect((testDb.prepare('SELECT updated_at FROM planner_routes WHERE id = ?').get(a.id) as any).updated_at).toBe('2020-01-01 00:00:00');
    await request(app).put(`/api/planner/${a.id}`).set('Cookie', authCookie(user.id)).send({ name: 'A2' });
    expect((testDb.prepare('SELECT updated_at FROM planner_routes WHERE id = ?').get(a.id) as any).updated_at).not.toBe('2020-01-01 00:00:00');
  });

  it('PLAN-034 — sorting and server-side pagination', async () => {
    const { user } = createUser(testDb);
    for (let i = 1; i <= 25; i++) await mk(user.id, `Ruta ${String(i).padStart(2, '0')}`, { total_distance_km: i * 10, elevation_gain: 1000 - i });
    const p1 = await list(user.id, '?sort=name&limit=10&page=1');
    expect(p1.body).toMatchObject({ total: 25, pages: 3, page: 1, limit: 10 });
    expect(p1.body.routes.map((r: any) => r.name)[0]).toBe('Ruta 01');
    const p3 = await list(user.id, '?sort=name&limit=10&page=3');
    expect(p3.body.routes).toHaveLength(5);
    expect((await list(user.id, '?sort=distance&limit=3')).body.routes.map((r: any) => r.total_distance_km)).toEqual([250, 240, 230]);
    expect((await list(user.id, '?sort=ascent&limit=2')).body.routes.map((r: any) => r.name)).toEqual(['Ruta 01', 'Ruta 02']);
    // página fuera de rango → se ajusta a la última; sort desconocido → recientes; límite acotado
    expect((await list(user.id, '?limit=10&page=99')).body.page).toBe(3);
    expect((await list(user.id, '?sort=DROP%20TABLE&limit=500')).body.limit).toBe(48);
  });

  it('PLAN-035 — rename, merge and remove a folder', async () => {
    const { user } = createUser(testDb);
    const a = await mk(user.id, 'A', { folder: 'Uno' }); await mk(user.id, 'B', { folder: 'Dos' });
    const put = (data: object) => request(app).put('/api/planner/folders').set('Cookie', authCookie(user.id)).send(data);
    expect((await put({ from: 'Uno', to: 'Tres' })).body.updated).toBe(1);
    expect((await put({ from: 'Tres', to: 'Dos' })).body.updated).toBe(1); // fusiona
    expect((await list(user.id)).body.folders).toEqual([{ name: 'Dos', count: 2 }]);
    expect((await put({ from: 'Dos', to: null })).body.updated).toBe(2); // quita la carpeta, las rutas siguen
    const r = await list(user.id);
    expect(r.body.total).toBe(2);
    expect(r.body.folders).toEqual([]);
    expect((await put({ from: '', to: 'X' })).status).toBe(400);
    expect((await put({ from: 'Dos', to: 'x'.repeat(61) })).status).toBe(400);
    expect(a.id).toBeGreaterThan(0);
  });

  it('PLAN-036 — overview map returns silhouettes honouring filters, only for the owner', async () => {
    const { user } = createUser(testDb); const { user: other } = createUser(testDb);
    await mk(user.id, 'A', { folder: 'F' }); await mk(user.id, 'B'); await mk(other.id, 'Ajena');
    const all = await request(app).get('/api/planner/overview').set('Cookie', authCookie(user.id));
    expect(all.body.routes).toHaveLength(2);
    expect(all.body.routes[0].preview.length).toBeGreaterThan(1);
    expect(all.body.routes[0].points).toBeUndefined();
    const f = await request(app).get('/api/planner/overview?folder=F').set('Cookie', authCookie(user.id));
    expect(f.body.routes.map((r: any) => r.name)).toEqual(['A']);
  });

  it('PLAN-037 — validates folder/favourite, and a user cannot touch another user\'s folders', async () => {
    const { user } = createUser(testDb); const { user: other } = createUser(testDb);
    const a = await mk(user.id, 'A', { folder: 'Mia' });
    const put = (data: object) => request(app).put(`/api/planner/${a.id}`).set('Cookie', authCookie(user.id)).send(data);
    expect((await put({ folder: 5 })).status).toBe(400);
    expect((await put({ folder: 'x'.repeat(61) })).status).toBe(400);
    expect((await put({ favorite: 'yes' })).status).toBe(400);
    const r = await request(app).put('/api/planner/folders').set('Cookie', authCookie(other.id)).send({ from: 'Mia', to: null });
    expect(r.body.updated).toBe(0);
    expect((await list(user.id, '?folder=Mia')).body.total).toBe(1);
    expect((await request(app).get('/api/planner/overview')).status).toBe(401);
  });

  it('PLAN-038 — replacing points refreshes the preview', async () => {
    const { user } = createUser(testDb);
    const a = await mk(user.id, 'A');
    const newPts = Array.from({ length: 30 }, (_, i) => [10 + i * 0.01, 20, null]);
    await request(app).put(`/api/planner/${a.id}`).set('Cookie', authCookie(user.id)).send({ points: newPts, cuts: [] });
    expect((await list(user.id)).body.routes[0].preview[0]).toEqual([10, 20]);
  });
});

// ── Cortes de etapa en poblaciones con alojamiento ────────────────────────────
describe('Planner smart cuts', () => {
  // track(n): 1 punto cada 0,0001° de latitud ≈ 11,12 m → 10000 puntos ≈ 111 km
  const lat = (km: number) => 40 + km / 111.19;
  const lodging = (id: string, km: number) => ({ osm_id: id, name: 'Hotel ' + id, lat: lat(km), lng: -3, category: 'lodging' });
  const smart = (userId: number, id: number, b: object) =>
    request(app).post(`/api/planner/${id}/smart-cuts`).set('Cookie', authCookie(userId)).send(b);

  it('PLAN-060 — moves each cut to a lodging within ±7 km, shorter or longer, and returns point indices', async () => {
    const { user } = createUser(testDb);
    const r0 = await mk(user.id, 'Larga', { points: track(10000), cuts: [] });
    alongMock.mockResolvedValue({ pois: [lodging('a', 52), lodging('b', 70)], truncated: false });   // marca ideal: 55,5 km
    const r = await smart(user.id, r0.id, { stages: 2 });
    expect(r.status).toBe(200);
    expect(r.body.lodgingChecked).toBe(true);
    expect(r.body.cuts).toHaveLength(1);
    const c = r.body.cuts[0];
    expect(c.lodged).toBe(true);
    expect(c.km).toBeGreaterThan(51); expect(c.km).toBeLessThan(53);        // el de 52 km (−3,5), no el de 70 (+14,5)
    expect(c.shiftKm).toBeLessThan(0); expect(c.shiftKm).toBeGreaterThan(-5);
    expect(Number.isInteger(c.index)).toBe(true);
    expect(alongMock.mock.calls[0][0]).toBe('lodging');
  });

  it('PLAN-061 — stageKm and marks modes; marks adjust existing cuts', async () => {
    const { user } = createUser(testDb);
    const r0 = await mk(user.id, 'Larga', { points: track(10000), cuts: [] });
    alongMock.mockResolvedValue({ pois: [lodging('a', 28), lodging('b', 84)], truncated: false });
    const byKm = await smart(user.id, r0.id, { stageKm: 37 });                  // 111/37 = 3 etapas → marcas 37 y 74
    expect(byKm.body.cuts).toHaveLength(2);
    const marks = await smart(user.id, r0.id, { marks: [30, 80] });
    expect(marks.body.cuts.map((c: any) => c.lodged)).toEqual([true, true]);
    expect(Math.round(marks.body.cuts[0].km)).toBe(28);
    expect(Math.round(marks.body.cuts[1].km)).toBe(84);
  });

  it('PLAN-062 — Overpass down: still returns cuts at the ideal marks, flagged as not lodged', async () => {
    const { user } = createUser(testDb);
    const r0 = await mk(user.id, 'Larga', { points: track(10000), cuts: [] });
    alongMock.mockRejectedValue(new Error('Overpass request failed'));
    const r = await smart(user.id, r0.id, { stages: 2 });
    expect(r.status).toBe(200);
    expect(r.body.lodgingChecked).toBe(false);
    expect(r.body.cuts).toHaveLength(1);
    expect(r.body.cuts[0].lodged).toBe(false);
    expect(r.body.cuts[0].km).toBeGreaterThan(54); expect(r.body.cuts[0].km).toBeLessThan(57);
  });

  it('PLAN-063 — validation, one stage means no cuts, and routes are private', async () => {
    const { user } = createUser(testDb); const { user: other } = createUser(testDb);
    const r0 = await mk(user.id, 'Larga', { points: track(10000), cuts: [] });
    expect((await smart(user.id, r0.id, {})).status).toBe(400);
    expect((await smart(user.id, r0.id, { stages: 1 })).status).toBe(400);
    expect((await smart(user.id, r0.id, { stages: 99 })).status).toBe(400);
    expect((await smart(user.id, r0.id, { stageKm: 1 })).status).toBe(400);
    expect((await smart(user.id, r0.id, { marks: [0, 5] })).status).toBe(400);
    expect((await smart(user.id, r0.id, { marks: [500] })).status).toBe(400);
    expect((await smart(user.id, r0.id, { stages: 2, maxShiftKm: 99 })).status).toBe(400);
    const one = await smart(user.id, r0.id, { stageKm: 500 });                    // > longitud: 1 etapa
    expect(one.body.cuts).toEqual([]);
    expect(alongMock).not.toHaveBeenCalled();
    expect((await smart(other.id, r0.id, { stages: 2 })).status).toBe(404);
    expect((await request(app).post(`/api/planner/${r0.id}/smart-cuts`).send({ stages: 2 })).status).toBe(401);
  });

  it('PLAN-064 — stored cuts keep their lodged / shiftKm flags', async () => {
    const { user } = createUser(testDb);
    const r0 = await mk(user.id, 'A');
    const put = await request(app).put(`/api/planner/${r0.id}`).set('Cookie', authCookie(user.id))
      .send({ cuts: [{ index: 10, lodged: true, shiftKm: -3.44, name: 'Dos' }, { index: 30, lodged: false }, { index: 40, lodged: 'x', shiftKm: 'a' }] });
    expect(put.status).toBe(200);
    expect(put.body.route.cuts).toEqual([
      { index: 10, name: 'Dos', lodged: true, shiftKm: -3.4 },
      { index: 30, lodged: false },
      { index: 40 },
    ]);
  });

  it('PLAN-065 — lodging is a valid category of the along-route search', async () => {
    const { user } = createUser(testDb);
    alongMock.mockResolvedValue({ pois: [], truncated: false });
    const r = await request(app).post('/api/maps/pois/along-route').set('Cookie', authCookie(user.id))
      .send({ category: 'lodging', line: [[40, -3], [40.5, -3]] });
    expect(r.status).toBe(200);
  });
});

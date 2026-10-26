/**
 * Tours (de TREK v5) — TOUR-001 …
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Bare in-memory DB — schema applied in beforeAll after mocks register
// ─────────────────────────────────────────────────────────────────────────────
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
      const place: any = db.prepare(`
        SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?
      `).get(placeId);
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
vi.mock('../../src/websocket', () => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
  setupWebSocket: vi.fn(),
  getOnlineUserIds: vi.fn(() => []),
}));
vi.mock('../../src/services/memories/immichService', () => ({
  uploadToImmich: vi.fn(async () => null),
  getImmichCredentials: vi.fn(() => null),
}));
const { askAIText } = vi.hoisted(() => ({ askAIText: vi.fn() }));
vi.mock('../../src/services/aiTextService', () => ({ askAIText }));
const { suggestAndApplyCover } = vi.hoisted(() => ({ suggestAndApplyCover: vi.fn() }));
vi.mock('../../src/services/journeyCoverSuggestService', () => ({ suggestAndApplyCover }));
const { suggestJourneyTitle } = vi.hoisted(() => ({ suggestJourneyTitle: vi.fn() }));
vi.mock('../../src/services/journeyTitleSuggestService', () => ({ suggestJourneyTitle }));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import {
  createUser,
  createAdmin,
  createTrip,
  createJourney,
  createJourneyEntry,
  addJourneyContributor,
  createDay,
} from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  invalidatePermissionsCache();
});
afterAll(() => { testDb.close(); });

const url = (tripId: number, rest = '') => `/api/trips/${tripId}/tours${rest}`;
// A climb north: 50 points, 8 m up each (one 3 m wobble that the noise filter must leave out).
const line = Array.from({ length: 50 }, (_, i) => [41.06 + i * 0.002, -4.72, 800 + i * 8 + (i === 10 ? 3 : 0)] as [number, number, number]);
const wp = (pts: Array<[number, number]>, extra: Record<number, object> = {}) => pts.map(([lat, lng], i) => ({
  lat, lng, sequence: i, role: i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'via', ...(extra[i] || {}),
}));
const body = (o: object = {}) => ({
  name: 'Subida al castillo', tour_type: 'hike', route_geometry: line,
  waypoints: wp([[41.06, -4.72], [41.11, -4.72], [41.158, -4.72]]), duration_seconds: 5400, ...o,
});

describe('Tours', () => {
  it('TOUR-001 — a planned hike is a place of the trip plus its facet: metrics from the line, keys on its points, T2 by default', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const r = await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body());
    expect(r.status).toBe(201);
    const t = r.body.tour;
    expect(t).toMatchObject({ tour_type: 'hike', name: 'Subida al castillo', origin: 'trek', revision: 1, max_hiking_difficulty: 2, duration: 90, has_waypoints: true, planned: false });
    expect(t.distance).toBeCloseTo(10.9, 0);
    expect(t.elevation_gain).toBe(392);
    expect(t.elevation_loss).toBe(0);
    const places = await request(app).get(`/api/trips/${trip.id}/places`).set('Cookie', authCookie(user.id));
    expect(places.body.places.find((p: any) => p.id === t.place_id)).toMatchObject({ tour_type: 'hike', lat: 41.06 });
    const d = await request(app).get(url(trip.id, `/${t.place_id}`)).set('Cookie', authCookie(user.id));
    expect(d.body.waypoints).toHaveLength(3);
    expect(d.body.waypoints.every((w: any) => /^[A-Za-z0-9_-]{6,64}$/.test(w.key))).toBe(true);
    expect(d.body.route_geometry).toHaveLength(50);
    const types = await request(app).get(url(trip.id, '/types')).set('Cookie', authCookie(user.id));
    expect(types.body.tourTypes.filter((x: any) => x.enabled).map((x: any) => x.key)).toEqual(['hike', 'bike', 'run']);
  });

  it('TOUR-002 — the points must run start, via, end in sequence; a bike profile belongs to a bike tour only', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const post = (o: object) => request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body(o));
    expect((await post({ waypoints: wp([[41.06, -4.72], [41.1, -4.72]]).reverse() })).status).toBe(400);
    expect((await post({ bike_profile: 'road' })).status).toBe(400);
    const bike = await post({ tour_type: 'bike', bike_profile: 'gravel', max_hiking_difficulty: 5 });
    expect(bike.status).toBe(201);
    expect(bike.body.tour).toMatchObject({ tour_type: 'bike', bike_profile: 'gravel', max_hiking_difficulty: null });
    const run = await post({ tour_type: 'run', run_profile: 'trail', run_pace_seconds_per_km: 330 });
    expect(run.body.tour).toMatchObject({ run_profile: 'trail', run_pace_seconds_per_km: 330 });
    expect((await post({ tour_type: 'run', run_pace_seconds_per_km: 30 })).status).toBe(400);
  });

  it('TOUR-003 — an edit raises the revision; one based on an old revision is a 409 with the current one', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const id = (await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body())).body.tour.place_id;
    const put = (o: object) => request(app).put(url(trip.id, `/${id}`)).set('Cookie', authCookie(user.id)).send(body(o));
    const a = await put({ name: 'Otra', expected_revision: 1, max_hiking_difficulty: 4, hiking_preferences: { avoid_steps: true, avoid_climbs: false } });
    expect(a.status).toBe(200);
    expect(a.body.tour).toMatchObject({ name: 'Otra', revision: 2, max_hiking_difficulty: 4, hiking_preferences: { avoid_steps: true } });
    const stale = await put({ expected_revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'tour_revision_conflict', revision: 2 });
    expect((await put({})).status).toBe(200);
  });

  it('TOUR-004 — multi-day: stage ends on stops between start and end make stages and their stops', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const pts: Array<[number, number]> = [[41.06, -4.72], [41.08, -4.72], [41.1, -4.72], [41.158, -4.72]];
    const bad = await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body({ waypoints: wp(pts, { 0: { stage_end: true } }) }));
    expect(bad.status).toBe(400);
    const ok = await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body({ waypoints: wp(pts, { 1: { stage_end: true }, 2: { stage_end: true } }) }));
    expect(ok.body.tour.stage_count).toBe(3);
    expect(ok.body.tour.stage_stops.map((s: any) => s.lat)).toEqual([41.06, 41.08, 41.1, 41.158]);
  });

  it('TOUR-005 — GPX: export with heights and points; import with a preview, kept as recorded, estimated by DIN 33466', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const id = (await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body({ name: 'Subida al castillo' }))).body.tour.place_id;
    const g = await request(app).get(url(trip.id, `/${id}/export.gpx`)).set('Cookie', authCookie(user.id));
    expect(g.status).toBe(200);
    expect(g.headers['content-disposition']).toContain('Subida_al_castillo.gpx');
    expect(g.text.match(/<trkpt/g)).toHaveLength(50);
    expect(g.text).toContain('<ele>800</ele>');

    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Grabada</name><trkseg>${line.map(([a, b, e], i) => `<trkpt lat="${a}" lon="${b}"><ele>${e}</ele><time>2026-05-01T08:${String(i).padStart(2, '0')}:00Z</time></trkpt>`).join('')}</trkseg></trk></gpx>`;
    const prev = await request(app).post(url(trip.id, '/import/gpx/preview')).set('Cookie', authCookie(user.id)).attach('file', Buffer.from(gpx), 'ruta.gpx');
    expect(prev.status).toBe(200);
    expect(prev.body.tracks[0]).toMatchObject({ index: 0, name: 'Grabada', point_count: 50, has_heights: true, elevation_gain: 392, started_at: '2026-05-01T08:00:00Z' });
    const imp = await request(app).post(url(trip.id, '/import/gpx')).set('Cookie', authCookie(user.id))
      .field('choices', JSON.stringify([{ index: 0, name: 'Grabada', tour_type: 'hike' }])).attach('file', Buffer.from(gpx), 'ruta.gpx');
    expect(imp.status).toBe(201);
    const t = imp.body.tours[0];
    expect(t).toMatchObject({ origin: 'gpx', origin_file_name: 'ruta.gpx', has_waypoints: false, duration: null, track_ended_at: '2026-05-01T08:49:00Z' });
    expect(t.time_estimate.basis).toBe('din33466');
    expect(t.time_estimate.minutes).toBeGreaterThan(100);
    // Planned over in place, the recorded track is kept and can come back.
    const over = await request(app).put(url(trip.id, `/${t.place_id}`)).set('Cookie', authCookie(user.id)).send(body({ name: 'Grabada' }));
    expect(over.body.tour.has_recorded_track).toBe(true);
    const back = await request(app).post(url(trip.id, `/${t.place_id}/restore-recorded`)).set('Cookie', authCookie(user.id));
    expect(back.body.tour).toMatchObject({ has_waypoints: false, has_recorded_track: false, duration: null });
    expect((await request(app).post(url(trip.id, '/import/gpx/preview')).set('Cookie', authCookie(user.id)).attach('file', Buffer.from('<gpx></gpx>'), 'x.gpx')).status).toBe(422);
  });

  it('TOUR-006 — copy is a tour of its own at revision 1; delete removes the place; strangers see nothing', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const id = (await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body())).body.tour.place_id;
    await request(app).put(url(trip.id, `/${id}`)).set('Cookie', authCookie(user.id)).send(body());
    const c = await request(app).post(url(trip.id, `/${id}/copy`)).set('Cookie', authCookie(user.id)).send({ name: 'Copia' });
    expect(c.body.tour).toMatchObject({ name: 'Copia', revision: 1, has_waypoints: true });
    expect((await request(app).get(url(trip.id)).set('Cookie', authCookie(other.id))).status).toBe(404);
    expect((await request(app).delete(url(trip.id, `/${id}`)).set('Cookie', authCookie(user.id))).status).toBe(200);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM tour_waypoints WHERE place_id = ?').get(id)).toMatchObject({ n: 0 });
    expect((await request(app).get(url(trip.id)).set('Cookie', authCookie(user.id))).body.tours.map((t: any) => t.name)).toEqual(['Copia']);
  });

  it("TOUR-007 — the list says which days a tour is on, and the trip's places carry the tour type and its colour", async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const id = (await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body({ tour_type: 'bike' }))).body.tour.place_id;
    const day = testDb.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, 2, ?)').run(trip.id, '2026-07-02').lastInsertRowid;
    testDb.prepare('INSERT INTO day_assignments (day_id, place_id, order_index) VALUES (?, ?, 0)').run(day, id);
    const list = await request(app).get(url(trip.id)).set('Cookie', authCookie(user.id));
    expect(list.body.tours[0]).toMatchObject({ planned: true, day_numbers: [2] });
    const places = await request(app).get(`/api/trips/${trip.id}/places`).set('Cookie', authCookie(user.id));
    expect(places.body.places.find((p: any) => p.id === id)).toMatchObject({ tour_type: 'bike', category_color: '#2563eb' });
  });

  it('TOUR-008 — a multi-day tour downloads day by day: each stage cut from the one line at its stop', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const pts = wp([[41.06, -4.72], [41.11, -4.72], [41.158, -4.72]], { 1: { stage_end: true, name: 'Refugio' } });
    const id = (await request(app).post(url(trip.id)).set('Cookie', authCookie(user.id)).send(body({ waypoints: pts }))).body.tour.place_id;
    const whole = await request(app).get(url(trip.id, `/${id}/export.gpx`)).set('Cookie', authCookie(user.id));
    const one = await request(app).get(url(trip.id, `/${id}/export.gpx?stage=1`)).set('Cookie', authCookie(user.id));
    const two = await request(app).get(url(trip.id, `/${id}/export.gpx?stage=2`)).set('Cookie', authCookie(user.id));
    const count = (x: string) => (x.match(/<trkpt/g) || []).length;
    expect(one.status).toBe(200);
    expect(count(whole.text)).toBe(50);
    expect(count(one.text) + count(two.text)).toBe(51);
    expect(one.text).toContain('<name>Subida al castillo - 1</name>');
    expect(two.text).toContain('Refugio');
    expect((await request(app).get(url(trip.id, `/${id}/export.gpx?stage=3`)).set('Cookie', authCookie(user.id))).status).toBe(404);
    expect((await request(app).get(url(trip.id, `/${id}/export.gpx?stage=x`)).set('Cookie', authCookie(user.id))).status).toBe(400);
  });
});

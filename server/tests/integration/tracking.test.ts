/**
 * Tracking en vivo (5.7.1) — Trek as an Overland server. Same harness
 * pattern as journeyBook.test.ts.
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

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createTrip, createDay } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

import { broadcastToUser } from '../../src/websocket';

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  invalidatePermissionsCache();
  vi.mocked(broadcastToUser).mockClear();
});
afterAll(() => { testDb.close(); });

const point = (lng: number, lat: number, timestamp: string, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { timestamp, altitude: 30, speed: 5, horizontal_accuracy: 5, vertical_accuracy: -1, motion: ['cycling'], battery_state: 'unplugged', battery_level: 0.8, device_id: 'android-pixel', ...extra },
});
const action = (name: string, timestamp: string) => ({ type: 'Feature', geometry: null, properties: { timestamp, action: name, device_id: 'android-pixel' } });

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function newDevice(userId: number, name = 'Pixel') {
  const res = await request(app).post('/api/tracking/devices').set('Cookie', authCookie(userId)).send({ name });
  expect(res.status).toBe(201);
  return res.body as { device: { id: number; token_hint: string }; token: string };
}
const send = (token: string, locations: unknown[]) =>
  request(app).post('/api/tracking/overland').set('Authorization', `Bearer ${token}`).send({ locations });

describe('Overland receiver', () => {
  it('TRACKING-001 — stores a batch, answers {"result":"ok"} and updates the last position', async () => {
    const { user } = createUser(testDb);
    const { device, token } = await newDevice(user.id);
    expect(token.startsWith('trk_')).toBe(true);
    expect(token.endsWith(device.token_hint)).toBe(true);

    const res = await send(token, [point(-5.84, 43.36, iso(3)), point(-5.83, 43.37, iso(2), { speed: -1, motion: ['driving', 'stationary'] })]);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ok');
    expect(res.body.stored).toBe(2);

    const list = await request(app).get('/api/tracking/devices').set('Cookie', authCookie(user.id));
    const d = list.body.devices[0];
    expect(d.last_position).toMatchObject({ lat: 43.37, lng: -5.83, speed: null, motion: 'driving,stationary' });
    expect(d.battery_level).toBe(0.8);
    expect(d.status).toBe('tracking');
    expect(d.overland_device_id).toBe('android-pixel');
    expect(JSON.stringify(list.body)).not.toContain('token_hash');
    expect(broadcastToUser).toHaveBeenCalledWith(user.id, expect.objectContaining({ type: 'tracking:update' }));
  });

  it('TRACKING-002 — a resent batch is harmless (unique on device + timestamp) and still gets "ok"', async () => {
    const { user } = createUser(testDb);
    const { token } = await newDevice(user.id);
    const batch = [point(-5.84, 43.36, iso(3))];
    await send(token, batch);
    const again = await send(token, batch);
    expect(again.body).toMatchObject({ result: 'ok', stored: 0, duplicates: 1 });
    expect((testDb.prepare('SELECT COUNT(*) n FROM tracking_points').get() as { n: number }).n).toBe(1);
  });

  it('TRACKING-003 — an empty batch (Overland\'s "Test connection") is ok', async () => {
    const { user } = createUser(testDb);
    const { token } = await newDevice(user.id);
    const res = await send(token, []);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ok');
  });

  it('TRACKING-004 — unknown or missing token is refused without "ok", so the phone keeps the batch', async () => {
    const bad = await send('trk_nope', [point(1, 1, iso(1))]);
    expect(bad.status).toBe(401);
    expect(bad.body.result).not.toBe('ok');
    const none = await request(app).post('/api/tracking/overland').send({ locations: [] });
    expect(none.status).toBe(401);
  });

  it('TRACKING-005 — malformed points are dropped, the rest stored; visits are skipped', async () => {
    const { user } = createUser(testDb);
    const { token } = await newDevice(user.id);
    const res = await send(token, [
      point(-5.84, 43.36, iso(5)),
      point(200, 43.36, iso(4)),                       // longitude out of range
      point(-5.84, 43.36, 'not a date'),
      point(-5.84, 43.36, '1970-01-01T00:00:00Z'),     // a phone clock at zero
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-5.8, 43.3] }, properties: { timestamp: iso(3), arrival_date: iso(10), departure_date: iso(3) } },
      'garbage',
    ]);
    expect(res.body).toMatchObject({ result: 'ok', stored: 1, invalid: 4 });
  });

  it('TRACKING-006 — status records: stopped, quiet zone, asleep, and a later point back to tracking', async () => {
    const { user } = createUser(testDb);
    const { device, token } = await newDevice(user.id);
    const status = async () => (await request(app).get('/api/tracking/devices').set('Cookie', authCookie(user.id))).body.devices[0].status;

    await send(token, [point(-5.84, 43.36, iso(10)), action('quiet_zone_entered', iso(9))]);
    expect(await status()).toBe('quiet');
    // A point inside the zone (a trip starting) does not end "quiet"; leaving does.
    await send(token, [point(-5.84, 43.36, iso(8))]);
    expect(await status()).toBe('quiet');
    await send(token, [action('quiet_zone_left', iso(7))]);
    expect(await status()).toBe('tracking');
    await send(token, [action('tracking_stopped', iso(6))]);
    expect(await status()).toBe('stopped');
    // An older status arriving late (offline queue) changes nothing.
    await send(token, [action('sleeping', iso(20))]);
    expect(await status()).toBe('stopped');
    await send(token, [point(-5.83, 43.37, iso(1))]);
    expect(await status()).toBe('tracking');
    expect(device.id).toBeGreaterThan(0);
  });

  it('TRACKING-007 — the token also works in the URL (?token=) and only for its own device', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const { token } = await newDevice(user.id);
    await newDevice(other.id, 'Otro');
    const res = await request(app).post(`/api/tracking/overland?token=${token}`).send({ locations: [point(1, 1, iso(1))] });
    expect(res.body.result).toBe('ok');
    const mine = await request(app).get('/api/tracking/devices').set('Cookie', authCookie(user.id));
    const theirs = await request(app).get('/api/tracking/devices').set('Cookie', authCookie(other.id));
    expect(mine.body.devices[0].last_position).not.toBeNull();
    expect(theirs.body.devices[0].last_position).toBeNull();
  });

  it('TRACKING-008 — a new token replaces the old one at once', async () => {
    const { user } = createUser(testDb);
    const { device, token } = await newDevice(user.id);
    const regen = await request(app).post(`/api/tracking/devices/${device.id}/token`).set('Cookie', authCookie(user.id));
    expect(regen.status).toBe(200);
    expect((await send(token, [])).status).toBe(401);
    expect((await send(regen.body.token, [])).body.result).toBe('ok');
  });
});

describe('Track, history and routes', () => {
  async function withPoints() {
    const { user } = createUser(testDb);
    const { device, token } = await newDevice(user.id);
    await send(token, [
      point(-5.84, 43.36, '2026-10-20T08:00:00Z'),
      point(-5.83, 43.37, '2026-10-20T08:05:00Z', { horizontal_accuracy: 900 }),
      point(-5.82, 43.38, '2026-10-20T08:10:00Z'),
      point(-5.70, 43.40, '2026-10-21T09:00:00Z', { motion: ['walking'] }),
    ]);
    return { user, device };
  }

  it('TRACKING-009 — track for a range, with an accuracy filter and stats', async () => {
    const { user, device } = await withPoints();
    const res = await request(app).get(`/api/tracking/devices/${device.id}/track`)
      .query({ from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' }).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.stats.motion).toBe('cycling');
    expect(res.body.stats.distance_m).toBeGreaterThan(2000);
    const filtered = await request(app).get(`/api/tracking/devices/${device.id}/track`)
      .query({ from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z', max_accuracy: 100 }).set('Cookie', authCookie(user.id));
    expect(filtered.body.total).toBe(2);
  });

  it('TRACKING-010 — days with points, in the viewer\'s time zone', async () => {
    const { user, device } = await withPoints();
    const res = await request(app).get(`/api/tracking/devices/${device.id}/days`).query({ offset: 60 }).set('Cookie', authCookie(user.id));
    expect(res.body.days.map((d: { day: string }) => d.day)).toEqual(['2026-10-21', '2026-10-20']);
    expect(res.body.days[1].points).toBe(3);
  });

  it('TRACKING-011 — GPX download of a range', async () => {
    const { user, device } = await withPoints();
    const res = await request(app).get(`/api/tracking/devices/${device.id}/gpx`)
      .query({ from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' }).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('gpx');
    expect((res.text.match(/<trkpt/g) ?? []).length).toBe(3);
    expect(res.text).toContain('<time>2026-10-20T08:00:00.000Z</time>');
  });

  it('TRACKING-012 — save a range as a trip route (gpx_tracks), on a day of that trip', async () => {
    const { user, device } = await withPoints();
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id, { date: '2026-10-20' });
    const res = await request(app).post(`/api/tracking/devices/${device.id}/save-route`).set('Cookie', authCookie(user.id))
      .send({ from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z', trip_id: trip.id, day_id: day.id, name: 'Covadonga' });
    expect(res.status).toBe(201);
    const row = testDb.prepare('SELECT * FROM gpx_tracks WHERE id = ?').get(res.body.trackId) as Record<string, unknown>;
    expect(row).toMatchObject({ trip_id: trip.id, day_id: day.id, track_name: 'Covadonga', point_count: 3, transport_mode: 'cycling', duration_seconds: 600 });
    expect(Number(row.total_distance)).toBeGreaterThan(0);
  });

  it('TRACKING-013 — saving into someone else\'s trip, or a day of another trip, is refused', async () => {
    const { user, device } = await withPoints();
    const { user: other } = createUser(testDb);
    const foreign = createTrip(testDb, other.id);
    const mine = createTrip(testDb, user.id);
    const otherDay = createDay(testDb, foreign.id);
    const body = { from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' };
    expect((await request(app).post(`/api/tracking/devices/${device.id}/save-route`).set('Cookie', authCookie(user.id)).send({ ...body, trip_id: foreign.id })).status).toBe(404);
    expect((await request(app).post(`/api/tracking/devices/${device.id}/save-route`).set('Cookie', authCookie(user.id)).send({ ...body, trip_id: mine.id, day_id: otherDay.id })).status).toBe(400);
  });

  it('TRACKING-014 — another user cannot read, share or delete my device', async () => {
    const { device } = await withPoints();
    const { user: other } = createUser(testDb);
    const c = authCookie(other.id);
    expect((await request(app).get(`/api/tracking/devices/${device.id}/track`).query({ from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }).set('Cookie', c)).status).toBe(404);
    expect((await request(app).post(`/api/tracking/devices/${device.id}/share`).set('Cookie', c).send({})).status).toBe(404);
    expect((await request(app).delete(`/api/tracking/devices/${device.id}`).set('Cookie', c)).status).toBe(404);
  });

  it('TRACKING-015 — retention drops points past the kept days', async () => {
    const { user, device } = await withPoints();
    const res = await request(app).patch(`/api/tracking/devices/${device.id}`).set('Cookie', authCookie(user.id)).send({ retention_days: 1 });
    expect(res.body.device.retention_days).toBe(1);
    expect((testDb.prepare('SELECT COUNT(*) n FROM tracking_points').get() as { n: number }).n).toBe(0);
  });
});

describe('Public share link', () => {
  it('TRACKING-016 — a link shows the live position and the track since it was made; stopping it ends it', async () => {
    const { user } = createUser(testDb);
    const { device, token } = await newDevice(user.id);
    await send(token, [point(-5.9, 43.3, iso(120))]);
    const share = await request(app).post(`/api/tracking/devices/${device.id}/share`).set('Cookie', authCookie(user.id)).send({ hours: 6, label: 'Juanma en ruta' });
    const link = share.body.device.share.token as string;
    // A few seconds after the link was made (the phone's clock may run slightly ahead).
    await send(token, [point(-5.84, 43.36, iso(-0.1)), action('quiet_zone_entered', iso(-0.2))]);

    const pub = await request(app).get(`/api/tracking/public/${link}`);
    expect(pub.status).toBe(200);
    expect(pub.body.label).toBe('Juanma en ruta');
    expect(pub.body.status).toBe('quiet');
    expect(pub.body.last_position).toMatchObject({ lat: 43.36, lng: -5.84 });
    // Only what came after the link was made.
    expect(pub.body.track).toHaveLength(1);
    expect(JSON.stringify(pub.body)).not.toMatch(/token|user_id/);

    await request(app).delete(`/api/tracking/devices/${device.id}/share`).set('Cookie', authCookie(user.id));
    expect((await request(app).get(`/api/tracking/public/${link}`)).status).toBe(404);
  });

  it('TRACKING-017 — an expired link is gone', async () => {
    const { user } = createUser(testDb);
    const { device } = await newDevice(user.id);
    const share = await request(app).post(`/api/tracking/devices/${device.id}/share`).set('Cookie', authCookie(user.id)).send({ hours: 1 });
    testDb.prepare("UPDATE tracking_devices SET share_expires_at = '2020-01-01T00:00:00.000Z'").run();
    expect((await request(app).get(`/api/tracking/public/${share.body.device.share.token}`)).status).toBe(404);
  });
});

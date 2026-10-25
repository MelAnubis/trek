/**
 * Mejoras del Plan (TREK v5) — PLAN5-001 …: quitar de la ruta, vaciar día y deshacer.
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
  createPlace,
  createDayAssignment,
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


describe('Plan v5', () => {
  it('PLAN5-001 — leave out of route marks the assignment, and the day lists say so', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id, { name: 'Mirador', lat: 41, lng: -4 });
    const a = createDayAssignment(testDb, day.id, place.id);
    const r = await request(app).put(`/api/trips/${trip.id}/assignments/${a.id}/route`).set('Cookie', authCookie(user.id)).send({ excluded: true });
    expect(r.status).toBe(200);
    expect(r.body.assignment).toMatchObject({ id: a.id, route_excluded: true });
    const list = await request(app).get(`/api/trips/${trip.id}/days/${day.id}/assignments`).set('Cookie', authCookie(user.id));
    expect(list.body.assignments[0].route_excluded).toBe(true);
    const days = await request(app).get(`/api/trips/${trip.id}/days`).set('Cookie', authCookie(user.id));
    expect(days.body.days[0].assignments[0]).toMatchObject({ route_excluded: true, place: { tour_type: null } });
    const back = await request(app).put(`/api/trips/${trip.id}/assignments/${a.id}/route`).set('Cookie', authCookie(user.id)).send({ excluded: false });
    expect(back.body.assignment.route_excluded).toBe(false);
  });

  it('PLAN5-002 — clear day takes every place off and hands back what it took; restore puts it back as it was', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id);
    const p1 = createPlace(testDb, trip.id, { name: 'Uno' });
    const p2 = createPlace(testDb, trip.id, { name: 'Dos' });
    createDayAssignment(testDb, day.id, p1.id, { notes: 'café' });
    const a2 = createDayAssignment(testDb, day.id, p2.id);
    testDb.prepare('UPDATE day_assignments SET route_excluded = 1, assignment_time = ? WHERE id = ?').run('10:30', a2.id);
    testDb.prepare('INSERT INTO assignment_participants (assignment_id, user_id) VALUES (?, ?)').run(a2.id, user.id);
    const c = await request(app).delete(`/api/trips/${trip.id}/days/${day.id}/assignments`).set('Cookie', authCookie(user.id));
    expect(c.status).toBe(200);
    expect(c.body.removed.map((r: any) => r.place_id)).toEqual([p1.id, p2.id]);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM day_assignments WHERE day_id = ?').get(day.id)).toMatchObject({ n: 0 });
    // The places stay in the trip.
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM places WHERE trip_id = ?').get(trip.id)).toMatchObject({ n: 2 });
    const r = await request(app).post(`/api/trips/${trip.id}/days/${day.id}/assignments/restore`).set('Cookie', authCookie(user.id)).send({ assignments: c.body.removed });
    expect(r.status).toBe(201);
    expect(r.body.assignments.map((x: any) => x.place.name)).toEqual(['Uno', 'Dos']);
    expect(r.body.assignments[0].notes).toBe('café');
    expect(r.body.assignments[1]).toMatchObject({ route_excluded: true, assignment_time: '10:30' });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM assignment_participants WHERE assignment_id = ?').get(r.body.assignments[1].id)).toMatchObject({ n: 1 });
  });

  it('PLAN5-003 — a stranger cannot clear a day, and restore never brings in places of another trip', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const otherTrip = createTrip(testDb, other.id);
    const day = createDay(testDb, trip.id);
    const foreign = createPlace(testDb, otherTrip.id, { name: 'Ajeno' });
    expect((await request(app).delete(`/api/trips/${trip.id}/days/${day.id}/assignments`).set('Cookie', authCookie(other.id))).status).toBe(404);
    const r = await request(app).post(`/api/trips/${trip.id}/days/${day.id}/assignments/restore`).set('Cookie', authCookie(user.id))
      .send({ assignments: [{ place_id: foreign.id, order_index: 0 }] });
    expect(r.body.assignments).toEqual([]);
  });
});

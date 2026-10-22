/**
 * GET /api/maps/enrich — "about this place". The service itself is unit
 * tested (placeAbout.test.ts); this covers the route: auth, validation and
 * the admin switch.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
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

const about = vi.hoisted(() => ({ enrichPlace: vi.fn(async () => ({ description: null, facts: [], photos: [] })) }));
vi.mock('../../src/services/placeAbout', () => about);

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, setAppSetting } from '../helpers/factories';
import { authCookie } from '../helpers/auth';

const app: Application = createApp();

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => { resetTestDb(testDb); about.enrichPlace.mockClear(); });
afterAll(() => { testDb.close(); });

describe('GET /api/maps/enrich', () => {
  it('ENRICH-001: passes a validated request through, with the language and kind', async () => {
    const { user } = createUser(testDb);
    const res = await request(app).get('/api/maps/enrich').query({ name: 'Alhambra', lat: '37.17', lng: '-3.58', osm_id: 'way:123', lang: 'es', kind: 'Monumento' }).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    expect(about.enrichPlace).toHaveBeenCalledWith({ name: 'Alhambra', lat: 37.17, lng: -3.58, osmId: 'way:123', lang: 'es', kind: 'Monumento' });
  });

  it('ENRICH-002: a malformed osm_id is dropped, and without coordinates the request is refused', async () => {
    const { user } = createUser(testDb);
    const bad = await request(app).get('/api/maps/enrich').query({ name: 'x', osm_id: 'node:1;out' }).set('Cookie', authCookie(user.id));
    expect(bad.status).toBe(400);
    const coords = await request(app).get('/api/maps/enrich').query({ name: 'x', lat: '91', lng: '0' }).set('Cookie', authCookie(user.id));
    expect(coords.status).toBe(400);
    expect(about.enrichPlace).not.toHaveBeenCalled();
  });

  it('ENRICH-003: needs a session', async () => {
    const res = await request(app).get('/api/maps/enrich').query({ name: 'x', lat: '1', lng: '1' });
    expect(res.status).toBe(401);
  });

  it('ENRICH-004: an admin can switch it off; it is on unless set to false', async () => {
    const { user } = createUser(testDb);
    setAppSetting(testDb, 'places_enrich_enabled', 'false');
    const res = await request(app).get('/api/maps/enrich').query({ name: 'x', lat: '1', lng: '1' }).set('Cookie', authCookie(user.id));
    expect(res.body).toEqual({ description: null, facts: [], photos: [], disabled: true });
    expect(about.enrichPlace).not.toHaveBeenCalled();
  });
});

/**
 * POST/GET /api/trips/:id/gpx/nav-photos — geotagged photos taken during
 * live navigation.
 *
 * Regression: the upload read `req.user.userId`, which doesn't exist (the
 * authenticated user has `id`), so user_id went in as NULL into a NOT NULL
 * column and every upload failed with a 500.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import fs from 'fs';
import path from 'path';

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

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createTrip } from '../helpers/factories';
import { authCookie } from '../helpers/auth';

const app: Application = createApp();
// A 1×1 JPEG.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const created: string[] = [];

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => { resetTestDb(testDb); });
afterAll(() => {
  for (const f of created) { try { fs.unlinkSync(path.join(__dirname, '../../uploads/nav-photos', f)); } catch { /* */ } }
  testDb.close();
});

describe('Navigation photos', () => {
  it('NAVPHOTO-001: uploading a geotagged photo stores it under the uploading user and lists it', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .post(`/api/trips/${trip.id}/gpx/nav-photos`)
      .set('Cookie', authCookie(user.id))
      .field('lat', '41.65')
      .field('lng', '-3.68')
      .field('caption', 'Puerto')
      .attach('photo', JPEG, { filename: 'nav.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    created.push(res.body.filename);
    expect(res.body).toMatchObject({ trip_id: trip.id, lat: 41.65, lng: -3.68, caption: 'Puerto' });
    const row = testDb.prepare('SELECT user_id FROM nav_photos WHERE id = ?').get(res.body.id) as { user_id: number };
    expect(row.user_id).toBe(user.id);

    const list = await request(app).get(`/api/trips/${trip.id}/gpx/nav-photos`).set('Cookie', authCookie(user.id));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(res.body.filename);
  });

  it('NAVPHOTO-002: missing coordinates are rejected with 400', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const res = await request(app)
      .post(`/api/trips/${trip.id}/gpx/nav-photos`)
      .set('Cookie', authCookie(user.id))
      .attach('photo', JPEG, { filename: 'nav.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });
});

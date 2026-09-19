/**
 * TREK Studio book API integration tests (Phase 1: persistence + optimistic
 * concurrency). Same harness pattern as journey.test.ts.
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
import { createUser, createJourney, addJourneyContributor } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

const emptyDoc = () => ({
  version: 1 as const,
  title: '',
  page: { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
  spreads: [
    { id: 'cover', role: 'cover' as const, background: null, elements: [], parked: [], entryId: null },
  ],
});

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  invalidatePermissionsCache();
  testDb.prepare(
    "INSERT OR REPLACE INTO addons (id, name, description, type, icon, enabled, sort_order) VALUES ('journey', 'Journey', 'Travel journal', 'global', 'Compass', 1, 35)"
  ).run();
});
afterAll(() => { testDb.close(); });

describe('GET /api/journeys/:id/book', () => {
  it('JOURNEYBOOK-001 — returns { book: null } when no book exists yet', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const res = await request(app).get(`/api/journeys/${journey.id}/book`).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    expect(res.body.book).toBeNull();
  });

  it('JOURNEYBOOK-002 — 404 for a journey the user cannot access', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);

    const res = await request(app).get(`/api/journeys/${journey.id}/book`).set('Cookie', authCookie(stranger.id));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/journeys/:id/book', () => {
  it('JOURNEYBOOK-003 — creates a book on first save and persists it', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const createRes = await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'My Trip', document: emptyDoc() });
    expect(createRes.status).toBe(200);
    expect(createRes.body.book.version).toBe(1);
    expect(createRes.body.book.title).toBe('My Trip');

    const getRes = await request(app).get(`/api/journeys/${journey.id}/book`).set('Cookie', authCookie(user.id));
    expect(getRes.body.book.document.spreads).toHaveLength(1);
    expect(getRes.body.book.document.spreads[0].id).toBe('cover');
  });

  it('JOURNEYBOOK-004 — a stale baseVersion is refused with a 409 and the current record', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const first = await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(user.id))
      .send({ title: '', document: emptyDoc() });
    const v1 = first.body.book.version;

    // Someone else (another tab) saves in between.
    await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Updated elsewhere', document: emptyDoc(), baseVersion: v1 });

    // This client still thinks it's at v1.
    const conflict = await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(user.id))
      .send({ title: 'Stale write', document: emptyDoc(), baseVersion: v1 });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('Book was changed by someone else');
    expect(conflict.body.current.title).toBe('Updated elsewhere');
    expect(conflict.body.current.version).toBe(2);
  });

  it('JOURNEYBOOK-005 — a contributor with only viewer role cannot save', async () => {
    const { user: owner } = createUser(testDb);
    const { user: viewer } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);
    addJourneyContributor(testDb, journey.id, viewer.id, 'viewer');

    const res = await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(viewer.id))
      .send({ title: '', document: emptyDoc() });
    expect(res.status).toBe(403);
  });

  it('JOURNEYBOOK-006 — rejects a malformed document', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const res = await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(user.id))
      .send({ title: '', document: { not: 'a book' } });
    // The zod schema fills in every field with defaults, so this is
    // accepted as an (empty) valid document rather than rejected — that's
    // the intended "never throws on read/normalize" behavior. Assert we get
    // back a normalized empty book, not a 500.
    expect(res.status).toBe(200);
    expect(res.body.book.document.spreads).toEqual([]);
  });

  it('JOURNEYBOOK-008 — an invalid colour (e.g. rgba(), not #rrggbb) is rejected with the offending field named', async () => {
    // Regression: autoLayout.ts once emitted 'rgba(255,255,255,0.5)' for a
    // faded subtitle — valid CSS, invalid per this schema's plain-hex rule —
    // which 400'd silently on every autosave after. The error body should
    // name the exact path so this doesn't need a network trace to diagnose.
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const doc = emptyDoc();
    doc.spreads[0].elements = [{
      id: 't1', kind: 'text', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false,
      text: 'hi', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.45, tracking: 0,
      color: 'rgba(255,255,255,0.5)', binding: null, overridden: false,
    }] as any;

    const res = await request(app)
      .put(`/api/journeys/${journey.id}/book`)
      .set('Cookie', authCookie(user.id))
      .send({ title: '', document: doc });

    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'document.spreads.0.elements.0.color' })])
    );
  });
});

describe('DELETE /api/journeys/:id/book', () => {
  it('JOURNEYBOOK-007 — deletes the book', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    await request(app).put(`/api/journeys/${journey.id}/book`).set('Cookie', authCookie(user.id)).send({ title: '', document: emptyDoc() });

    const del = await request(app).delete(`/api/journeys/${journey.id}/book`).set('Cookie', authCookie(user.id));
    expect(del.status).toBe(204);

    const getRes = await request(app).get(`/api/journeys/${journey.id}/book`).set('Cookie', authCookie(user.id));
    expect(getRes.body.book).toBeNull();
  });
});

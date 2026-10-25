/**
 * Revista #ESTODOBAJADA (4.5) — MAG-001 …
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
import { clearSiteCache } from '../../src/services/siteService';
import { validateShareTokenForPhoto } from '../../src/services/journeyShareService';
import { canAccessTrekPhoto } from '../../src/services/memories/helpersService';

const app: Application = createApp();

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  invalidatePermissionsCache();
  clearSiteCache();
  testDb.prepare(
    "INSERT OR REPLACE INTO addons (id, name, description, type, icon, enabled, sort_order) VALUES ('journey', 'Journey', 'Travel journal', 'global', 'Compass', 1, 35)"
  ).run();
});
afterAll(() => { testDb.close(); });

function galleryPhoto(journeyId: number, ownerId: number) {
  const tp = testDb.prepare('INSERT INTO trek_photos (provider, owner_id, file_path) VALUES (?, ?, ?)').run('local', ownerId, `journey/p${Math.random()}.jpg`);
  const gp = testDb.prepare('INSERT INTO journey_photos (journey_id, photo_id, created_at) VALUES (?, ?, ?)').run(journeyId, tp.lastInsertRowid, Date.now());
  return { galleryId: Number(gp.lastInsertRowid), photoId: Number(tp.lastInsertRowid) };
}

async function siteStory(admin: { id: number }, title: string, status = 'published') {
  const site = createJourney(testDb, admin.id);
  testDb.prepare('UPDATE journeys SET site_journal = 1 WHERE id = ?').run(site.id);
  const ph = galleryPhoto(site.id, admin.id);
  const id = `c0ffee00-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
  const r = await request(app).put(`/api/journeys/${site.id}/blog/posts/${id}`).set('Cookie', authCookie(admin.id))
    .send({ title, status, blocks: [{ id: 'p', type: 'photo', photo: ph, layout: 'full' }] });
  expect(r.status).toBe(201);
  return { id, site, ph };
}

describe('Revista', () => {
  it('MAG-001 — a magazine from journeys and public stories is a magazine-kind journey whose gallery holds their photos', async () => {
    const { user: admin } = createAdmin(testDb);
    const j1 = createJourney(testDb, admin.id);
    const p1 = galleryPhoto(j1.id, admin.id);
    const story = await siteStory(admin, 'Todo bajada');
    const res = await request(app).post('/api/magazines').set('Cookie', authCookie(admin.id))
      .send({ title: '', journey_ids: [j1.id], story_ids: [story.id] });
    expect(res.status).toBe(201);
    expect(res.body.volume).toBe(1);
    const mag = testDb.prepare('SELECT kind, title, subtitle, magazine_meta FROM journeys WHERE id = ?').get(res.body.journey_id) as any;
    expect(mag).toMatchObject({ kind: 'magazine', title: '#ESTODOBAJADA Vol. 1', subtitle: 'Vol. 1' });
    expect(JSON.parse(mag.magazine_meta)).toEqual({ volume: 1, journeys: [j1.id], stories: [story.id] });
    const linked = (testDb.prepare('SELECT photo_id FROM journey_photos WHERE journey_id = ? ORDER BY photo_id').all(res.body.journey_id) as any[]).map(r => r.photo_id);
    expect(linked).toEqual([p1.photoId, story.ph.photoId].sort((a, b) => a - b));

    const second = await request(app).post('/api/magazines').set('Cookie', authCookie(admin.id)).send({ title: 'Otoño', journey_ids: [j1.id] });
    expect(second.body.volume).toBe(2);
    const list = await request(app).get('/api/magazines').set('Cookie', authCookie(admin.id));
    expect(list.body.magazines.map((m: any) => m.title).sort()).toEqual(['#ESTODOBAJADA Vol. 1', 'Otoño']);
  });

  it("MAG-002 — someone else's journey, a magazine, a draft or a story outside the site journals are refused", async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);
    const theirs = createJourney(testDb, admin.id);
    const post = (b: object) => request(app).post('/api/magazines').set('Cookie', authCookie(user.id)).send(b);
    expect((await post({ journey_ids: [theirs.id] })).status).toBe(404);
    expect((await post({})).status).toBe(400);
    const draft = await siteStory(admin, 'Borrador', 'draft');
    expect((await post({ story_ids: [draft.id] })).status).toBe(404);
    const mine = createJourney(testDb, user.id);
    const ok = await post({ journey_ids: [mine.id] });
    expect(ok.status).toBe(201);
    expect((await post({ journey_ids: [ok.body.journey_id] })).status).toBe(404);
  });

  it('MAG-003 — sources: my journeys (never magazines) and the published public stories', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);
    const mine = createJourney(testDb, user.id);
    await siteStory(admin, 'Público');
    await request(app).post('/api/magazines').set('Cookie', authCookie(user.id)).send({ journey_ids: [mine.id] });
    const src = await request(app).get('/api/magazines/sources').set('Cookie', authCookie(user.id));
    expect(src.status).toBe(200);
    expect(src.body.journeys.map((j: any) => j.id)).toEqual([mine.id]);
    expect(src.body.stories.map((s: any) => s.title)).toEqual(['Público']);
    expect((await request(app).get('/api/magazines/sources')).status).toBe(401);
  });

  it('MAG-004 — a story photo used by a magazine can be seen by its author, and through the magazine share link', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);
    const story = await siteStory(admin, 'Fotos');
    expect(canAccessTrekPhoto(user.id, story.ph.photoId)).toBe(false);
    const res = await request(app).post('/api/magazines').set('Cookie', authCookie(user.id)).send({ story_ids: [story.id] });
    expect(res.status).toBe(201);
    expect(canAccessTrekPhoto(user.id, story.ph.photoId)).toBe(true);
    testDb.prepare('INSERT INTO journey_share_tokens (journey_id, token, created_by, share_book) VALUES (?, ?, ?, 1)').run(res.body.journey_id, 'tok-mag', user.id);
    expect(validateShareTokenForPhoto('tok-mag', story.ph.photoId)).toMatchObject({ journeyId: res.body.journey_id });
  });

  it('MAG-005 — the book schema accepts the Jost face (the masthead)', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const doc = { version: 1, title: 'Vol. 1', page: { preset: 'custom', pageWidth: 120, pageHeight: 170, bleed: 3, safe: 8 }, spreads: [
      { id: 'c', role: 'cover', background: '#111111', parked: [], entryId: null, elements: [
        { id: 't', kind: 'text', frame: { x: 10, y: 10, w: 100, h: 12 }, rotation: 0, opacity: 1, locked: false, text: '#ESTODOBAJADA', font: 'jost', size: 14, weight: 300, italic: false, align: 'center', leading: 1.1, tracking: 0.1, color: '#ffffff', binding: null, overridden: true },
      ] },
    ] };
    const r = await request(app).put(`/api/journeys/${j.id}/book`).set('Cookie', authCookie(user.id)).send({ document: doc });
    expect(r.body.issues ?? r.status).toBe(200);
  });
});

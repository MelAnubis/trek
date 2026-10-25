/**
 * Zona pública #ESTODOBAJADA (4.4) — SITE-001 …
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
import { clearSiteCache, sitePhotoOwner } from '../../src/services/siteService';

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

function track(tripId: number, userId: number, dayId: number | null, pts: [number, number, number][]) {
  testDb.prepare(`INSERT INTO gpx_tracks (trip_id, user_id, track_name, total_distance, total_elevation_gain, total_elevation_loss, max_elevation, point_count, points_json, day_id, sort_order)
    VALUES (?, ?, 'Etapa', 12.5, 640, 120, 1180, ?, ?, ?, 0)`)
    .run(tripId, userId, pts.length, JSON.stringify(pts.map(([lat, lng, ele]) => ({ lat, lng, ele }))), dayId);
}
const line: [number, number, number][] = Array.from({ length: 50 }, (_, i) => [41.06 + i * 0.002, -4.72 + i * 0.001, 800 + i * 8]);

function galleryPhoto(journeyId: number, ownerId: number) {
  const tp = testDb.prepare('INSERT INTO trek_photos (provider, owner_id, file_path) VALUES (?, ?, ?)').run('local', ownerId, `journey/p${Math.random()}.jpg`);
  const gp = testDb.prepare('INSERT INTO journey_photos (journey_id, photo_id, created_at) VALUES (?, ?, ?)').run(journeyId, tp.lastInsertRowid, Date.now());
  return { galleryId: Number(gp.lastInsertRowid), photoId: Number(tp.lastInsertRowid) };
}

describe('Zona pública', () => {
  it('SITE-001 — only trips marked public show up, without login, with stats, line and profile but no private data', async () => {
    const { user } = createUser(testDb);
    const pub = createTrip(testDb, user.id, { title: 'Circular de Arévalo' });
    const priv = createTrip(testDb, user.id, { title: 'Secreto' });
    const d1 = createDay(testDb, pub.id, { day_number: 1 });
    track(pub.id, user.id, d1.id, line);
    track(priv.id, user.id, null, line);
    const on = await request(app).put(`/api/trips/${pub.id}`).set('Cookie', authCookie(user.id)).send({ is_public: true });
    expect(on.status).toBe(200);

    const home = await request(app).get('/api/site');
    expect(home.status).toBe(200);
    expect(home.body.routes).toHaveLength(1);
    const r = home.body.routes[0];
    expect(r).toMatchObject({ id: pub.id, title: 'Circular de Arévalo', distance_km: 12.5, gain_m: 640, days: 1 });
    expect(r.profile.length).toBeGreaterThan(10);
    expect(r.profile[r.profile.length - 1][1]).toBe(800 + 49 * 8);
    expect(r.lines[0].length).toBeGreaterThan(10);
    expect(JSON.stringify(home.body)).not.toMatch(/Secreto|email|password/);

    const detail = await request(app).get(`/api/site/routes/${pub.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.stages[0]).toMatchObject({ day_number: 1, distance_km: 12.5 });
    expect((await request(app).get(`/api/site/routes/${priv.id}`)).status).toBe(404);
  });

  it('SITE-002 — the GPX needs an account; anyone logged in can download a public trip, nobody a private one', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const pub = createTrip(testDb, user.id, { title: 'Ruta' });
    const priv = createTrip(testDb, user.id, { title: 'Privada' });
    track(pub.id, user.id, null, line);
    testDb.prepare('UPDATE trips SET is_public = 1 WHERE id = ?').run(pub.id);
    expect((await request(app).get(`/api/site/routes/${pub.id}/gpx`)).status).toBe(401);
    const g = await request(app).get(`/api/site/routes/${pub.id}/gpx`).set('Cookie', authCookie(other.id));
    expect(g.status).toBe(200);
    expect(g.headers['content-type']).toMatch(/gpx/);
    expect(g.text).toContain('<trkpt');
    expect((await request(app).get(`/api/site/routes/${priv.id}/gpx`).set('Cookie', authCookie(other.id))).status).toBe(404);
  });

  it('SITE-003 — only the owner can make a trip public; a member cannot', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const t = createTrip(testDb, owner.id, { title: 'Compartido' });
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id) VALUES (?, ?)').run(t.id, member.id);
    expect((await request(app).put(`/api/trips/${t.id}`).set('Cookie', authCookie(member.id)).send({ is_public: true })).status).toBe(403);
    expect((await request(app).put(`/api/trips/${t.id}`).set('Cookie', authCookie(owner.id)).send({ is_public: true })).status).toBe(200);
    expect(testDb.prepare('SELECT is_public FROM trips WHERE id = ?').get(t.id)).toMatchObject({ is_public: 1 });
    expect((await request(app).put(`/api/trips/${t.id}`).set('Cookie', authCookie(owner.id)).send({ is_public: false })).status).toBe(200);
    expect(testDb.prepare('SELECT is_public FROM trips WHERE id = ?').get(t.id)).toMatchObject({ is_public: 0 });
  });

  it('SITE-004 — stories: published posts of journeys an admin marked as site journal; drafts and other journeys stay out', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);
    const site = createJourney(testDb, admin.id);
    const mine = createJourney(testDb, user.id);
    const put = (jid: number, uid: number, id: string, b: object) =>
      request(app).put(`/api/journeys/${jid}/blog/posts/${id}`).set('Cookie', authCookie(uid)).send(b);
    const ph = galleryPhoto(site.id, admin.id);
    expect((await put(site.id, admin.id, 'c0ffee00-0000-4000-8000-000000000001', { title: 'Nos dijeron que era todo bajada', status: 'published', post_date: '2026-05-01', blocks: [{ id: 'p', type: 'photo', photo: ph, layout: 'full' }] })).status).toBe(201);
    await put(site.id, admin.id, 'c0ffee00-0000-4000-8000-000000000002', { title: 'Borrador', status: 'draft', blocks: [] });
    await put(mine.id, user.id, 'c0ffee00-0000-4000-8000-000000000003', { title: 'De otro', status: 'published', blocks: [] });

    expect((await request(app).get('/api/site')).body.stories).toEqual([]);
    expect((await request(app).put(`/api/site/journals/${site.id}`).set('Cookie', authCookie(user.id)).send({ on: true })).status).toBe(403);
    expect((await request(app).put(`/api/site/journals/${site.id}`).set('Cookie', authCookie(admin.id)).send({ on: true })).status).toBe(200);

    const home = await request(app).get('/api/site');
    expect(home.body.stories.map((s: any) => s.title)).toEqual(['Nos dijeron que era todo bajada']);
    expect(home.body.stories[0].author).toEqual({ username: admin.username });
    const story = await request(app).get('/api/site/stories/nos-dijeron-que-era-todo-bajada');
    expect(story.status).toBe(200);
    expect(story.body.post.blocks[0].photo.photoId).toBe(ph.photoId);
    expect((await request(app).get('/api/site/stories/borrador')).status).toBe(404);
    expect((await request(app).get('/api/site/stories/de-otro')).status).toBe(404);
  });

  it('SITE-005 — photos are served only when they belong to a site journal', async () => {
    const { user: admin } = createAdmin(testDb);
    const { user } = createUser(testDb);
    const site = createJourney(testDb, admin.id);
    const other = createJourney(testDb, user.id);
    testDb.prepare('UPDATE journeys SET site_journal = 1 WHERE id = ?').run(site.id);
    const priv = galleryPhoto(other.id, user.id);
    expect((await request(app).get(`/api/site/photos/${priv.photoId}/thumbnail`)).status).toBe(404);
    expect((await request(app).get('/api/site/photos/abc/thumbnail')).status).toBe(404);
    const ok = galleryPhoto(site.id, admin.id);
    expect(sitePhotoOwner(ok.photoId)).toBe(admin.id);
    expect(sitePhotoOwner(priv.photoId)).toBeNull();
  });

  it('SITE-006 — the home says whether visitors can sign up', async () => {
    testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('allow_registration', 'false')").run();
    expect((await request(app).get('/api/site')).body.registration).toBe(false);
    testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('allow_registration', 'true')").run();
    expect((await request(app).get('/api/site')).body.registration).toBe(true);
  });
});

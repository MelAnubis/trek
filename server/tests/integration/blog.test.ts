/**
 * Blog de la travesía (4.2) — BLOG-001 …
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
import fs from 'node:fs';
import path from 'node:path';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

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

const POST = 'c0ffee00-0000-4000-8000-000000000001';
const url = (jid: number, rest = '') => `/api/journeys/${jid}/blog${rest}`;

function galleryPhoto(journeyId: number, ownerId: number, extra: { lat?: number; lng?: number } = {}) {
  const tp = testDb.prepare('INSERT INTO trek_photos (provider, owner_id, file_path, lat, lng) VALUES (?, ?, ?, ?, ?)')
    .run('local', ownerId, `journey/p${Math.random()}.jpg`, extra.lat ?? null, extra.lng ?? null);
  const gp = testDb.prepare('INSERT INTO journey_photos (journey_id, photo_id, created_at) VALUES (?, ?, ?)').run(journeyId, tp.lastInsertRowid, Date.now());
  return { galleryId: Number(gp.lastInsertRowid), photoId: Number(tp.lastInsertRowid) };
}

const para = (id: string, text: string) => ({ id, type: 'paragraph', text });

describe('Blog posts', () => {
  it('BLOG-001 — PUT creates a post with the client id, and the same PUT again updates it (offline retries never duplicate)', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const body = { title: 'Tres días por Arévalo', blocks: [para('b1', 'Salimos **pronto** hacia el castillo.')], status: 'draft', post_date: '2026-05-01' };
    const a = await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send(body);
    expect(a.status).toBe(201);
    expect(a.body.post).toMatchObject({ id: POST, slug: 'tres-dias-por-arevalo', excerpt: 'Salimos pronto hacia el castillo.', version: 1, status: 'draft' });
    const b = await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send({ ...body, base_version: 1 });
    expect(b.status).toBe(200);
    expect(b.body.post.version).toBe(2);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM blog_posts').get()).toMatchObject({ n: 1 });
  });

  it('BLOG-002 — a save made against an old version is a 409 that returns the server copy; force overwrites', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const put = (b: object) => request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send(b);
    await put({ title: 'A', blocks: [] });
    await put({ title: 'B', blocks: [], base_version: 1 });
    const stale = await put({ title: 'C', blocks: [], base_version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.post.title).toBe('B');
    const forced = await put({ title: 'C', blocks: [], base_version: 1, force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.post.title).toBe('C');
  });

  it('BLOG-003 — drafts are for editors; viewers see private and published; strangers nothing', async () => {
    const { user: owner } = createUser(testDb);
    const { user: viewer } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const j = createJourney(testDb, owner.id);
    addJourneyContributor(testDb, j.id, viewer.id, 'viewer');
    for (const [id, status] of [['p-draft-0001', 'draft'], ['p-priv-00001', 'private'], ['p-pub-000001', 'published']]) {
      await request(app).put(url(j.id, `/posts/${id}`)).set('Cookie', authCookie(owner.id)).send({ title: status, status, blocks: [] });
    }
    const mine = await request(app).get(url(j.id)).set('Cookie', authCookie(owner.id));
    expect(mine.body.access).toBe('edit');
    expect(mine.body.posts).toHaveLength(3);
    const theirs = await request(app).get(url(j.id)).set('Cookie', authCookie(viewer.id));
    expect(theirs.body.access).toBe('view');
    expect(theirs.body.posts.map((p: any) => p.status).sort()).toEqual(['private', 'published']);
    expect((await request(app).get(url(j.id, '/posts/p-draft-0001')).set('Cookie', authCookie(viewer.id))).status).toBe(404);
    expect((await request(app).put(url(j.id, '/posts/p-viewer-001')).set('Cookie', authCookie(viewer.id)).send({ blocks: [] })).status).toBe(403);
    expect((await request(app).get(url(j.id)).set('Cookie', authCookie(stranger.id))).status).toBe(404);
  });

  it('BLOG-004 — photos must belong to the journey; the server fills in the trek photo id and picks the cover', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const other = createJourney(testDb, user.id);
    const mine = galleryPhoto(j.id, user.id);
    const foreign = galleryPhoto(other.id, user.id);
    const bad = await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id))
      .send({ blocks: [{ id: 'f', type: 'photo', photo: foreign, layout: 'wide' }] });
    expect(bad.status).toBe(400);
    const ok = await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id))
      .send({ blocks: [{ id: 'g', type: 'gallery', photos: [{ galleryId: mine.galleryId, photoId: 999999 }], layout: 'grid' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.post.blocks[0].photos[0].photoId).toBe(mine.photoId);
    expect(ok.body.post.cover_photo_id).toBe(mine.photoId);
  });

  it('BLOG-005 — "also add to the journey" creates one entry that follows the post, gets its photos, and is kept (detached) when switched off', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const ph = galleryPhoto(j.id, user.id);
    const put = (b: object) => request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send(b);
    const blocks = [{ id: 'h', type: 'heading', text: 'Llegada', level: 2 }, para('p', 'Hacía viento.'), { id: 'ph', type: 'photo', photo: ph, layout: 'wide' }];
    const a = await put({ title: 'Día 1', blocks, post_date: '2026-05-01', add_to_journey: true });
    const own = a.body.post.own_entry_id;
    expect(own).toBeTruthy();
    expect(a.body.post.entry_ids).toEqual([own]);
    const entry = testDb.prepare('SELECT * FROM journey_entries WHERE id = ?').get(own) as any;
    expect(entry).toMatchObject({ title: 'Día 1', entry_date: '2026-05-01', source_post_id: POST });
    expect(entry.story).toBe('## Llegada\n\nHacía viento.');
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM journey_entry_photos WHERE entry_id = ?').get(own)).toMatchObject({ n: 1 });

    await put({ title: 'Día 1 (bis)', blocks, post_date: '2026-05-02', add_to_journey: true });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM journey_entries WHERE journey_id = ?').get(j.id)).toMatchObject({ n: 1 });
    expect(testDb.prepare('SELECT title, entry_date FROM journey_entries WHERE id = ?').get(own)).toMatchObject({ title: 'Día 1 (bis)', entry_date: '2026-05-02' });

    const off = await put({ title: 'Día 1 (bis)', blocks, add_to_journey: false });
    expect(off.body.post.own_entry_id).toBeNull();
    expect(testDb.prepare('SELECT source_post_id FROM journey_entries WHERE id = ?').get(own)).toMatchObject({ source_post_id: null });
  });

  it('BLOG-006 — links existing entries (only this journey\'s), assigns a photo to one of them, and returns entry cards', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const other = createJourney(testDb, user.id);
    const e1 = createJourneyEntry(testDb, j.id, user.id, { title: 'Castillo', story: '**Muy** alto' });
    const eX = createJourneyEntry(testDb, other.id, user.id, { title: 'Ajeno' });
    const ph = galleryPhoto(j.id, user.id);
    const r = await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id))
      .send({ entry_ids: [e1.id, eX.id], blocks: [{ id: 'p', type: 'photo', photo: ph, entryId: e1.id }, { id: 'e', type: 'entry', entryId: e1.id }] });
    expect(r.body.post.entry_ids).toEqual([e1.id]);
    expect(r.body.post.entries[0]).toMatchObject({ id: e1.id, title: 'Castillo', story: 'Muy alto' });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM journey_entry_photos WHERE entry_id = ?').get(e1.id)).toMatchObject({ n: 1 });
  });

  it('BLOG-007 — a map block gets the day\'s located entries, its GPX track and the post\'s geotagged photos', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id, { date: '2026-05-01' });
    const day2 = createDay(testDb, trip.id, { date: '2026-05-02' });
    const j = createJourney(testDb, user.id);
    testDb.prepare('INSERT INTO journey_trips (journey_id, trip_id, added_at) VALUES (?, ?, ?)').run(j.id, trip.id, Date.now());
    const e = createJourneyEntry(testDb, j.id, user.id, { entry_date: '2026-05-01', title: 'Arévalo' });
    testDb.prepare('UPDATE journey_entries SET location_lat = 41.06, location_lng = -4.72 WHERE id = ?').run(e.id);
    const pts = JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ lat: 41 + i / 1000, lng: -4.7 })));
    testDb.prepare('INSERT INTO gpx_tracks (trip_id, user_id, track_name, points_json, day_id) VALUES (?, ?, ?, ?, ?)').run(trip.id, user.id, 'Etapa 1', pts, day.id);
    testDb.prepare('INSERT INTO gpx_tracks (trip_id, user_id, track_name, points_json, day_id) VALUES (?, ?, ?, ?, ?)').run(trip.id, user.id, 'Etapa 2', pts, day2.id);
    const ph = galleryPhoto(j.id, user.id, { lat: 41.07, lng: -4.71 });
    const r = await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id))
      .send({ post_date: '2026-05-01', blocks: [{ id: 'm', type: 'map', source: 'day', showTrack: true, showPhotos: true }, { id: 'p', type: 'photo', photo: ph }] });
    const m = r.body.post.maps.m;
    expect(m.entries.map((x: any) => x.title)).toEqual(['Arévalo']);
    expect(m.tracks.map((t: any) => t.name)).toEqual(['Etapa 1']);
    expect(m.tracks[0].points.length).toBeLessThanOrEqual(500);
    expect(m.photos).toEqual([{ photoId: ph.photoId, lat: 41.07, lng: -4.71 }]);
  });

  it('BLOG-008 — invalid blocks are refused; deleting twice is fine; a viewer cannot delete', async () => {
    const { user } = createUser(testDb);
    const { user: viewer } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    addJourneyContributor(testDb, j.id, viewer.id, 'viewer');
    expect((await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send({ blocks: [{ id: 'x', type: 'video' }] })).status).toBe(400);
    expect((await request(app).put(url(j.id, '/posts/bad id!')).set('Cookie', authCookie(user.id)).send({ blocks: [] })).status).toBe(400);
    await request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send({ blocks: [] });
    expect((await request(app).delete(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(viewer.id))).status).toBe(403);
    const d1 = await request(app).delete(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id));
    const d2 = await request(app).delete(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id));
    expect([d1.body.existed, d2.body.existed]).toEqual([true, false]);
  });

  it('BLOG-009 — sketches are stored as stroke data and a published post keeps its address when renamed', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const sketch = { id: 's', type: 'sketch', aspect: 0.75, background: 'paper', strokes: [{ c: '#1a1a1a', w: 3, tool: 'pen', p: [10, 10, 0.5, 20, 25, 0.7] }] };
    const put = (b: object) => request(app).put(url(j.id, `/posts/${POST}`)).set('Cookie', authCookie(user.id)).send(b);
    const a = await put({ title: 'Primer día', status: 'published', blocks: [sketch] });
    expect(a.body.post.blocks[0].strokes[0].p).toEqual([10, 10, 0.5, 20, 25, 0.7]);
    expect(a.body.post.published_at).toBeTruthy();
    const b = await put({ title: 'Otro título', status: 'published', blocks: [sketch] });
    expect(b.body.post.slug).toBe('primer-dia');
  });

  it('BLOG-010 — two posts with the same title get distinct slugs', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const a = await request(app).put(url(j.id, '/posts/post-aaaaaaa1')).set('Cookie', authCookie(user.id)).send({ title: 'Ruta', blocks: [] });
    const b = await request(app).put(url(j.id, '/posts/post-aaaaaaa2')).set('Cookie', authCookie(user.id)).send({ title: 'Ruta', blocks: [] });
    expect([a.body.post.slug, b.body.post.slug]).toEqual(['ruta', 'ruta-2']);
  });
});

describe('Blog uploads', () => {
  const uploadsDir = path.join(__dirname, '../../uploads/journey');
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  const created: string[] = [];
  afterAll(() => { for (const f of created) try { fs.unlinkSync(path.join(__dirname, '../../uploads', f)); } catch { /* */ } });

  it('BLOG-011 — an upload goes to the journey gallery and resending the same client_id returns the same photo', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    const send = () => request(app).post(url(j.id, '/uploads')).set('Cookie', authCookie(user.id))
      .field('client_id', 'local-photo-0001').attach('photo', jpeg, 'IMG_1.jpg');
    const a = await send();
    expect(a.status).toBe(201);
    const b = await send();
    expect(b.status).toBe(200);
    expect(b.body.upload).toMatchObject({ gallery_id: a.body.upload.gallery_id, photo_id: a.body.upload.photo_id });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM journey_photos WHERE journey_id = ?').get(j.id)).toMatchObject({ n: 1 });
    created.push(...(testDb.prepare('SELECT file_path FROM trek_photos').all() as { file_path: string }[]).map(r => r.file_path));
    expect(fs.readdirSync(uploadsDir).length).toBeGreaterThan(0);
  });

  it('BLOG-012 — uploads need a client id and edit rights', async () => {
    const { user } = createUser(testDb);
    const { user: viewer } = createUser(testDb);
    const j = createJourney(testDb, user.id);
    addJourneyContributor(testDb, j.id, viewer.id, 'viewer');
    expect((await request(app).post(url(j.id, '/uploads')).set('Cookie', authCookie(user.id)).attach('photo', jpeg, 'a.jpg')).status).toBe(400);
    expect((await request(app).post(url(j.id, '/uploads')).set('Cookie', authCookie(viewer.id)).field('client_id', 'local-photo-0002').attach('photo', jpeg, 'a.jpg')).status).toBe(403);
  });
});

describe('Public blog', () => {
  it('BLOG-013 — only with share_blog on, only published posts, with prev/next and no private author data', async () => {
    const { user } = createUser(testDb);
    const j = createJourney(testDb, user.id, { title: 'Castilla' });
    const put = (id: string, b: object) => request(app).put(url(j.id, `/posts/${id}`)).set('Cookie', authCookie(user.id)).send(b);
    await put('post-pub-001', { title: 'Uno', status: 'published', post_date: '2026-05-01', blocks: [para('a', 'hola')] });
    await put('post-pub-002', { title: 'Dos', status: 'published', post_date: '2026-05-02', blocks: [] });
    await put('post-drf-003', { title: 'Borrador', status: 'draft', blocks: [] });

    const link = await request(app).post(`/api/journeys/${j.id}/share-link`).set('Cookie', authCookie(user.id)).send({ share_timeline: true });
    const token = link.body.token;
    expect((await request(app).get(`/api/public/journey/${token}/blog`)).status).toBe(404);

    await request(app).post(`/api/journeys/${j.id}/share-link`).set('Cookie', authCookie(user.id)).send({ share_timeline: true, share_blog: true });
    const list = await request(app).get(`/api/public/journey/${token}/blog`);
    expect(list.status).toBe(200);
    expect(list.body.journey.title).toBe('Castilla');
    expect(list.body.posts.map((p: any) => p.title)).toEqual(['Dos', 'Uno']);
    expect(list.body.posts[0].author).toEqual({ username: user.username });

    const one = await request(app).get(`/api/public/journey/${token}/blog/uno`);
    expect(one.body.post.title).toBe('Uno');
    expect(one.body.post.own_entry_id).toBeUndefined();
    expect(one.body.next).toEqual({ slug: 'dos', title: 'Dos' });
    expect(one.body.prev).toBeNull();
    expect((await request(app).get(`/api/public/journey/${token}/blog/borrador`)).status).toBe(404);

    const share = await request(app).get(`/api/journeys/${j.id}/share-link`).set('Cookie', authCookie(user.id));
    expect(share.body.link.share_blog).toBe(true);
  });
});

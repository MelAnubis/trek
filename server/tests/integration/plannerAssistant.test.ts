/**
 * AI route assistant — POST /api/planner/assistant. The LLM, the geocoder and
 * BRouter are mocked: these tests cover the orchestration, validation and error mapping.
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
const askMock = vi.fn();
const routeMock = vi.fn();
const searchMock = vi.fn();
vi.mock('../../src/services/aiTextService', () => ({ askAIText: (...a: unknown[]) => askMock(...a) }));
vi.mock('../../src/services/brouterService', async (orig) => ({
  ...(await orig<typeof import('../../src/services/brouterService')>()),
  routeWithBrouter: (...a: unknown[]) => routeMock(...a),
}));
vi.mock('../../src/services/mapsService', async (orig) => ({
  ...(await orig<typeof import('../../src/services/mapsService')>()),
  searchPlaces: (...a: unknown[]) => searchMock(...a),
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { resetPlannerAiLimiter } from '../../src/routes/planner';
import { parsePlan } from '../../src/services/routeAssistantService';

const app: Application = createApp();
beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb); loginAttempts.clear(); mfaAttempts.clear(); resetPlannerAiLimiter();
  askMock.mockReset(); routeMock.mockReset(); searchMock.mockReset();
});
afterAll(() => { testDb.close(); });

const PLAN = JSON.stringify({ name: 'Madrid–Segovia', summary: 'Por la sierra.', profile: 'safety', km_per_day: 70, days: 2, places: ['Madrid, España', 'Cercedilla, España', 'Segovia, España'] });
const GEO: Record<string, [number, number]> = { 'Madrid, España': [40.4168, -3.7038], 'Cercedilla, España': [40.7406, -4.0592], 'Segovia, España': [40.9429, -4.1088] };
const geocode = (q: string) => ({ places: GEO[q] ? [{ name: q.split(',')[0], lat: GEO[q][0], lng: GEO[q][1] }] : [], source: 'openstreetmap' });
const post = (userId: number, b: object) => request(app).post('/api/planner/assistant').set('Cookie', authCookie(userId)).send(b);

describe('parsePlan', () => {
  it('PLAN-020 — parses fenced JSON, caps places and falls back on bad profile / km', () => {
    const p = parsePlan('Aquí tienes:\n```json\n' + JSON.stringify({ name: 'X', profile: 'tank', km_per_day: 5, places: ['A', ' ', 'B', 3, ...Array(30).fill('C')] }) + '\n```');
    expect(p.profile).toBe('trekking');
    expect(p.kmPerDay).toBeNull();
    expect(p.days).toBeNull();
    expect(p.places.slice(0, 2)).toEqual(['A', 'B']);
    expect(p.places.length).toBe(12);
  });
  it('PLAN-021 — throws on non-JSON', () => {
    expect(() => parsePlan('lo siento, no puedo')).toThrow();
    expect(() => parsePlan('{ roto')).toThrow();
  });
});

describe('POST /planner/assistant', () => {
  it('PLAN-022 — requires auth and a sensible prompt', async () => {
    expect((await request(app).post('/api/planner/assistant').send({ prompt: 'Madrid a Segovia en bici' })).status).toBe(401);
    const { user } = createUser(testDb);
    expect((await post(user.id, { prompt: 'hola' })).status).toBe(400);
    expect((await post(user.id, { prompt: 'x'.repeat(1501) })).status).toBe(400);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('PLAN-023 — happy path: AI plan → geocoding → BRouter', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(PLAN);
    searchMock.mockImplementation(async (_u: number, q: string) => geocode(q));
    routeMock.mockResolvedValueOnce({ points: [[40.4, -3.7, 650], [40.9, -4.1, 1000]], distanceKm: 98.4, ascentM: 1200 });
    const r = await post(user.id, { prompt: 'Madrid a Segovia por la sierra en 2 días', lang: 'es' });
    expect(r.status).toBe(200);
    expect(r.body.plan).toMatchObject({ name: 'Madrid–Segovia', profile: 'safety', kmPerDay: 70, days: 2 });
    expect(r.body.waypoints.map((w: any) => w.name)).toEqual(['Madrid', 'Cercedilla', 'Segovia']);
    expect(r.body.points).toHaveLength(2);
    expect(r.body.distanceKm).toBe(98.4);
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(routeMock.mock.calls[0][1]).toBe('safety');
    expect(routeMock.mock.calls[0][0]).toHaveLength(3);
  });

  it('PLAN-024 — skips unresolved places but warns; fails if fewer than 2 resolve', async () => {
    const { user } = createUser(testDb);
    searchMock.mockImplementation(async (_u: number, q: string) => geocode(q));
    askMock.mockResolvedValueOnce(JSON.stringify({ name: 'R', profile: 'trekking', places: ['Madrid, España', 'Lugar Inventado', 'Segovia, España'] }));
    routeMock.mockResolvedValueOnce({ points: [[40.4, -3.7, null], [40.9, -4.1, null]], distanceKm: 90, ascentM: null });
    const ok = await post(user.id, { prompt: 'Madrid a Segovia en bici' });
    expect(ok.status).toBe(200);
    expect(ok.body.waypoints).toHaveLength(2);
    expect(ok.body.warnings.some((w: string) => w.startsWith('unresolved:'))).toBe(true);

    askMock.mockResolvedValueOnce(JSON.stringify({ name: 'R', places: ['Nada Uno', 'Nada Dos'] }));
    const bad = await post(user.id, { prompt: 'Una ruta rarísima en bici' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('GEOCODE_FAILED');
  });

  it('PLAN-025 — off-topic request gives 422 NO_PLAN and never calls geocoder or router', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(JSON.stringify({ name: '', summary: '', profile: 'trekking', km_per_day: null, places: [] }));
    const r = await post(user.id, { prompt: 'Dame una receta de paella' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NO_PLAN');
    expect(searchMock).not.toHaveBeenCalled();
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('PLAN-026 — maps NO_AI_KEY to 503, upstream failures to 502, and rejects over-long routes', async () => {
    const { user } = createUser(testDb);
    askMock.mockRejectedValueOnce(new Error('NO_AI_KEY: No AI API key configured.'));
    expect((await post(user.id, { prompt: 'Madrid a Segovia en bici' })).status).toBe(503);

    searchMock.mockImplementation(async (_u: number, q: string) => geocode(q));
    askMock.mockResolvedValue(PLAN);
    routeMock.mockRejectedValueOnce(Object.assign(new Error('BRouter unreachable'), { status: 502 }));
    expect((await post(user.id, { prompt: 'Madrid a Segovia en bici' })).status).toBe(502);

    routeMock.mockResolvedValueOnce({ points: [[1, 1, null], [2, 2, null]], distanceKm: 5000, ascentM: null });
    const tooLong = await post(user.id, { prompt: 'Madrid a Segovia en bici' });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('TOO_LONG');
  });

  it('PLAN-027 — rate limits per user', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValue(JSON.stringify({ name: '', places: [] }));
    for (let i = 0; i < 15; i++) expect((await post(user.id, { prompt: 'Madrid a Segovia en bici' })).status).toBe(422);
    expect((await post(user.id, { prompt: 'Madrid a Segovia en bici' })).status).toBe(429);
    const { user: other } = createUser(testDb);
    expect((await post(other.id, { prompt: 'Madrid a Segovia en bici' })).status).toBe(422);
  });
});

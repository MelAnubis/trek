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
const overpassMock = vi.fn();
vi.mock('../../src/services/aiTextService', () => ({ askAIText: (...a: unknown[]) => askMock(...a) }));
vi.mock('../../src/services/brouterService', async (orig) => ({
  ...(await orig<typeof import('../../src/services/brouterService')>()),
  routeWithBrouter: (...a: unknown[]) => routeMock(...a),
}));
vi.mock('../../src/services/mapsService', async (orig) => ({
  ...(await orig<typeof import('../../src/services/mapsService')>()),
  searchPlaces: (...a: unknown[]) => searchMock(...a),
  searchOverpassPoisAlongRoute: (...a: unknown[]) => overpassMock(...a),
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
  askMock.mockReset(); routeMock.mockReset(); searchMock.mockReset(); overpassMock.mockReset();
  overpassMock.mockResolvedValue({ pois: [], truncated: false });
  // El enrutador simulado sigue las paradas en el orden recibido, con un punto cada ~1 km.
  routeMock.mockImplementation(async (wps: { lat: number; lng: number }[]) => {
    const points = trackThrough(wps);
    return { points, distanceKm: points.length, ascentM: 800 };
  });
});
afterAll(() => { testDb.close(); });


type Pt = { lat: number; lng: number };
const km = (a: Pt, b: Pt) => {
  const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function trackThrough(wps: Pt[]): [number, number, number | null][] {
  const out: [number, number, number | null][] = [];
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i], n = Math.max(2, Math.ceil(km(a, b)));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([a.lat + (b.lat - a.lat) * k / n, a.lng + (b.lng - a.lng) * k / n, 700]);
  }
  return out;
}
const pathLen = (xs: Pt[]) => xs.slice(1).reduce((s, p, i) => s + km(xs[i], p), 0);

const SEG: Record<string, [number, number]> = {
  'Segovia, España': [40.9429, -4.1088], 'Ayllón, España': [41.4217, -3.3722], 'Pedraza, España': [41.1456, -3.8089],
  'Riaza, España': [41.2594, -3.4806], 'Turégano, España': [41.1583, -4.0114], 'Sepúlveda, España': [41.2998, -3.7453],
  'San Esteban, Segovia, España': [40.9440, -4.1100], 'Segovia, Colombia': [7.0, -74.7],
  'Madrid, España': [40.4168, -3.7038], 'Cercedilla, España': [40.7406, -4.0592],
};
const geocode = (q: string) => ({ places: SEG[q] ? [{ name: q.split(',')[0], lat: SEG[q][0], lng: SEG[q][1] }] : [], source: 'openstreetmap' });
const plan = (over: Record<string, unknown>) => JSON.stringify({ name: 'Ruta', summary: 'Resumen.', profile: 'trekking', km_per_day: null, days: null, start_fixed: false, end_fixed: false, places: [], ...over });
const post = (userId: number, b: object) => request(app).post('/api/planner/assistant').set('Cookie', authCookie(userId)).send(b as object);
const PROMPT = { prompt: 'Recorre los monumentos románicos de Segovia en bici' };

describe('parsePlan', () => {
  it('PLAN-020 — parses fenced JSON, caps places, falls back on bad profile / km, reads fixed ends', () => {
    const p = parsePlan('Aquí tienes:\n```json\n' + JSON.stringify({ name: 'X', profile: 'tank', km_per_day: 5, start_fixed: true, places: ['A', ' ', 'B', 3, ...Array(30).fill('C')] }) + '\n```');
    expect(p.profile).toBe('trekking');
    expect(p.kmPerDay).toBeNull();
    expect(p.days).toBeNull();
    expect(p.startFixed).toBe(true);
    expect(p.endFixed).toBe(false);
    expect(p.places.slice(0, 2)).toEqual(['A', 'B']);
    expect(p.places.length).toBe(12);
  });
  it('PLAN-021 — throws on non-JSON', () => {
    expect(() => parsePlan('lo siento, no puedo')).toThrow();
    expect(() => parsePlan('{ roto')).toThrow();
  });
});

describe('POST /planner/assistant — request handling', () => {
  it('PLAN-022 — requires auth and a sensible prompt', async () => {
    expect((await request(app).post('/api/planner/assistant').send({ prompt: 'Madrid a Segovia en bici' })).status).toBe(401);
    const { user } = createUser(testDb);
    expect((await post(user.id, { prompt: 'hola' })).status).toBe(400);
    expect((await post(user.id, { prompt: 'x'.repeat(1501) })).status).toBe(400);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('PLAN-025 — off-topic request gives 422 NO_PLAN and never calls geocoder or router', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({}));
    const r = await post(user.id, { prompt: 'Dame una receta de paella' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NO_PLAN');
    expect(searchMock).not.toHaveBeenCalled();
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('PLAN-026 — maps NO_AI_KEY to 503, upstream failures to 502, and rejects over-long routes', async () => {
    const { user } = createUser(testDb);
    askMock.mockRejectedValueOnce(new Error('NO_AI_KEY: No AI API key configured.'));
    expect((await post(user.id, PROMPT)).status).toBe(503);

    searchMock.mockImplementation(async (_u: number, q: string) => geocode(q));
    askMock.mockResolvedValue(plan({ places: ['Madrid, España', 'Segovia, España'] }));
    routeMock.mockRejectedValueOnce(Object.assign(new Error('BRouter unreachable'), { status: 502 }));
    expect((await post(user.id, PROMPT)).status).toBe(502);

    routeMock.mockImplementationOnce(async () => ({ points: trackThrough([{ lat: 10, lng: -3 }, { lat: 42, lng: -3 }]), distanceKm: 3500, ascentM: null }));
    const tooLong = await post(user.id, PROMPT);
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('TOO_LONG');
  });

  it('PLAN-027 — rate limits per user', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValue(plan({}));
    for (let i = 0; i < 15; i++) expect((await post(user.id, PROMPT)).status).toBe(422);
    expect((await post(user.id, PROMPT)).status).toBe(429);
    const { user: other } = createUser(testDb);
    expect((await post(other.id, PROMPT)).status).toBe(422);
  });
});

describe('POST /planner/assistant — route coherence', () => {
  const ZIGZAG = ['Segovia, España', 'Ayllón, España', 'Pedraza, España', 'Riaza, España', 'Turégano, España', 'Sepúlveda, España'];
  beforeEach(() => { searchMock.mockImplementation(async (_u: number, q: string) => geocode(q)); });

  it('PLAN-023 — reorders a zig-zag list geographically and returns the stops in travel order', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({ name: 'Románico', profile: 'safety', places: ZIGZAG }));
    const r = await post(user.id, PROMPT);
    expect(r.status).toBe(200);
    expect(r.body.plan).toMatchObject({ name: 'Románico', profile: 'safety' });
    const asked = ZIGZAG.map(q => ({ lat: SEG[q][0], lng: SEG[q][1] }));
    expect(r.body.waypoints).toHaveLength(6);
    expect(pathLen(r.body.waypoints)).toBeLessThan(pathLen(asked) - 20);
    // el enrutador recibe exactamente las paradas reordenadas
    expect(routeMock.mock.calls[0][0].map((w: Pt) => w.lat)).toEqual(r.body.waypoints.map((w: Pt) => w.lat));
    expect(routeMock.mock.calls[0][1]).toBe('safety');
    expect(r.body.quality.maxGapKm).toBeLessThan(5);
  });

  it('PLAN-028 — keeps start and end when the user named them', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({ start_fixed: true, end_fixed: true, places: ['Segovia, España', 'Riaza, España', 'Pedraza, España', 'Ayllón, España'] }));
    const r = await post(user.id, PROMPT);
    expect(r.body.waypoints[0].name).toBe('Segovia');
    expect(r.body.waypoints[3].name).toBe('Ayllón');
    expect(r.body.waypoints.slice(1, 3).map((w: any) => w.name).sort()).toEqual(['Pedraza', 'Riaza']);
  });

  it('PLAN-029 — merges several places of the same town and drops a homonym in another country', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({ places: ['Segovia, España', 'San Esteban, Segovia, España', 'Pedraza, España', 'Riaza, España', 'Segovia, Colombia'] }));
    const r = await post(user.id, PROMPT);
    expect(r.status).toBe(200);
    expect(r.body.waypoints.map((w: any) => w.name).sort()).toEqual(['Pedraza', 'Riaza', 'Segovia']);
    expect(r.body.warnings.some((w: string) => w.startsWith('merged:') && w.includes('San Esteban'))).toBe(true);
    expect(r.body.warnings.some((w: string) => w.startsWith('outliers:') && w.includes('Segovia'))).toBe(true);
  });

  it('PLAN-040 — skips unresolved places with a warning; fails when fewer than 2 resolve', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({ places: ['Segovia, España', 'Lugar Inventado', 'Riaza, España'] }));
    const ok = await post(user.id, PROMPT);
    expect(ok.status).toBe(200);
    expect(ok.body.waypoints).toHaveLength(2);
    expect(ok.body.warnings.some((w: string) => w.startsWith('unresolved:'))).toBe(true);

    askMock.mockResolvedValueOnce(plan({ places: ['Nada Uno', 'Nada Dos'] }));
    const bad = await post(user.id, PROMPT);
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('GEOCODE_FAILED');
  });

  it('PLAN-041 — rejects a broken (discontinuous) track instead of saving it', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({ places: ['Segovia, España', 'Riaza, España'] }));
    routeMock.mockImplementationOnce(async (wps: Pt[]) => {
      const a = trackThrough([wps[0], { lat: 41.0, lng: -4.0 }]), b = trackThrough([{ lat: 41.2, lng: -3.6 }, wps[1]]);
      return { points: [...a, ...b], distanceKm: 80, ascentM: null };
    });
    const r = await post(user.id, PROMPT);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('DISCONTINUOUS');
  });

  it('PLAN-042 — warns about big detours and stops the track does not pass through', async () => {
    const { user } = createUser(testDb);
    askMock.mockResolvedValueOnce(plan({ places: ['Segovia, España', 'Riaza, España'] }));
    routeMock.mockImplementationOnce(async (wps: Pt[]) => {
      // rodeo enorme y sin pasar por Riaza (acaba 3 km al sur)
      const via = { lat: 40.6, lng: -3.2 }, end = { lat: wps[1].lat - 0.03, lng: wps[1].lng };
      const pts = trackThrough([wps[0], via, end]);
      return { points: pts, distanceKm: pts.length, ascentM: null };
    });
    const r = await post(user.id, PROMPT);
    expect(r.status).toBe(200);
    expect(r.body.warnings.some((w: string) => w.startsWith('detour:'))).toBe(true);
    expect(r.body.warnings.some((w: string) => w.startsWith('offtrack:') && w.includes('Riaza'))).toBe(true);
  });
});

describe('POST /planner/assistant — stages end where you can sleep', () => {
  beforeEach(() => { searchMock.mockImplementation(async (_u: number, q: string) => geocode(q)); });
  // Madrid → Cercedilla ≈ 40 km; con "days: 2" el corte ideal está a ~20 km.
  const ask = (over: Record<string, unknown> = {}) => askMock.mockResolvedValueOnce(plan({ start_fixed: true, end_fixed: true, days: 2, places: ['Madrid, España', 'Cercedilla, España'], ...over }));

  it('PLAN-043 — puts the stage end at a lodging near the ideal mark', async () => {
    const { user } = createUser(testDb);
    ask();
    // alojamiento en la recta Madrid→Cercedilla, a ~45 % del recorrido
    const a = SEG['Madrid, España'], b = SEG['Cercedilla, España'], f = 0.45;
    overpassMock.mockResolvedValueOnce({ pois: [{ osm_id: 'node:1', name: 'Hostal X', lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, category: 'hotel' }], truncated: false });
    const r = await post(user.id, PROMPT);
    expect(r.status).toBe(200);
    expect(r.body.stageEnds).toHaveLength(1);
    expect(r.body.stageEnds[0].lodged).toBe(true);
    const total = r.body.quality.lengthKm;
    expect(r.body.stageEnds[0].km / total).toBeGreaterThan(0.43);
    expect(r.body.stageEnds[0].km / total).toBeLessThan(0.47);
    expect(overpassMock.mock.calls[0][0]).toBe('hotel');
    expect(r.body.warnings.some((w: string) => w.startsWith('nolodging'))).toBe(false);
  });

  it('PLAN-044 — flags stage ends without lodging, and falls back when the lodging lookup fails', async () => {
    const { user } = createUser(testDb);
    ask();
    const none = await post(user.id, PROMPT);
    expect(none.body.stageEnds).toEqual([{ km: expect.any(Number), lodged: false }]);
    expect(none.body.warnings).toContain('nolodging:1');

    ask();
    overpassMock.mockRejectedValueOnce(new Error('Overpass down'));
    const down = await post(user.id, PROMPT);
    expect(down.status).toBe(200);
    expect(down.body.warnings).toContain('nolodgingdata');
    expect(down.body.stageEnds).toHaveLength(1);
  });

  it('PLAN-045 — no days / km_per_day means no stage cuts and no lodging lookup', async () => {
    const { user } = createUser(testDb);
    ask({ days: null });
    const r = await post(user.id, PROMPT);
    expect(r.body.stageEnds).toEqual([]);
    expect(overpassMock).not.toHaveBeenCalled();
  });
});

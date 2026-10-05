/**
 * Overpass client: mirror fallback, retry with backoff, error reporting, grouped selectors, per-piece
 * along-route queries and the shared lodging tile cache. `fetch` is stubbed: no network, and the REAL
 * mapsService / lodgingTileService are used.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

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


import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { searchOverpassPoisAlongRoute, overpassElements, overpassSelectorsFor, splitLine } from '../../src/services/mapsService';
import { getLodgingNearLine, getTilePois, tilesForLine } from '../../src/services/lodgingTileService';

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  process.env.OVERPASS_RETRY_BACKOFF_MS = '1';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.OVERPASS_URLS; delete process.env.OVERPASS_RETRY_BACKOFF_MS; });
afterAll(() => { testDb.close(); });

const ok = (elements: unknown[]) => ({ ok: true, status: 200, json: async () => ({ elements }) });
const http = (status: number) => ({ ok: false, status, json: async () => ({}) });
const node = (id: number, lat: number, lng: number, tags: Record<string, string> = { tourism: 'hotel', name: 'H' + id }) => ({ type: 'node', id, lat, lon: lng, tags });
const bodyOf = (call: unknown[]) => decodeURIComponent(String((call[1] as { body: string }).body).replace(/^data=/, ''));
const lineN = (lat0: number, lat1: number, n = 40): [number, number][] => Array.from({ length: n }, (_, i) => [lat0 + (lat1 - lat0) * i / (n - 1), -3]);

describe('overpassFetch (through overpassElements)', () => {
  it('OV-001 — answers with the first mirror that works', async () => {
    const f = vi.fn().mockImplementation(async (url: string) => (url.includes('overpass-api.de') ? http(504) : ok([node(1, 40, -3)])));
    vi.stubGlobal('fetch', f);
    expect(await overpassElements('q')).toHaveLength(1);
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(2);              // los espejos se consultan a la vez
  });

  it('OV-002 — retries after a pause when every mirror fails, and succeeds on the second round', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => (calls++ < 4 ? http(429) : ok([node(1, 40, -3)]))));
    expect(await overpassElements('q')).toHaveLength(1);
    expect(calls).toBeGreaterThan(4);
  });

  it('OV-003 — when everything fails it logs and attaches the reason of EACH mirror', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('mail.ru')) return { ok: true, status: 200, json: async () => ({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3' }) };
      if (url.includes('overpass-api.de')) return http(504);
      throw new TypeError('fetch failed');
    }));
    let err: any;
    try { await overpassElements('q', { rounds: 1 }); } catch (e) { err = e; }
    expect(err.message).toBe('Overpass request failed');
    expect(err.status).toBe(502);
    expect(err.detail.some((d: string) => d.includes('overpass-api.de') && d.includes('HTTP 504'))).toBe(true);
    expect(err.detail.some((d: string) => d.includes('maps.mail.ru') && d.includes('timed out'))).toBe(true);
    expect(err.detail.some((d: string) => d.includes('fetch failed'))).toBe(true);
    expect(console.warn).toHaveBeenCalled();
    expect(String((console.warn as any).mock.calls[0][0])).toContain('HTTP 504');
  });

  it('OV-004 — OVERPASS_URLS replaces the public mirrors (your own instance)', async () => {
    process.env.OVERPASS_URLS = 'http://overpass.local/api/interpreter, not-a-url';
    const f = vi.fn().mockResolvedValue(ok([]));
    vi.stubGlobal('fetch', f);
    await overpassElements('q');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('http://overpass.local/api/interpreter');
  });

  it('OV-005 — sends an identifying User-Agent and asks for JSON', async () => {
    const f = vi.fn().mockResolvedValue(ok([]));
    vi.stubGlobal('fetch', f);
    await overpassElements('q', { rounds: 1 });
    const h = (f.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(h['User-Agent']).toContain('Trek');
    expect(h.Accept).toBe('application/json');
  });
});

describe('selectors and along-route search', () => {
  it('OV-006 — values of the same key collapse into ONE regex selector (and the polyline appears once)', () => {
    const q = overpassSelectorsFor('lodging', '(around:1500,40.1,-3.1,40.2,-3.2)');
    expect(q.split('\n')).toHaveLength(1);
    expect(q).toContain('["tourism"~"^(hotel|hostel|guest_house|apartment|motel|chalet|camp_site|caravan_site)$"]');
    expect(q.match(/40\.1,-3\.1/g)).toHaveLength(1);
    expect(overpassSelectorsFor('sights', '(1,2,3,4)').split('\n')).toHaveLength(2);     // tourism + historic
    expect(() => overpassSelectorsFor('nope', '(1,2,3,4)')).toThrow('Unknown POI category');
  });

  it('OV-007 — a long line is split into ~30 km pieces, merged, de-duplicated and unnamed water kept', async () => {
    const line = lineN(40, 41.2);                           // ≈ 133 km
    expect(splitLine(line).length).toBeGreaterThanOrEqual(4);
    const f = vi.fn().mockResolvedValue(ok([node(1, 40.5, -3, { amenity: 'drinking_water' }), node(1, 40.5, -3, { amenity: 'drinking_water' })]));
    vi.stubGlobal('fetch', f);
    const r = await searchOverpassPoisAlongRoute('water', line, 1000);
    expect(r.pois).toHaveLength(1);                         // mismo osm_id en varias piezas: uno solo
    expect(r.pois[0].name).toBe('');
    expect(r.partial).toBe(false);
    const queries = new Set(f.mock.calls.map(c => bodyOf(c)));
    expect(queries.size).toBeGreaterThanOrEqual(4);          // una consulta por pieza (y cada una de 4 espejos)
  });

  it('OV-008 — one failing piece gives a PARTIAL result; all failing throws', async () => {
    const line = lineN(40, 41.2);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, init: { body: string }) => {
      const q = decodeURIComponent(init.body);
      // la pieza que contiene lat ~40.0 falla siempre; las demás responden
      if (q.includes('around:1100,40.00000')) return http(504);
      return ok([node(100 + n++, 40.6, -3, { amenity: 'drinking_water' })]);
    }));
    const r = await searchOverpassPoisAlongRoute('water', line, 1100);       // otro radio: no reutiliza el caché en memoria de OV-007
    expect(r.partial).toBe(true);
    expect(r.pois.length).toBeGreaterThan(0);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(http(504)));
    await expect(searchOverpassPoisAlongRoute('water', lineN(40, 40.1, 5), 1000)).rejects.toMatchObject({ status: 502 });
  });

  it('OV-009 — validates input', async () => {
    await expect(searchOverpassPoisAlongRoute('nope', lineN(40, 41), 1000)).rejects.toMatchObject({ status: 400 });
    await expect(searchOverpassPoisAlongRoute('water', [[40, -3]], 1000)).rejects.toMatchObject({ status: 400 });
  });
});

describe('lodging tile cache', () => {
  const line = lineN(40.05, 40.35, 30);                     // ≈ 33 km al norte de Madrid, 4 teselas en latitud

  it('OV-010 — tilesForLine covers every 0,1° tile the corridor touches, including long segments', () => {
    const t = tilesForLine([[40.05, -3.05], [40.85, -3.05]], 1500);       // dos puntos a 89 km: se interpola
    expect([...t].length).toBeGreaterThanOrEqual(8);
    expect(t.has('400:-31')).toBe(true);
    expect(t.has('408:-31')).toBe(true);
  });

  it('OV-011 — queries only what is missing, stores every tile (even empty ones) and never asks twice', async () => {
    const f = vi.fn().mockResolvedValue(ok([node(1, 40.12, -3), node(2, 40.31, -3)]));
    vi.stubGlobal('fetch', f);
    const first = await getLodgingNearLine(line, 1500);
    expect(first.pois.map(p => p.osm_id).sort()).toEqual(['node:1', 'node:2']);
    expect(first.failedBuckets).toBe(0);
    const calls = f.mock.calls.length;
    expect(testDb.prepare("SELECT COUNT(*) AS c FROM poi_tiles WHERE category = 'lodging'").get()).toMatchObject({ c: expect.any(Number) });
    expect((testDb.prepare("SELECT COUNT(*) AS c FROM poi_tiles").get() as any).c).toBeGreaterThanOrEqual(4);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));   // Overpass caído
    const again = await getLodgingNearLine(line, 1500);
    expect(again.pois).toHaveLength(2);
    expect(again.buckets).toBe(0);
    expect(calls).toBeGreaterThan(0);
  });

  it('OV-012 — keeps only lodging within the radius of the line (tiles are wider than the corridor)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([node(1, 40.12, -3), node(2, 40.12, -3.07)])));   // el 2º a ~6 km al oeste
    const r = await getLodgingNearLine(line, 1500);
    expect(r.pois.map(p => p.osm_id)).toEqual(['node:1']);
  });

  it('OV-013 — a failed query is reported and NOT cached; the retry asks again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(http(504)));
    const bad = await getLodgingNearLine(line, 1500);
    expect(bad.failedBuckets).toBeGreaterThan(0);
    expect(bad.failedTiles).toBeGreaterThan(0);
    expect((testDb.prepare("SELECT COUNT(*) AS c FROM poi_tiles").get() as any).c).toBe(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([node(1, 40.12, -3)])));
    const good = await getLodgingNearLine(line, 1500);
    expect(good.failedBuckets).toBe(0);
    expect(good.pois).toHaveLength(1);
  });

  it('OV-014 — stale tiles (> 30 days) are refreshed, fresh ones are not', async () => {
    const f = vi.fn().mockResolvedValue(ok([node(1, 40.12, -3)]));
    vi.stubGlobal('fetch', f);
    await getLodgingNearLine(line, 1500);
    testDb.prepare('UPDATE poi_tiles SET fetched_at = ?').run(Date.now() - 31 * 24 * 3600 * 1000);
    const before = f.mock.calls.length;
    await getLodgingNearLine(line, 1500);
    expect(f.mock.calls.length).toBeGreaterThan(before);
    const mid = f.mock.calls.length;
    await getLodgingNearLine(line, 1500);
    expect(f.mock.calls.length).toBe(mid);
  });

  it('OV-015 — one request covers up to 4×4 tiles; a longer line needs several', async () => {
    const f = vi.fn().mockResolvedValue(ok([]));
    vi.stubGlobal('fetch', f);
    const r = await getLodgingNearLine(lineN(40.0, 41.2, 60), 1500);          // ≈ 133 km → 12 teselas en latitud
    expect(r.buckets).toBeGreaterThanOrEqual(3);
    const bbox = bodyOf(f.mock.calls[0]).match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/)!;
    expect(Number(bbox[3]) - Number(bbox[1])).toBeLessThanOrEqual(0.4001);
  });

  it('OV-016 — a response that hits the element cap is used but not cached (it may be incomplete)', async () => {
    const many = Array.from({ length: 4000 }, (_, i) => node(i + 1, 40.12 + (i % 50) * 1e-5, -3));
    const f = vi.fn().mockResolvedValue(ok(many));
    vi.stubGlobal('fetch', f);
    const r = await getLodgingNearLine(line, 1500);
    expect(r.pois.length).toBeGreaterThan(0);
    expect((testDb.prepare("SELECT COUNT(*) AS c FROM poi_tiles").get() as any).c).toBe(0);
  });
});

describe('settlement tiles', () => {
  const line = lineN(40.05, 40.35, 30);
  const place = (id: number, lat: number, name: string, type = 'village') => node(id, lat, -3, { place: type, name });

  it('OV-017 — settlements are cached under their own category and only cities / towns / villages with a name are kept', async () => {
    const f = vi.fn().mockResolvedValue(ok([place(1, 40.12, 'Pueblo'), place(2, 40.2, 'Ciudad', 'city'), place(3, 40.25, 'Aldea', 'hamlet'), place(4, 40.3, '', 'town'), node(5, 40.15, -3)]));
    vi.stubGlobal('fetch', f);
    const r = await getTilePois('settlement', line, 2000);
    expect(r.pois.map(p => `${p.name}:${p.type}`).sort()).toEqual(['Ciudad:city', 'Pueblo:village']);
    expect(bodyOf(f.mock.calls[0])).toContain('["place"~"^(city|town|village)$"]');
    expect((testDb.prepare("SELECT COUNT(*) AS c FROM poi_tiles WHERE category = 'settlement'").get() as any).c).toBeGreaterThanOrEqual(4);
    expect((testDb.prepare("SELECT COUNT(*) AS c FROM poi_tiles WHERE category = 'lodging'").get() as any).c).toBe(0);
  });

  it('OV-018 — lodging and settlements do not share cache entries', async () => {
    const f = vi.fn().mockImplementation(async (_u: string, init: { body: string }) =>
      ok(decodeURIComponent(init.body).includes('"place"') ? [place(1, 40.12, 'Pueblo')] : [node(2, 40.12, -3)]));
    vi.stubGlobal('fetch', f);
    await getTilePois('settlement', line, 2000);
    const before = f.mock.calls.length;
    const l = await getLodgingNearLine(line, 1500);                       // aún no estaba en caché → pregunta
    expect(f.mock.calls.length).toBeGreaterThan(before);
    expect(l.pois.map(p => p.osm_id)).toEqual(['node:2']);
  });
});

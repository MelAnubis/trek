/**
 * GET /api/trips/:id/gpx/export — the whole trip as one GPX file: places as
 * waypoints, each day as a route through its places, tracks as tracks.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

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
import { createUser, createTrip, createDay, createPlace, createDayAssignment, createCategory } from '../helpers/factories';
import { parseGpxBuffer } from '../../src/routes/gpxTracks';
import { gpxFilename } from '../../src/services/tripGpxExport';
import { authCookie } from '../helpers/auth';

const app: Application = createApp();

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => { resetTestDb(testDb); });
afterAll(() => { testDb.close(); });

function addTrack(tripId: number, userId: number, name: string, points: unknown[], extra: { dayId?: number; mode?: string; waypoints?: unknown[] } = {}) {
  testDb.prepare(`INSERT INTO gpx_tracks (trip_id, user_id, track_name, points_json, waypoints_json, day_id, transport_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(tripId, userId, name, JSON.stringify(points), JSON.stringify(extra.waypoints ?? []), extra.dayId ?? null, extra.mode ?? null);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: n => ['wpt', 'rte', 'rtept', 'trk', 'trkpt'].includes(n) });

async function exportGpx(tripId: number, userId: number) {
  const res = await request(app).get(`/api/trips/${tripId}/gpx/export`).set('Cookie', authCookie(userId)).buffer(true).parse((r, cb) => {
    let data = ''; r.setEncoding('utf8'); r.on('data', c => { data += c; }); r.on('end', () => cb(null, data));
  });
  return res;
}

describe('Trip GPX export', () => {
  it('TRIPGPX-001: places become waypoints, each day a route in planner order, tracks keep elevation and time', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Vía de la Plata', description: 'Sevilla → Astorga' });
    const cat = createCategory(testDb, { name: 'Albergue' });
    const d1 = createDay(testDb, trip.id, { date: '2026-05-01', title: 'Sevilla – Guillena' });
    const d2 = createDay(testDb, trip.id, { date: '2026-05-02' });
    const sev = createPlace(testDb, trip.id, { name: 'Catedral & Giralda', lat: 37.3861, lng: -5.9926, category_id: cat.id, description: 'Salida' });
    const gui = createPlace(testDb, trip.id, { name: 'Guillena', lat: 37.5428, lng: -6.0567, category_id: cat.id });
    const cas = createPlace(testDb, trip.id, { name: 'Castilblanco', lat: 37.6750, lng: -5.9906, category_id: cat.id });
    // Straight into the table: the factory fills missing coordinates with Paris.
    testDb.prepare('INSERT INTO places (trip_id, name, lat, lng) VALUES (?, ?, NULL, NULL)').run(trip.id, 'Sin coordenadas');
    // Planner order is order_index, not insertion order.
    createDayAssignment(testDb, d1.id, gui.id, { order_index: 1 });
    createDayAssignment(testDb, d1.id, sev.id, { order_index: 0 });
    createDayAssignment(testDb, d2.id, cas.id);
    addTrack(trip.id, user.id, 'Etapa 1', [
      { lat: 37.3861, lng: -5.9926, ele: 12.34, time: '2026-05-01T07:00:00Z' },
      { lat: 37.5428, lng: -6.0567, ele: 25, time: '2026-05-01T12:30:00Z' },
    ], { dayId: d1.id, mode: 'walking', waypoints: [{ lat: 37.45, lng: -6.02, name: 'Fuente' }] });

    const res = await exportGpx(trip.id, user.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/gpx+xml');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Via_de_la_Plata.gpx"');
    const xml = res.body as string;
    expect(XMLValidator.validate(xml)).toBe(true);

    const gpx = parser.parse(xml).gpx;
    expect(gpx.version).toBe('1.1');
    expect(gpx.metadata.name).toBe('Vía de la Plata');
    expect(gpx.metadata.desc).toBe('Sevilla → Astorga');

    // 3 located places + the track's own named point; the place without coordinates is left out.
    expect(gpx.wpt.map((w: any) => w.name)).toEqual(['Catedral & Giralda', 'Guillena', 'Castilblanco', 'Fuente']);
    expect(gpx.wpt[0]).toMatchObject({ lat: '37.3861', lon: '-5.9926', type: 'Albergue', desc: 'Salida', cmt: '1. Sevilla – Guillena' });

    // Only day 1 has two stops — a one-stop day is not a route.
    expect(gpx.rte).toHaveLength(1);
    expect(gpx.rte[0].name).toBe('1. Sevilla – Guillena');
    expect(gpx.rte[0].rtept.map((p: any) => p.name)).toEqual(['Catedral & Giralda', 'Guillena']);

    expect(gpx.trk).toHaveLength(1);
    expect(gpx.trk[0]).toMatchObject({ name: 'Etapa 1', number: 1, type: 'walking' });
    expect(gpx.trk[0].trkseg.trkpt[0]).toMatchObject({ lat: '37.3861', ele: 12.3, time: '2026-05-01T07:00:00.000Z' });

    // The schema's element order: metadata, wpt, rte, trk.
    expect(xml.indexOf('<wpt')).toBeLessThan(xml.indexOf('<rte>'))
    expect(xml.indexOf('</rte>')).toBeLessThan(xml.indexOf('<trk>'))
  });

  it('TRIPGPX-002: the file reads back through our own GPX importer (round trip)', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Ronda' });
    addTrack(trip.id, user.id, 'Bucle', [
      { lat: 36.74, lng: -5.16, ele: 700 }, { lat: 36.75, lng: -5.17, ele: 760 }, { lat: 36.76, lng: -5.16, ele: 720 },
    ]);
    const res = await exportGpx(trip.id, user.id);
    const back = parseGpxBuffer(res.body as string);
    expect(back.trackName).toBe('Bucle');
    expect(back.points).toHaveLength(3);
    expect(back.totalElevationGain).toBeGreaterThan(50);
  });

  it('TRIPGPX-003: XML-hostile names are escaped, control characters dropped, and the file stays well-formed', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: '<script>"x" & \'y\'' });
    createPlace(testDb, trip.id, { name: 'Bar "El <Rincón>" & Co\u0007', lat: 40, lng: -3 });
    const res = await exportGpx(trip.id, user.id);
    const xml = res.body as string;
    expect(XMLValidator.validate(xml)).toBe(true);
    // Escaped on the wire, the original text once parsed — minus the BEL control character.
    expect(xml).toContain('Bar &quot;El &lt;Rincón&gt;&quot; &amp; Co</name>');
    expect(new XMLParser({ isArray: n => n === 'wpt' }).parse(xml).gpx.wpt[0].name).toBe('Bar "El <Rincón>" & Co');
    expect(xml).not.toContain('<script>');
  });

  it('TRIPGPX-004: an empty trip is still a valid GPX with just its name', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Vacío' });
    const res = await exportGpx(trip.id, user.id);
    expect(res.status).toBe(200);
    expect(XMLValidator.validate(res.body as string)).toBe(true);
    const gpx = parser.parse(res.body as string).gpx;
    expect(gpx.metadata.name).toBe('Vacío');
    expect(gpx.wpt).toBeUndefined();
    expect(gpx.trk).toBeUndefined();
  });

  it('TRIPGPX-005: someone without access to the trip gets nothing', async () => {
    const { user: owner } = createUser(testDb);
    const { user: other } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    createPlace(testDb, trip.id, { name: 'Secreto', lat: 1, lng: 1 });
    const res = await exportGpx(trip.id, other.id);
    expect(res.status).toBe(404);
    expect(String(res.body)).not.toContain('Secreto');
    const anon = await request(app).get(`/api/trips/${trip.id}/gpx/export`);
    expect(anon.status).toBe(401);
  });

  it('TRIPGPX-006: corrupt stored points or junk coordinates are skipped, never a 500', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id, { title: 'Roto' });
    testDb.prepare(`INSERT INTO gpx_tracks (trip_id, user_id, track_name, points_json) VALUES (?, ?, 'mal', 'not json')`).run(trip.id, user.id);
    addTrack(trip.id, user.id, 'mixto', [{ lat: 999, lng: 0 }, { lat: 'x', lng: 1 }, { lat: 10, lng: 20 }]);
    const res = await exportGpx(trip.id, user.id);
    expect(res.status).toBe(200);
    const gpx = parser.parse(res.body as string).gpx;
    expect(gpx.trk).toHaveLength(1);
    expect(gpx.trk[0].trkseg.trkpt).toHaveLength(1);
  });
});

describe('gpxFilename', () => {
  it('TRIPGPX-007: ASCII-only, no quotes or slashes, never empty', () => {
    expect(gpxFilename('Año en Perú / "2026"')).toBe('Ano_en_Peru_2026.gpx');
    expect(gpxFilename('東京')).toBe('trip.gpx');
  });
});

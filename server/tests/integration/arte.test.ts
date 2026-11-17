/**
 * Mapas ilustrados (Arte) dentro de Trek.
 * ARTE-001…033: acceso por permiso, app y datos, rutas de Trek como GPX y composiciones.
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

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createAdmin, createTrip } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';
import { safeSyncPath } from '../../src/services/arteService';
import { buildGpx } from '../../src/services/arteTrekService';

const app: Application = createApp();

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  invalidatePermissionsCache();
});

afterAll(() => {
  testDb.close();
});

/** Admin → Permisos → «Usar los mapas ilustrados» = Todos. */
function openToEveryone(): void {
  testDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('perm_arte_use', 'everybody')").run();
  invalidatePermissionsCache();
}

const POINTS = [[41.06, -4.72, 820], [41.07, -4.71, 825.5], [41.08, -4.7, null]];

function composition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formato: 'estodobajada-arte/composicion',
    formato_version: 1,
    nombre: 'Vuelta a Arévalo',
    guardado: '2026-11-16T10:00:00.000Z',
    gpx: { nombre: 'arevalo.gpx', texto: '<gpx><trk><trkseg><trkpt lat="41" lon="-4"/></trkseg></trk></gpx>' },
    opciones: { style: 'acuarela' },
    pueblos: {},
    osm: { towns: [] },
    ...overrides,
  };
}

describe('Arte — acceso', () => {
  it('ARTE-001 — sin sesión responde 401', async () => {
    const res = await request(app).get('/api/arte/');
    expect(res.status).toBe(401);
  });

  it('ARTE-002 — por defecto solo entra el administrador', async () => {
    const { user } = createUser(testDb);
    const { user: admin } = createAdmin(testDb);

    const denied = await request(app).get('/api/arte/').set('Cookie', authCookie(user.id));
    expect(denied.status).toBe(403);
    const deniedApi = await request(app).get('/api/arte/trek/composiciones').set('Cookie', authCookie(user.id));
    expect(deniedApi.status).toBe(403);

    const ok = await request(app).get('/api/arte/').set('Cookie', authCookie(admin.id));
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('js/main.js');
  });

  it('ARTE-003 — con el permiso en «Todos» entra cualquier usuario', async () => {
    const { user } = createUser(testDb);
    openToEveryone();
    const res = await request(app).get('/api/arte/').set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
  });

  it('ARTE-004 — el permiso aparece en Admin → Permisos y solo admite admin o todos', async () => {
    const { user: admin } = createAdmin(testDb);
    const list = await request(app).get('/api/admin/permissions').set('Cookie', authCookie(admin.id));
    const entry = list.body.permissions.find((p: { key: string }) => p.key === 'arte_use');
    expect(entry).toMatchObject({ level: 'admin', defaultLevel: 'admin', allowedLevels: ['admin', 'everybody'] });
  });
});

describe('Arte — app y datos', () => {
  it('ARTE-010 — sirve el catálogo y los módulos, y no sale de su carpeta', async () => {
    const { user: admin } = createAdmin(testDb);
    const cookie = authCookie(admin.id);

    const catalog = await request(app).get('/api/arte/data/catalogo-patrimonio.json').set('Cookie', cookie);
    expect(catalog.status).toBe(200);
    expect(Array.isArray(catalog.body.entradas)).toBe(true);

    const js = await request(app).get('/api/arte/js/render.js').set('Cookie', cookie);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);

    const escape = await request(app).get('/api/arte/data/..%2f..%2fpackage.json').set('Cookie', cookie);
    expect(escape.status).toBe(404);
    const missing = await request(app).get('/api/arte/api/nada').set('Cookie', cookie);
    expect(missing.status).toBe(404);
  });

  it('ARTE-011 — sin token de peticiones el envío directo está apagado', async () => {
    const { user: admin } = createAdmin(testDb);
    const cookie = authCookie(admin.id);
    const estado = await request(app).get('/api/arte/api/peticion/estado').set('Cookie', cookie);
    expect(estado.status).toBe(503);
    const send = await request(app).post('/api/arte/api/peticion').set('Cookie', cookie).send({ title: 'Dibujo', body: 'x' });
    expect(send.status).toBe(503);
  });

  it('ARTE-012 — teselas y consultas mal formadas se rechazan sin salir a la red', async () => {
    const { user: admin } = createAdmin(testDb);
    const cookie = authCookie(admin.id);
    expect((await request(app).get('/api/arte/api/terreno/99/1/1.png').set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).get('/api/arte/api/terreno/3/9/1.png').set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).get('/api/arte/api/terreno/3/1/1.jpg').set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).post('/api/arte/api/overpass').set('Cookie', cookie).type('form').send({})).status).toBe(400);
  });

  it('ARTE-013 — la sincronización solo acepta ficheros de app/data con extensiones conocidas', () => {
    expect(safeSyncPath('app/data/catalogo-patrimonio.json')).toBe('catalogo-patrimonio.json');
    expect(safeSyncPath('app/data/dibujos/castillo-coca.js')).toBe('dibujos/castillo-coca.js');
    expect(safeSyncPath('app/data/monumentos/a.png')).toBe('monumentos/a.png');
    expect(safeSyncPath('app/js/main.js')).toBeNull();
    expect(safeSyncPath('app/data/../js/main.js')).toBeNull();
    expect(safeSyncPath('app/data/.oculto.json')).toBeNull();
    expect(safeSyncPath('app/data/dibujos/x.html')).toBeNull();
    expect(safeSyncPath('app/data/a\\b.json')).toBeNull();
  });
});

describe('Arte — rutas de Trek', () => {
  function plannerRoute(userId: number, name: string): number {
    return Number(testDb.prepare(
      'INSERT INTO planner_routes (user_id, name, total_distance_km, point_count, points_json) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, name, 3.2, POINTS.length, JSON.stringify(POINTS)).lastInsertRowid);
  }
  function tripTrack(tripId: number, userId: number, name: string): number {
    const pts = POINTS.map(([lat, lng, ele]) => ({ lat, lng, ele }));
    return Number(testDb.prepare(
      'INSERT INTO gpx_tracks (trip_id, user_id, track_name, total_distance, point_count, points_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(tripId, userId, name, 3200, pts.length, JSON.stringify(pts)).lastInsertRowid);
  }

  it('ARTE-020 — lista las rutas del planificador y los tracks de los viajes del usuario', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    openToEveryone();
    const mine = plannerRoute(user.id, 'Mi ruta');
    plannerRoute(other.id, 'Ruta ajena');
    const trip = createTrip(testDb, user.id, { title: 'Castilla' });
    const track = tripTrack(trip.id, user.id, 'Etapa 1');
    const otherTrip = createTrip(testDb, other.id);
    tripTrack(otherTrip.id, other.id, 'Track ajeno');

    const res = await request(app).get('/api/arte/trek/rutas').set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    const names = res.body.rutas.map((r: { nombre: string }) => r.nombre).sort();
    expect(names).toEqual(['Etapa 1', 'Mi ruta']);
    expect(res.body.rutas.find((r: { tipo: string }) => r.tipo === 'planner')).toMatchObject({ id: mine, km: 3.2 });
    expect(res.body.rutas.find((r: { tipo: string }) => r.tipo === 'track')).toMatchObject({ id: track, km: 3.2, viaje: 'Castilla' });
  });

  it('ARTE-021 — devuelve la ruta como GPX con los puntos literales', async () => {
    const { user } = createUser(testDb);
    openToEveryone();
    const id = plannerRoute(user.id, 'Mi <ruta> & más');

    const res = await request(app).get(`/api/arte/trek/rutas/planner/${id}`).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Mi <ruta> & más');
    expect(res.body.gpx).toContain('<name>Mi &lt;ruta&gt; &amp; más</name>');
    expect(res.body.gpx).toContain('<trkpt lat="41.06" lon="-4.72"><ele>820</ele></trkpt>');
    expect(res.body.gpx).toContain('<trkpt lat="41.07" lon="-4.71"><ele>825.5</ele></trkpt>');
    expect(res.body.gpx).toContain('<trkpt lat="41.08" lon="-4.7"/>');
    expect((res.body.gpx.match(/<trkpt /g) || []).length).toBe(3);
  });

  it('ARTE-022 — no se puede abrir la ruta de otro usuario ni un track de un viaje ajeno', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    openToEveryone();
    const foreignRoute = plannerRoute(other.id, 'Ruta ajena');
    const foreignTrack = tripTrack(createTrip(testDb, other.id).id, other.id, 'Track ajeno');
    const cookie = authCookie(user.id);

    expect((await request(app).get(`/api/arte/trek/rutas/planner/${foreignRoute}`).set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).get(`/api/arte/trek/rutas/track/${foreignTrack}`).set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).get('/api/arte/trek/rutas/otro/1').set('Cookie', cookie)).status).toBe(404);
  });

  it('ARTE-023 — un miembro del viaje sí ve sus tracks', async () => {
    const { user } = createUser(testDb);
    const { user: owner } = createUser(testDb);
    openToEveryone();
    const trip = createTrip(testDb, owner.id);
    const track = tripTrack(trip.id, owner.id, 'Compartido');
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)').run(trip.id, user.id, owner.id);

    const res = await request(app).get(`/api/arte/trek/rutas/track/${track}`).set('Cookie', authCookie(user.id));
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Compartido');
  });

  it('ARTE-024 — buildGpx no altera las coordenadas', () => {
    const gpx = buildGpx('x', [{ lat: 40.123456789, lng: -3.987654321, ele: 612.25 }, { lat: 40.2, lng: -3.9, ele: null }]);
    expect(gpx).toContain('lat="40.123456789" lon="-3.987654321"><ele>612.25</ele>');
    expect(gpx).toContain('lat="40.2" lon="-3.9"/>');
  });
});

describe('Arte — composiciones', () => {
  it('ARTE-030 — guardar, listar, abrir y borrar', async () => {
    const { user } = createUser(testDb);
    openToEveryone();
    const cookie = authCookie(user.id);

    const put = await request(app).put('/api/arte/trek/composiciones/cabc123').set('Cookie', cookie).send(composition());
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id: 'cabc123', nombre: 'Vuelta a Arévalo', gpx: 'arevalo.gpx', conOsm: true, conImagen: false });

    const list = await request(app).get('/api/arte/trek/composiciones').set('Cookie', cookie);
    expect(list.body.composiciones).toHaveLength(1);

    const get = await request(app).get('/api/arte/trek/composiciones/cabc123').set('Cookie', cookie);
    expect(get.status).toBe(200);
    expect(get.body.gpx.texto).toBe(composition().gpx!['texto' as never]);
    expect(get.body.opciones).toEqual({ style: 'acuarela' });
    expect(get.body.id).toBe('cabc123');

    const del = await request(app).delete('/api/arte/trek/composiciones/cabc123').set('Cookie', cookie);
    expect(del.status).toBe(204);
    expect((await request(app).get('/api/arte/trek/composiciones/cabc123').set('Cookie', cookie)).status).toBe(404);
  });

  it('ARTE-031 — cada usuario solo ve las suyas, aunque compartan identificador', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    openToEveryone();

    await request(app).put('/api/arte/trek/composiciones/cmisma').set('Cookie', authCookie(user.id)).send(composition({ nombre: 'La mía' }));
    await request(app).put('/api/arte/trek/composiciones/cmisma').set('Cookie', authCookie(other.id)).send(composition({ nombre: 'La suya' }));

    const mine = await request(app).get('/api/arte/trek/composiciones/cmisma').set('Cookie', authCookie(user.id));
    expect(mine.body.nombre).toBe('La mía');
    const theirs = await request(app).get('/api/arte/trek/composiciones').set('Cookie', authCookie(other.id));
    expect(theirs.body.composiciones.map((c: { nombre: string }) => c.nombre)).toEqual(['La suya']);

    await request(app).delete('/api/arte/trek/composiciones/cmisma').set('Cookie', authCookie(other.id));
    expect((await request(app).get('/api/arte/trek/composiciones/cmisma').set('Cookie', authCookie(user.id))).status).toBe(200);
  });

  it('ARTE-032 — rechaza lo que no es una composición y los identificadores raros', async () => {
    const { user } = createUser(testDb);
    openToEveryone();
    const cookie = authCookie(user.id);

    expect((await request(app).put('/api/arte/trek/composiciones/cabc123').set('Cookie', cookie).send({ formato: 'otro' })).status).toBe(400);
    expect((await request(app).put('/api/arte/trek/composiciones/cabc123').set('Cookie', cookie).send(composition({ gpx: { texto: 'sin xml' } }))).status).toBe(400);
    expect((await request(app).put('/api/arte/trek/composiciones/a%20b').set('Cookie', cookie).send(composition())).status).toBe(400);
  });

  it('ARTE-033 — la imagen del mapa se guarda aparte y se conserva al volver a guardar sin ella', async () => {
    const { user } = createUser(testDb);
    openToEveryone();
    const cookie = authCookie(user.id);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const imagen = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

    const put = await request(app).put('/api/arte/trek/composiciones/cimg01').set('Cookie', cookie)
      .send(composition({ imagen, imagen_ancho: 1800, imagen_alto: 1200, miniatura: imagen }));
    expect(put.body.conImagen).toBe(true);

    const img = await request(app).get('/api/arte/trek/composiciones/cimg01/imagen').set('Cookie', cookie);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(img.body, jpeg)).toBe(0);

    // la composición vuelve con su miniatura pero sin la imagen grande
    const get = await request(app).get('/api/arte/trek/composiciones/cimg01').set('Cookie', cookie);
    expect(get.body.miniatura).toBe(imagen);
    expect(get.body.imagen).toBeUndefined();

    await request(app).put('/api/arte/trek/composiciones/cimg01').set('Cookie', cookie).send(composition({ nombre: 'Otra vez' }));
    const again = await request(app).get('/api/arte/trek/composiciones/cimg01/imagen').set('Cookie', cookie);
    expect(again.status).toBe(200);

    // algo que dice ser JPEG y no lo es no se guarda como imagen
    const fake = await request(app).put('/api/arte/trek/composiciones/cimg02').set('Cookie', cookie)
      .send(composition({ imagen: `data:image/jpeg;base64,${Buffer.from('<svg/>').toString('base64')}` }));
    expect(fake.body.conImagen).toBe(false);
  });
});

/**
 * Bikepack <-> packing list sync integration tests.
 *
 * Covers: BKSYNC-001 to BKSYNC-008
 * Import links a packing_item to its bikepack_items row; edits on either
 * side then keep name/category/weight/quantity/bag in sync automatically.
 * "checked" stays trip-local, and deleting either side only unlinks the
 * other (never cascades a delete across).
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
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';

const app: Application = createApp();

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
});

afterAll(() => {
  testDb.close();
});

// Seeds a bikepack_items row directly (no import-modal factory exists yet).
function createBikepackItem(userId: number, overrides: Partial<{ name: string; peso: number; grupo: string; loc_c1: string; uds_c1: number }> = {}) {
  const result = testDb.prepare(
    'INSERT INTO bikepack_items (user_id, name, peso, grupo, loc_c1, uds_c1) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, overrides.name ?? 'Casco', overrides.peso ?? 0.3, overrides.grupo ?? 'Accesorios', overrides.loc_c1 ?? 'Bolsa Cuadro', overrides.uds_c1 ?? 1);
  return testDb.prepare('SELECT * FROM bikepack_items WHERE id = ?').get(result.lastInsertRowid) as any;
}

describe('Bulk import links packing items to their Bikepack source', () => {
  it('BKSYNC-001 — importing with bikepack_item_id stores the link', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { name: 'Casco', peso: 0.3, grupo: 'Accesorios', loc_c1: 'Bolsa Cuadro', uds_c1: 1 });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', category: 'Accesorios', weight_grams: 300, bag: 'Bolsa Cuadro', quantity: 1, bikepack_item_id: bpItem.id }] });

    expect(res.status).toBe(201);
    expect(res.body.items[0].bikepack_item_id).toBe(bpItem.id);
  });

  it('BKSYNC-002 — importing without bikepack_item_id leaves the item unlinked', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const res = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Local-only item', category: 'Other' }] });

    expect(res.status).toBe(201);
    expect(res.body.items[0].bikepack_item_id).toBeFalsy();
  });
});

describe('Editing a linked packing item syncs to Bikepack', () => {
  it('BKSYNC-003 — renaming and reweighing a linked item updates the bikepack_items row', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { name: 'Casco', peso: 0.3, grupo: 'Accesorios', loc_c1: 'Bolsa Cuadro', uds_c1: 1 });
    const importRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', category: 'Accesorios', weight_grams: 300, bag: 'Bolsa Cuadro', quantity: 1, bikepack_item_id: bpItem.id }] });
    const packingItemId = importRes.body.items[0].id;

    const res = await request(app)
      .put(`/api/trips/${trip.id}/packing/${packingItemId}`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Casco MTB', weight_grams: 350, quantity: 2 });
    expect(res.status).toBe(200);

    const updatedBikepackItem = testDb.prepare('SELECT * FROM bikepack_items WHERE id = ?').get(bpItem.id) as any;
    expect(updatedBikepackItem.name).toBe('Casco MTB');
    expect(updatedBikepackItem.peso).toBeCloseTo(0.35);
    expect(updatedBikepackItem.uds_c1).toBe(2);
  });

  it('BKSYNC-004 — moving a linked item to a different bag updates loc_c1', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { loc_c1: 'Bolsa Cuadro' });
    const importRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', category: 'Accesorios', bag: 'Bolsa Cuadro', bikepack_item_id: bpItem.id }] });
    const packingItemId = importRes.body.items[0].id;

    const newBagRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/bags`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Alforja Trasera 1' });
    const newBagId = newBagRes.body.bag.id;

    await request(app)
      .put(`/api/trips/${trip.id}/packing/${packingItemId}`)
      .set('Cookie', authCookie(user.id))
      .send({ bag_id: newBagId });

    const updatedBikepackItem = testDb.prepare('SELECT * FROM bikepack_items WHERE id = ?').get(bpItem.id) as any;
    expect(updatedBikepackItem.loc_c1).toBe('Alforja Trasera 1');
  });

  it('BKSYNC-005 — toggling "checked" does not touch the Bikepack row', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { name: 'Casco', peso: 0.3 });
    const importRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', weight_grams: 300, bikepack_item_id: bpItem.id }] });
    const packingItemId = importRes.body.items[0].id;

    await request(app)
      .put(`/api/trips/${trip.id}/packing/${packingItemId}`)
      .set('Cookie', authCookie(user.id))
      .send({ checked: true });

    const unchangedBikepackItem = testDb.prepare('SELECT * FROM bikepack_items WHERE id = ?').get(bpItem.id) as any;
    expect(unchangedBikepackItem.name).toBe('Casco');
    expect(unchangedBikepackItem.peso).toBeCloseTo(0.3);
    // checked lives only on the trip's packing_items row
    const packingItem = testDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(packingItemId) as any;
    expect(packingItem.checked).toBe(1);
  });

  it('BKSYNC-006 — editing an unlinked (locally-added) item never touches any bikepack_items row', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    createBikepackItem(user.id, { name: 'Casco', peso: 0.3 });

    const createRes = await request(app)
      .post(`/api/trips/${trip.id}/packing`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Local item', category: 'Other' });

    await request(app)
      .put(`/api/trips/${trip.id}/packing/${createRes.body.item.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ weight_grams: 999 });

    const bikepackItems = testDb.prepare('SELECT * FROM bikepack_items WHERE user_id = ?').all(user.id) as any[];
    expect(bikepackItems).toHaveLength(1);
    expect(bikepackItems[0].peso).toBeCloseTo(0.3);
  });
});

describe('Editing a Bikepack item syncs to all linked trips', () => {
  it('BKSYNC-007 — patching a bikepack item propagates to every trip that imported it', async () => {
    const { user } = createUser(testDb);
    const tripA = createTrip(testDb, user.id);
    const tripB = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { name: 'Casco', peso: 0.3, grupo: 'Accesorios', loc_c1: 'Bolsa Cuadro', uds_c1: 1 });

    const importA = await request(app)
      .post(`/api/trips/${tripA.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', category: 'Accesorios', weight_grams: 300, bag: 'Bolsa Cuadro', bikepack_item_id: bpItem.id }] });
    const importB = await request(app)
      .post(`/api/trips/${tripB.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', category: 'Accesorios', weight_grams: 300, bag: 'Bolsa Cuadro', bikepack_item_id: bpItem.id }] });

    const patchRes = await request(app)
      .patch(`/api/bikepack/items/${bpItem.id}`)
      .set('Cookie', authCookie(user.id))
      .send({ name: 'Casco integral', peso: 0.45, uds_c1: 2 });
    expect(patchRes.status).toBe(200);

    const itemA = testDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(importA.body.items[0].id) as any;
    const itemB = testDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(importB.body.items[0].id) as any;
    expect(itemA.name).toBe('Casco integral');
    expect(itemA.weight_grams).toBe(450);
    expect(itemA.quantity).toBe(2);
    expect(itemB.name).toBe('Casco integral');
    expect(itemB.weight_grams).toBe(450);
  });

  it('BKSYNC-008 — deleting a bikepack item unlinks trip items instead of deleting them', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { name: 'Casco' });
    const importRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', bikepack_item_id: bpItem.id }] });
    const packingItemId = importRes.body.items[0].id;

    const delRes = await request(app)
      .delete(`/api/bikepack/items/${bpItem.id}`)
      .set('Cookie', authCookie(user.id));
    expect(delRes.status).toBe(200);

    const packingItem = testDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(packingItemId) as any;
    expect(packingItem).toBeTruthy(); // still exists in the trip
    expect(packingItem.bikepack_item_id).toBeNull(); // just unlinked
  });

  it('BKSYNC-009 — deleting a trip packing item never touches its Bikepack source', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const bpItem = createBikepackItem(user.id, { name: 'Casco' });
    const importRes = await request(app)
      .post(`/api/trips/${trip.id}/packing/import`)
      .set('Cookie', authCookie(user.id))
      .send({ items: [{ name: 'Casco', bikepack_item_id: bpItem.id }] });
    const packingItemId = importRes.body.items[0].id;

    await request(app)
      .delete(`/api/trips/${trip.id}/packing/${packingItemId}`)
      .set('Cookie', authCookie(user.id));

    const bikepackItem = testDb.prepare('SELECT * FROM bikepack_items WHERE id = ?').get(bpItem.id) as any;
    expect(bikepackItem).toBeTruthy();
  });
});

/**
 * Print-on-demand integration tests — PRINTORD-001 through PRINTORD-016.
 * Covers /api/admin/print-vendor and /api/print/*. Lulu's own HTTP layer
 * (luluClient.luluRequest) is mocked; everything else (settings storage,
 * order persistence, access control) runs against the real test DB.
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

const luluRequestMock = vi.fn();
vi.mock('../../src/services/lulu/luluClient', () => ({
  luluRequest: (...args: unknown[]) => luluRequestMock(...args),
  invalidateLuluToken: vi.fn(),
  LuluAuthError: class LuluAuthError extends Error {},
  LuluRequestError: class LuluRequestError extends Error {},
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createAdmin, createJourney } from '../helpers/factories';
import { authCookie } from '../helpers/auth';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { invalidatePermissionsCache } from '../../src/services/permissions';

const app: Application = createApp();

const shippingAddress = { name: 'A Traveler', street1: '1 Main St', city: 'Springfield', postcode: '00000', countryCode: 'US' };

async function enableLulu() {
  const { user: admin } = createAdmin(testDb);
  await request(app).put('/api/admin/print-vendor').set('Cookie', authCookie(admin.id))
    .send({ clientKey: 'key-123', clientSecret: 'shh', enabled: true });
}

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
  invalidatePermissionsCache();
  luluRequestMock.mockReset();
});
afterAll(() => { testDb.close(); });

describe('GET /api/health/features', () => {
  it('PRINTORD-001 — printOnDemand is false until an admin configures and enables Lulu', async () => {
    const res = await request(app).get('/api/health/features');
    expect(res.body.printOnDemand).toBe(false);
  });

  it('PRINTORD-002 — printOnDemand is true once configured and enabled', async () => {
    await enableLulu();
    const res = await request(app).get('/api/health/features');
    expect(res.body.printOnDemand).toBe(true);
  });
});

describe('GET/PUT /api/admin/print-vendor', () => {
  it('PRINTORD-003 — non-admin cannot read or write print-vendor settings', async () => {
    const { user } = createUser(testDb);
    const getRes = await request(app).get('/api/admin/print-vendor').set('Cookie', authCookie(user.id));
    expect(getRes.status).toBe(403);
    const putRes = await request(app).put('/api/admin/print-vendor').set('Cookie', authCookie(user.id)).send({ enabled: true });
    expect(putRes.status).toBe(403);
  });

  it('PRINTORD-004 — an admin can set and read back the client key, with the secret only exposed as a boolean', async () => {
    const { user: admin } = createAdmin(testDb);
    await request(app).put('/api/admin/print-vendor').set('Cookie', authCookie(admin.id))
      .send({ clientKey: 'key-123', clientSecret: 'shh', enabled: true });

    const res = await request(app).get('/api/admin/print-vendor').set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientKey: 'key-123', clientSecretSet: true, sandbox: false, enabled: true });
  });

  it('PRINTORD-005 — POST /admin/print-vendor/test-connection reports failure when unconfigured', async () => {
    const { user: admin } = createAdmin(testDb);
    const res = await request(app).post('/api/admin/print-vendor/test-connection').set('Cookie', authCookie(admin.id));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it('PRINTORD-006 — POST /admin/print-vendor/test-connection reports success once Lulu answers the catalog probe', async () => {
    await enableLulu();
    luluRequestMock.mockResolvedValue({ results: [] });
    const { user: admin } = createAdmin(testDb);
    const res = await request(app).post('/api/admin/print-vendor/test-connection').set('Cookie', authCookie(admin.id));
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/print/estimate', () => {
  it('PRINTORD-007 — 503 when print-on-demand is not configured', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const res = await request(app).post('/api/print/estimate').set('Cookie', authCookie(user.id))
      .send({ journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1, shippingAddress, shippingLevel: 'MAIL' });
    expect(res.status).toBe(503);
  });

  it('PRINTORD-008 — 404 for a journey the user cannot access', async () => {
    await enableLulu();
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);
    const res = await request(app).post('/api/print/estimate').set('Cookie', authCookie(stranger.id))
      .send({ journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1, shippingAddress, shippingLevel: 'MAIL' });
    expect(res.status).toBe(404);
  });

  it('PRINTORD-009 — 422 for a page-size preset with no Lulu product mapping', async () => {
    await enableLulu();
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const res = await request(app).post('/api/print/estimate').set('Cookie', authCookie(user.id))
      .send({ journeyId: journey.id, preset: 'custom', pageCount: 20, quantity: 1, shippingAddress, shippingLevel: 'MAIL' });
    expect(res.status).toBe(422);
  });

  it('PRINTORD-010 — 200 with a cost breakdown once configured, journey-accessible, and mapped', async () => {
    await enableLulu();
    luluRequestMock.mockResolvedValue({
      line_item_costs: [{ total_cost_incl_tax: '10.00' }],
      shipping_cost: { total_cost_incl_tax: '3.00' },
      total_tax: '1.00',
      total_cost_incl_tax: '14.00',
      currency: 'USD',
    });
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const res = await request(app).post('/api/print/estimate').set('Cookie', authCookie(user.id))
      .send({ journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1, shippingAddress, shippingLevel: 'MAIL' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(14);
  });
});

describe('POST /api/print/orders', () => {
  it('PRINTORD-011 — creates a real order row and returns it once Lulu accepts the job', async () => {
    await enableLulu();
    luluRequestMock.mockResolvedValue({ id: 555, status: { name: 'CREATED' } });
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const res = await request(app).post('/api/print/orders').set('Cookie', authCookie(user.id)).send({
      journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1,
      interiorPdfUrl: 'https://example.com/book.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com', title: 'My Trip',
    });
    expect(res.status).toBe(200);
    expect(res.body.lulu_job_id).toBe('555');
    expect(res.body.status).toBe('CREATED');

    const listRes = await request(app).get('/api/print/orders').set('Cookie', authCookie(user.id));
    expect(listRes.body.orders).toHaveLength(1);
  });

  it('PRINTORD-012 — a Lulu failure still leaves a record behind, marked as errored, not silently lost', async () => {
    await enableLulu();
    luluRequestMock.mockRejectedValue(new Error('boom'));
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const res = await request(app).post('/api/print/orders').set('Cookie', authCookie(user.id)).send({
      journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1,
      interiorPdfUrl: 'https://example.com/book.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com',
    });
    expect(res.status).toBe(500);

    const listRes = await request(app).get('/api/print/orders').set('Cookie', authCookie(user.id));
    expect(listRes.body.orders).toHaveLength(1);
    expect(listRes.body.orders[0].status).toBe('error');
  });

  it('PRINTORD-013 — 400 when required fields are missing', async () => {
    await enableLulu();
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const res = await request(app).post('/api/print/orders').set('Cookie', authCookie(user.id))
      .send({ journeyId: journey.id, preset: 'square-210' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/print/orders/:id', () => {
  it('PRINTORD-014 — 404 for another user\'s order', async () => {
    await enableLulu();
    luluRequestMock.mockResolvedValue({ id: 1, status: { name: 'CREATED' } });
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);
    const createRes = await request(app).post('/api/print/orders').set('Cookie', authCookie(owner.id)).send({
      journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1,
      interiorPdfUrl: 'https://example.com/book.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com',
    });
    const res = await request(app).get(`/api/print/orders/${createRes.body.id}`).set('Cookie', authCookie(stranger.id));
    expect(res.status).toBe(404);
  });

  it('PRINTORD-015 — ?refresh=true re-polls Lulu and updates the stored status', async () => {
    await enableLulu();
    luluRequestMock.mockResolvedValueOnce({ id: 1, status: { name: 'CREATED' } });
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const createRes = await request(app).post('/api/print/orders').set('Cookie', authCookie(user.id)).send({
      journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1,
      interiorPdfUrl: 'https://example.com/book.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com',
    });

    luluRequestMock.mockResolvedValueOnce({ name: 'SHIPPED' });
    const res = await request(app).get(`/api/print/orders/${createRes.body.id}?refresh=true`).set('Cookie', authCookie(user.id));
    expect(res.body.status).toBe('SHIPPED');
  });

  it('PRINTORD-016 — without ?refresh, returns the stored status without calling Lulu again', async () => {
    await enableLulu();
    luluRequestMock.mockResolvedValueOnce({ id: 1, status: { name: 'CREATED' } });
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const createRes = await request(app).post('/api/print/orders').set('Cookie', authCookie(user.id)).send({
      journeyId: journey.id, preset: 'square-210', pageCount: 20, quantity: 1,
      interiorPdfUrl: 'https://example.com/book.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com',
    });
    luluRequestMock.mockClear();
    const res = await request(app).get(`/api/print/orders/${createRes.body.id}`).set('Cookie', authCookie(user.id));
    expect(res.body.status).toBe('CREATED');
    expect(luluRequestMock).not.toHaveBeenCalled();
  });
});

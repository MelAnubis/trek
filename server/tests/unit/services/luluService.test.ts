/**
 * Unit tests for luluService — LULU-SVC-001 through LULU-SVC-020.
 * Uses a real in-memory SQLite DB, same setup as adminService.test.ts.
 * The luluClient HTTP layer is mocked so these tests never touch the network.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = { db, closeDb: () => {}, reinitialize: () => {} };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/services/apiKeyCrypto', () => ({
  encrypt_api_key: (v: string) => `enc:${v}`,
  decrypt_api_key: (v: string) => (v && v.startsWith('enc:') ? v.slice(4) : v || null),
  maybe_encrypt_api_key: (v: string) => (v ? `enc:${v}` : null),
}));

const luluRequestMock = vi.fn();
vi.mock('../../../src/services/lulu/luluClient', () => ({
  luluRequest: (...args: unknown[]) => luluRequestMock(...args),
  invalidateLuluToken: vi.fn(),
  LuluAuthError: class LuluAuthError extends Error {},
  LuluRequestError: class LuluRequestError extends Error {},
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createJourney } from '../../helpers/factories';
import {
  getPrintVendorSettings,
  updatePrintVendorSettings,
  isPrintOnDemandConfigured,
  mapPresetToPackage,
  estimateCost,
  createLuluPrintJob,
  createOrderRecord,
  updateOrderAfterLuluCall,
  listOrdersForUser,
  getOrderForUser,
} from '../../../src/services/lulu/luluService';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  luluRequestMock.mockReset();
});

afterAll(() => {
  testDb.close();
});

describe('print vendor settings', () => {
  it('LULU-SVC-001: getPrintVendorSettings returns defaults when nothing is configured', () => {
    const s = getPrintVendorSettings();
    expect(s).toEqual({ clientKey: '', clientSecretSet: false, sandbox: false, enabled: false });
  });

  it('LULU-SVC-002: updatePrintVendorSettings persists the client key in plain, masks the secret as a boolean', () => {
    updatePrintVendorSettings({ clientKey: 'key-123', clientSecret: 'shh', enabled: true });
    const s = getPrintVendorSettings();
    expect(s.clientKey).toBe('key-123');
    expect(s.clientSecretSet).toBe(true);
    expect(s.enabled).toBe(true);
  });

  it('LULU-SVC-003: omitting a field leaves it unchanged — undefined means "keep", not "clear"', () => {
    updatePrintVendorSettings({ clientKey: 'key-123', clientSecret: 'shh' });
    updatePrintVendorSettings({ enabled: true });
    const s = getPrintVendorSettings();
    expect(s.clientKey).toBe('key-123');
    expect(s.clientSecretSet).toBe(true);
  });

  it('LULU-SVC-004: an explicit empty string clears the secret', () => {
    updatePrintVendorSettings({ clientSecret: 'shh' });
    expect(getPrintVendorSettings().clientSecretSet).toBe(true);
    updatePrintVendorSettings({ clientSecret: '' });
    expect(getPrintVendorSettings().clientSecretSet).toBe(false);
  });
});

describe('isPrintOnDemandConfigured', () => {
  it('LULU-SVC-005: false when nothing is configured', () => {
    expect(isPrintOnDemandConfigured()).toBe(false);
  });

  it('LULU-SVC-006: false when keys are set but the feature is not enabled', () => {
    updatePrintVendorSettings({ clientKey: 'k', clientSecret: 's', enabled: false });
    expect(isPrintOnDemandConfigured()).toBe(false);
  });

  it('LULU-SVC-007: false when enabled but the client secret is missing', () => {
    updatePrintVendorSettings({ clientKey: 'k', enabled: true });
    expect(isPrintOnDemandConfigured()).toBe(false);
  });

  it('LULU-SVC-008: true once both credentials are set and the feature is enabled', () => {
    updatePrintVendorSettings({ clientKey: 'k', clientSecret: 's', enabled: true });
    expect(isPrintOnDemandConfigured()).toBe(true);
  });
});

describe('mapPresetToPackage', () => {
  it('LULU-SVC-009: maps every documented preset to a non-empty package id', () => {
    for (const preset of ['square-210', 'square-300', 'a4-portrait', 'a4-landscape', 'a5-landscape']) {
      expect(mapPresetToPackage(preset)).toBeTruthy();
    }
  });

  it('LULU-SVC-010: "custom" and an unrecognised preset have no mapping', () => {
    expect(mapPresetToPackage('custom')).toBeNull();
    expect(mapPresetToPackage('not-a-real-preset')).toBeNull();
  });
});

describe('estimateCost / createLuluPrintJob — configuration gate', () => {
  const shippingAddress = { name: 'A', street1: '1 Main St', city: 'Springfield', postcode: '00000', countryCode: 'US' };

  it('LULU-SVC-011: estimateCost throws NO_PRINT_VENDOR_KEY when unconfigured, without ever calling Lulu', async () => {
    await expect(estimateCost({ podPackageId: 'x', pageCount: 20, quantity: 1, shippingAddress, shippingLevel: 'MAIL' }))
      .rejects.toThrow('NO_PRINT_VENDOR_KEY');
    expect(luluRequestMock).not.toHaveBeenCalled();
  });

  it('LULU-SVC-012: createLuluPrintJob throws NO_PRINT_VENDOR_KEY when unconfigured, without ever calling Lulu', async () => {
    await expect(createLuluPrintJob({
      podPackageId: 'x', pageCount: 20, quantity: 1, title: 'Book', interiorPdfUrl: 'https://example.com/a.pdf',
      shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com', externalId: 'ext-1',
    })).rejects.toThrow('NO_PRINT_VENDOR_KEY');
    expect(luluRequestMock).not.toHaveBeenCalled();
  });

  it('LULU-SVC-013: estimateCost sums line-item costs and passes the pod package/page count through, once configured', async () => {
    updatePrintVendorSettings({ clientKey: 'k', clientSecret: 's', enabled: true });
    luluRequestMock.mockResolvedValue({
      line_item_costs: [{ total_cost_incl_tax: '12.50' }],
      shipping_cost: { total_cost_incl_tax: '4.00' },
      total_tax: '1.10',
      total_cost_incl_tax: '17.60',
      currency: 'USD',
    });
    const result = await estimateCost({ podPackageId: 'pkg-1', pageCount: 20, quantity: 2, shippingAddress, shippingLevel: 'MAIL' });
    expect(result).toEqual({ lineItemCost: 12.5, shippingCost: 4, tax: 1.1, total: 17.6, currency: 'USD' });
    const [, path, init] = luluRequestMock.mock.calls[0];
    expect(path).toBe('/print-job-cost-calculations/');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.line_items[0]).toEqual({ page_count: 20, pod_package_id: 'pkg-1', quantity: 2 });
  });

  it('LULU-SVC-014: createLuluPrintJob returns the Lulu job id and status once configured', async () => {
    updatePrintVendorSettings({ clientKey: 'k', clientSecret: 's', enabled: true });
    luluRequestMock.mockResolvedValue({ id: 999, status: { name: 'CREATED' } });
    const result = await createLuluPrintJob({
      podPackageId: 'pkg-1', pageCount: 20, quantity: 1, title: 'Book', interiorPdfUrl: 'https://example.com/a.pdf',
      shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com', externalId: 'ext-1',
    });
    expect(result).toEqual({ luluJobId: '999', status: 'CREATED' });
  });
});

describe('order records', () => {
  const shippingAddress = { name: 'A', street1: '1 Main St', city: 'Springfield', postcode: '00000', countryCode: 'US' };

  it('LULU-SVC-015: createOrderRecord starts an order as "pending" with no Lulu job id yet', () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const id = createOrderRecord({
      userId: user.id, journeyId: journey.id, podPackageId: 'pkg-1', quantity: 1, pageCount: 20,
      interiorPdfUrl: 'https://example.com/a.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com',
    });
    const order = getOrderForUser(id, user.id);
    expect(order?.status).toBe('pending');
    expect(order?.lulu_job_id).toBeNull();
  });

  it('LULU-SVC-016: updateOrderAfterLuluCall patches only the given fields, leaving the rest untouched', () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const id = createOrderRecord({
      userId: user.id, journeyId: journey.id, podPackageId: 'pkg-1', quantity: 3, pageCount: 20,
      interiorPdfUrl: 'https://example.com/a.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com',
    });
    updateOrderAfterLuluCall(id, { luluJobId: '42', status: 'CREATED' });
    let order = getOrderForUser(id, user.id);
    expect(order?.lulu_job_id).toBe('42');
    expect(order?.status).toBe('CREATED');
    expect(order?.quantity).toBe(3);

    updateOrderAfterLuluCall(id, { status: 'IN_PRODUCTION' });
    order = getOrderForUser(id, user.id);
    expect(order?.lulu_job_id).toBe('42');
    expect(order?.status).toBe('IN_PRODUCTION');
  });

  it('LULU-SVC-017: listOrdersForUser only returns that user\'s own orders', () => {
    const { user: userA } = createUser(testDb);
    const { user: userB } = createUser(testDb);
    const journeyA = createJourney(testDb, userA.id);
    const journeyB = createJourney(testDb, userB.id);
    createOrderRecord({ userId: userA.id, journeyId: journeyA.id, podPackageId: 'pkg-1', quantity: 1, pageCount: 20, interiorPdfUrl: 'https://x/a.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com' });
    createOrderRecord({ userId: userB.id, journeyId: journeyB.id, podPackageId: 'pkg-1', quantity: 1, pageCount: 20, interiorPdfUrl: 'https://x/b.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'b@b.com' });
    expect(listOrdersForUser(userA.id)).toHaveLength(1);
    expect(listOrdersForUser(userB.id)).toHaveLength(1);
  });

  it('LULU-SVC-018: getOrderForUser returns null for another user\'s order — no cross-account leak', () => {
    const { user: userA } = createUser(testDb);
    const { user: userB } = createUser(testDb);
    const journeyA = createJourney(testDb, userA.id);
    const id = createOrderRecord({ userId: userA.id, journeyId: journeyA.id, podPackageId: 'pkg-1', quantity: 1, pageCount: 20, interiorPdfUrl: 'https://x/a.pdf', shippingAddress, shippingLevel: 'MAIL', contactEmail: 'a@b.com' });
    expect(getOrderForUser(id, userB.id)).toBeNull();
    expect(getOrderForUser(id, userA.id)).not.toBeNull();
  });
});

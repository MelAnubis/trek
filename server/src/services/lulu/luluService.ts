import { db } from '../../db/database';
import { encrypt_api_key, decrypt_api_key, maybe_encrypt_api_key } from '../apiKeyCrypto';
import { luluRequest, invalidateLuluToken, LuluAuthError, LuluRequestError, type LuluCreds } from './luluClient';

/**
 * Print-on-demand ordering, scaffolded against the Lulu Print API
 * (developers.lulu.com). A "scaffold" on purpose — see the comment on
 * `interiorPdfUrl` in `createPrintJob` below for the one piece this app
 * genuinely does not have yet (a server-side book-to-PDF renderer; export
 * today is entirely the browser's own print dialog, see printSheets.ts).
 * Everything else here is a real, working integration: settings, cost
 * estimation, order creation and status refresh all make real Lulu API
 * calls once an admin has configured credentials.
 *
 * Settings live in `app_settings` (same table/idiom as OIDC settings — see
 * adminService.ts's getOidcSettings/updateOidcSettings), not in a new
 * table: this is one instance-wide vendor account, not a per-user one, the
 * same reasoning mapsService.ts's admin-key fallback already uses for
 * Google Maps.
 */

const SETTINGS_KEYS = {
  clientKey: 'lulu_client_key',
  clientSecret: 'lulu_client_secret',
  sandbox: 'lulu_sandbox',
  enabled: 'lulu_enabled',
} as const;

function getSetting(key: string): string {
  return (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value || '';
}
function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value || '');
}

export interface PrintVendorSettings {
  clientKey: string;
  clientSecretSet: boolean;
  sandbox: boolean;
  enabled: boolean;
}

export function getPrintVendorSettings(): PrintVendorSettings {
  return {
    clientKey: getSetting(SETTINGS_KEYS.clientKey),
    clientSecretSet: !!decrypt_api_key(getSetting(SETTINGS_KEYS.clientSecret)),
    sandbox: getSetting(SETTINGS_KEYS.sandbox) === 'true',
    enabled: getSetting(SETTINGS_KEYS.enabled) === 'true',
  };
}

export function updatePrintVendorSettings(data: { clientKey?: string; clientSecret?: string; sandbox?: boolean; enabled?: boolean }): { success: true } {
  if (data.clientKey !== undefined) setSetting(SETTINGS_KEYS.clientKey, data.clientKey);
  if (data.clientSecret !== undefined) setSetting(SETTINGS_KEYS.clientSecret, maybe_encrypt_api_key(data.clientSecret) ?? '');
  if (data.sandbox !== undefined) setSetting(SETTINGS_KEYS.sandbox, String(data.sandbox));
  if (data.enabled !== undefined) setSetting(SETTINGS_KEYS.enabled, String(data.enabled));
  invalidateLuluToken();
  return { success: true };
}

function getCredentials(): LuluCreds | null {
  const clientKey = getSetting(SETTINGS_KEYS.clientKey);
  const clientSecret = decrypt_api_key(getSetting(SETTINGS_KEYS.clientSecret));
  if (!clientKey || !clientSecret) return null;
  return { clientKey, clientSecret, sandbox: getSetting(SETTINGS_KEYS.sandbox) === 'true' };
}

/** Whether the "Order a printed copy" flow should be offered at all — the client's own gate, exposed via GET /api/health/features (see app.ts). */
export function isPrintOnDemandConfigured(): boolean {
  return getSetting(SETTINGS_KEYS.enabled) === 'true' && getCredentials() !== null;
}

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const creds = getCredentials();
  if (!creds) return { ok: false, error: 'No Lulu credentials configured.' };
  try {
    // The pod-package catalog is the cheapest authenticated GET Lulu
    // exposes — just enough to prove the credentials actually work.
    await luluRequest(creds, '/pod-package/?page_size=1');
    return { ok: true };
  } catch (err) {
    if (err instanceof LuluAuthError) return { ok: false, error: 'Lulu rejected these credentials.' };
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach Lulu.' };
  }
}

/**
 * BookPageSetup['preset'] (client/src/types/book.ts) -> a Lulu
 * `pod_package_id`. These are illustrative, common Lulu photo-book trim
 * codes, NOT verified against a live account's current catalog — Lulu's
 * own `GET /pod-package/` endpoint is the source of truth and can change
 * without notice. Confirm against that endpoint (see testConnection's own
 * call as a template) before taking real orders; `custom` has no mapping
 * on purpose, since an arbitrary page size has no guaranteed Lulu product.
 */
const PRESET_TO_PACKAGE: Partial<Record<string, string>> = {
  'square-210': '2121X2121FCPRESS080CW444GXX',
  'square-300': '3030X3030FCPRESS100CW444GXX',
  'a4-portrait': '2100X2970FCPRESS080CW444GXX',
  'a4-landscape': '2970X2100FCPRESS080CW444GXX',
  'a5-landscape': '2100X1480FCPRESS080CW444GXX',
};

export function mapPresetToPackage(preset: string): string | null {
  return PRESET_TO_PACKAGE[preset] ?? null;
}

export interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  stateCode?: string;
  postcode: string;
  countryCode: string;
  phoneNumber?: string;
}

export interface CostEstimate {
  lineItemCost: number;
  shippingCost: number;
  tax: number;
  total: number;
  currency: string;
}

function luluShippingAddress(addr: ShippingAddress) {
  return {
    name: addr.name,
    street1: addr.street1,
    street2: addr.street2 || undefined,
    city: addr.city,
    state_code: addr.stateCode || undefined,
    postcode: addr.postcode,
    country_code: addr.countryCode,
    phone_number: addr.phoneNumber || undefined,
  };
}

export async function estimateCost(params: {
  podPackageId: string;
  pageCount: number;
  quantity: number;
  shippingAddress: ShippingAddress;
  shippingLevel: string;
}): Promise<CostEstimate> {
  const creds = getCredentials();
  if (!creds) throw new Error('NO_PRINT_VENDOR_KEY');
  const body = {
    line_items: [{ page_count: params.pageCount, pod_package_id: params.podPackageId, quantity: params.quantity }],
    shipping_address: luluShippingAddress(params.shippingAddress),
    shipping_level: params.shippingLevel,
  };
  const res = await luluRequest<{
    line_item_costs: { total_cost_incl_tax: string }[];
    shipping_cost: { total_cost_incl_tax: string };
    total_cost_incl_tax: string;
    total_tax: string;
    currency: string;
  }>(creds, '/print-job-cost-calculations/', { method: 'POST', body: JSON.stringify(body) });

  const lineItemCost = res.line_item_costs.reduce((sum, li) => sum + Number(li.total_cost_incl_tax || 0), 0);
  return {
    lineItemCost,
    shippingCost: Number(res.shipping_cost?.total_cost_incl_tax || 0),
    tax: Number(res.total_tax || 0),
    total: Number(res.total_cost_incl_tax || 0),
    currency: res.currency || 'USD',
  };
}

export async function createLuluPrintJob(params: {
  podPackageId: string;
  pageCount: number;
  quantity: number;
  title: string;
  /**
   * A URL Lulu's own servers can fetch the interior PDF from — this app has
   * no server-side book-to-PDF renderer today (export is entirely the
   * browser's print dialog, see printSheets.ts's own comment), so this is
   * supplied by whoever calls createPrintJob, not generated here. The
   * print-order route accepts it from the client for now; a follow-up task
   * to add real server-side rendering would let this be computed instead
   * of typed in.
   */
  interiorPdfUrl: string;
  coverPdfUrl?: string;
  shippingAddress: ShippingAddress;
  shippingLevel: string;
  contactEmail: string;
  externalId: string;
}): Promise<{ luluJobId: string; status: string }> {
  const creds = getCredentials();
  if (!creds) throw new Error('NO_PRINT_VENDOR_KEY');
  const body = {
    contact_email: params.contactEmail,
    external_id: params.externalId,
    line_items: [{
      external_id: params.externalId,
      title: params.title,
      pod_package_id: params.podPackageId,
      quantity: params.quantity,
      printable_normalization: {
        interior: { source_url: params.interiorPdfUrl },
        ...(params.coverPdfUrl ? { cover: { source_url: params.coverPdfUrl } } : {}),
      },
    }],
    shipping_address: luluShippingAddress(params.shippingAddress),
    shipping_level: params.shippingLevel,
  };
  const res = await luluRequest<{ id: number; status: { name: string } }>(creds, '/print-jobs/', { method: 'POST', body: JSON.stringify(body) });
  return { luluJobId: String(res.id), status: res.status?.name || 'CREATED' };
}

export async function getLuluPrintJobStatus(luluJobId: string): Promise<{ status: string }> {
  const creds = getCredentials();
  if (!creds) throw new Error('NO_PRINT_VENDOR_KEY');
  const res = await luluRequest<{ name: string }>(creds, `/print-jobs/${luluJobId}/status/`);
  return { status: res.name };
}

// ── Order records (this app's own history, not Lulu's) ─────────────────────

export interface PrintOrderInput {
  userId: number;
  journeyId: number;
  podPackageId: string;
  quantity: number;
  pageCount: number;
  interiorPdfUrl: string;
  coverPdfUrl?: string | null;
  shippingAddress: ShippingAddress;
  shippingLevel: string;
  contactEmail: string;
}

export function createOrderRecord(input: PrintOrderInput): number {
  const result = db.prepare(`
    INSERT INTO print_orders (user_id, journey_id, pod_package_id, quantity, page_count, interior_pdf_url, cover_pdf_url, shipping_address, shipping_level, contact_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    input.userId, input.journeyId, input.podPackageId, input.quantity, input.pageCount,
    input.interiorPdfUrl, input.coverPdfUrl || null, JSON.stringify(input.shippingAddress), input.shippingLevel, input.contactEmail,
  );
  return Number(result.lastInsertRowid);
}

export function updateOrderAfterLuluCall(id: number, patch: { luluJobId?: string; status?: string; costTotal?: number; costCurrency?: string; errorMessage?: string }): void {
  db.prepare(`
    UPDATE print_orders SET
      lulu_job_id = COALESCE(?, lulu_job_id),
      status = COALESCE(?, status),
      cost_total = COALESCE(?, cost_total),
      cost_currency = COALESCE(?, cost_currency),
      error_message = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(patch.luluJobId ?? null, patch.status ?? null, patch.costTotal ?? null, patch.costCurrency ?? null, patch.errorMessage ?? null, id);
}

export interface PrintOrderRow {
  id: number;
  user_id: number;
  journey_id: number;
  lulu_job_id: string | null;
  pod_package_id: string;
  quantity: number;
  page_count: number;
  interior_pdf_url: string;
  cover_pdf_url: string | null;
  shipping_address: string;
  shipping_level: string;
  contact_email: string;
  cost_total: number | null;
  cost_currency: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function listOrdersForUser(userId: number): PrintOrderRow[] {
  return db.prepare('SELECT * FROM print_orders WHERE user_id = ? ORDER BY created_at DESC').all(userId) as PrintOrderRow[];
}

export function getOrderForUser(id: number, userId: number): PrintOrderRow | null {
  return (db.prepare('SELECT * FROM print_orders WHERE id = ? AND user_id = ?').get(id, userId) as PrintOrderRow | undefined) ?? null;
}

export { LuluAuthError, LuluRequestError };

/**
 * Thin HTTP client for the Lulu Print API (developers.lulu.com). This is the
 * ONLY place that talks to Lulu — mirrors airtrailClient.ts's shape (typed
 * errors, one client per external integration, no SSRF guard needed since
 * the host is fixed rather than user-supplied).
 *
 * Auth is OAuth2 client-credentials, not a static API key: `POST /auth/
 * realms/glasstree/protocol/openid-connect/token` with HTTP Basic auth of
 * `clientKey:clientSecret` returns a short-lived bearer token, which this
 * client caches in memory and refreshes a little before it actually expires
 * (or immediately on a 401, once).
 */

const TIMEOUT_MS = 15000;
/** Refresh this many seconds before the token's own reported expiry, so a
 *  request that starts just before expiry doesn't race the clock. */
const TOKEN_REFRESH_SKEW_S = 60;

export interface LuluCreds {
  clientKey: string;
  clientSecret: string;
  /** developers.lulu.com has a separate sandbox host with its own credentials — never mixed with production. */
  sandbox: boolean;
}

export class LuluAuthError extends Error {
  constructor(message = 'Lulu rejected the API credentials') {
    super(message);
    this.name = 'LuluAuthError';
  }
}

export class LuluRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LuluRequestError';
    this.status = status;
  }
}

function baseUrl(sandbox: boolean): string {
  return sandbox ? 'https://api.sandbox.lulu.com' : 'https://api.lulu.com';
}

let cachedToken: { value: string; expiresAt: number; forCredsKey: string } | null = null;

function credsKey(creds: LuluCreds): string {
  return `${creds.sandbox ? 'sandbox' : 'prod'}:${creds.clientKey}`;
}

async function fetchAccessToken(creds: LuluCreds): Promise<{ value: string; expiresAt: number }> {
  const basic = Buffer.from(`${creds.clientKey}:${creds.clientSecret}`).toString('base64');
  let res: Response;
  try {
    res = await fetch(`${baseUrl(creds.sandbox)}/auth/realms/glasstree/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new LuluRequestError(err instanceof Error ? err.message : 'Lulu auth request failed');
  }
  if (res.status === 401 || res.status === 403) throw new LuluAuthError();
  if (!res.ok) throw new LuluRequestError(`Lulu auth failed (${res.status})`, res.status);
  const data = await res.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!data?.access_token) throw new LuluRequestError('Lulu auth response had no access_token');
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 300;
  return { value: data.access_token, expiresAt: Date.now() + Math.max(0, expiresIn - TOKEN_REFRESH_SKEW_S) * 1000 };
}

async function getAccessToken(creds: LuluCreds, forceRefresh = false): Promise<string> {
  const key = credsKey(creds);
  if (!forceRefresh && cachedToken && cachedToken.forCredsKey === key && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const token = await fetchAccessToken(creds);
  cachedToken = { ...token, forCredsKey: key };
  return token.value;
}

/** Clears the cached token — call after credentials are changed in the admin UI so the next request re-authenticates instead of reusing a token for the old account. */
export function invalidateLuluToken(): void {
  cachedToken = null;
}

/** An authenticated Lulu API request. Retries once on a 401 with a freshly-fetched token, in case the cached one expired early or was revoked. */
export async function luluRequest<T>(creds: LuluCreds, path: string, init: RequestInit = {}, _retried = false): Promise<T> {
  const token = await getAccessToken(creds, _retried);
  let res: Response;
  try {
    res = await fetch(`${baseUrl(creds.sandbox)}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new LuluRequestError(err instanceof Error ? err.message : 'Lulu request failed');
  }
  if (res.status === 401 && !_retried) return luluRequest<T>(creds, path, init, true);
  if (res.status === 401 || res.status === 403) throw new LuluAuthError();
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LuluRequestError(body || `Lulu request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

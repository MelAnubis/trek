/**
 * bikeparkSync.ts
 *
 * Fire-and-forget service that mirrors new Trek Wanderer users to the
 * Bikepack instance (BIKEPACK_URL).  Called after every successful user
 * creation — whether via self-registration or admin panel.
 *
 * Required env vars (all three must be set to enable syncing):
 *   BIKEPACK_URL           Base URL of the Bikepack Trek instance, e.g.
 *                          https://trekwanderer.info:448
 *   BIKEPACK_ADMIN_EMAIL   Admin account email on the Bikepack instance
 *   BIKEPACK_ADMIN_PASSWORD Admin account password on the Bikepack instance
 *
 * Optional:
 *   BIKEPACK_INSECURE=true  Skip TLS certificate validation (self-signed certs)
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

// ── Config ─────────────────────────────────────────────────────────────────

function cfg() {
  const url = (process.env.BIKEPACK_URL ?? '').replace(/\/$/, '');
  const adminEmail = process.env.BIKEPACK_ADMIN_EMAIL ?? '';
  const adminPassword = process.env.BIKEPACK_ADMIN_PASSWORD ?? '';
  return {
    url,
    adminEmail,
    adminPassword,
    insecure: process.env.BIKEPACK_INSECURE === 'true',
    enabled: !!(url && adminEmail && adminPassword),
  };
}

// ── Token cache ────────────────────────────────────────────────────────────

let _token: string | null = null;
let _tokenExpiry = 0;

// ── Low-level HTTP helper ──────────────────────────────────────────────────

interface BikeparkResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

function bikeparkFetch(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Promise<BikeparkResponse> {
  const { url, insecure } = cfg();
  const fullUrl = new URL(`${url}${path}`);
  const isHttps = fullUrl.protocol === 'https:';
  const doRequest = isHttps ? httpsRequest : httpRequest;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Trek Wanderer (internal sync)',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const bodyStr = body ? JSON.stringify(body) : undefined;
  if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: fullUrl.hostname,
      port: Number(fullUrl.port) || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers,
      ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
    };

    const req = doRequest(opts as Parameters<typeof httpsRequest>[0], (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => { raw += chunk; });
      res.on('end', () => {
        let data: unknown = raw;
        try { data = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, data });
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('BikeparkSync: request timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Token management ───────────────────────────────────────────────────────

async function getAdminToken(): Promise<string | null> {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const { adminEmail, adminPassword } = cfg();
  try {
    const res = await bikeparkFetch('/api/auth/login', 'POST', {
      email: adminEmail,
      password: adminPassword,
    });
    const token = (res.data as Record<string, unknown>)?.token as string | undefined;
    if (!res.ok || !token) {
      console.warn(`[BikeparkSync] Admin login failed (${res.status})`);
      _token = null;
      return null;
    }
    _token = token;
    _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 h
    return _token;
  } catch (err) {
    console.warn('[BikeparkSync] Login error:', (err as Error).message);
    _token = null;
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Mirror a newly created user to the Bikepack instance.
 * Always resolves — errors are logged but never propagate to the caller.
 * Call fire-and-forget (no await needed).
 */
export async function syncUserToBikepark(user: {
  username: string;
  email: string;
  password: string;
  role?: string;
}): Promise<void> {
  if (!cfg().enabled) return;

  try {
    const token = await getAdminToken();
    if (!token) return;

    const res = await bikeparkFetch(
      '/api/admin/users',
      'POST',
      {
        username: user.username,
        email: user.email,
        password: user.password,
        role: user.role ?? 'user',
      },
      token,
    );

    if (res.ok) {
      console.log(`[BikeparkSync] User "${user.username}" synced to Bikepack`);
    } else {
      const msg = (res.data as Record<string, unknown>)?.error ?? JSON.stringify(res.data);
      console.warn(`[BikeparkSync] Sync failed for "${user.username}": HTTP ${res.status} — ${msg}`);
      // If the token was rejected, clear the cache so the next call re-authenticates
      if (res.status === 401 || res.status === 403) {
        _token = null;
        _tokenExpiry = 0;
      }
    }
  } catch (err) {
    console.warn('[BikeparkSync] Unexpected error:', (err as Error).message);
  }
}

/**
 * Fetch the Bikepack packing profile for the Trek user with the given email.
 * Uses the admin token to find the user by email, then fetches their public
 * packing profile.  Returns null if Bikepack is not configured or unreachable.
 */
export async function fetchUserBikepackProfile(email: string): Promise<unknown | null> {
  if (!cfg().enabled) return null;
  try {
    const token = await getAdminToken();
    if (!token) return null;

    // List users to find the Bikepack user ID by email
    const usersRes = await bikeparkFetch('/api/admin/users', 'GET', undefined, token);
    if (!usersRes.ok) {
      console.warn(`[BikeparkSync] fetchUserBikepackProfile: could not list users (${usersRes.status})`);
      return null;
    }

    const users = usersRes.data as Array<{ id: string; email: string }> ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) {
      console.warn(`[BikeparkSync] fetchUserBikepackProfile: user ${email} not found on Bikepack`);
      return null;
    }

    const profileRes = await bikeparkFetch(
      `/api/bikepack/profile/public?user_id=${encodeURIComponent(found.id)}`,
      'GET',
      undefined,
      token,
    );
    if (!profileRes.ok) {
      console.warn(`[BikeparkSync] fetchUserBikepackProfile: profile fetch failed (${profileRes.status})`);
      return null;
    }
    return profileRes.data;
  } catch (err) {
    console.warn('[BikeparkSync] fetchUserBikepackProfile error:', (err as Error).message);
    return null;
  }
}

/**
 * bikeparkSso.ts — Shared-secret SSO helpers
 *
 * Both the Trek Wanderer instance and the Bikepack instance must set the
 * same value for BIKEPACK_SHARED_SECRET.  The signing instance (Trek)
 * generates a short-lived token; the receiving instance (Bikepack) validates
 * it and creates its own session cookie.
 *
 * ENV vars (set on BOTH instances):
 *   BIKEPACK_SHARED_SECRET   Random string ≥32 chars, identical on both sides.
 *                            Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Additional vars (Trek Wanderer side only):
 *   BIKEPACK_URL             Base URL of the Bikepack instance (already used by bikeparkSync)
 */

import jwt from 'jsonwebtoken';

const SHARED_SECRET = process.env.BIKEPACK_SHARED_SECRET ?? '';

/** True when SSO is fully configured on this side. */
export function isSsoConfigured(): boolean {
  return SHARED_SECRET.length >= 8 && !!(process.env.BIKEPACK_URL);
}

/**
 * Generate a 2-minute JWT that the Bikepack SSO endpoint will accept.
 * Only call from the Trek side (requires BIKEPACK_URL to be set).
 */
export function signSsoToken(email: string): string {
  if (!SHARED_SECRET) throw new Error('BIKEPACK_SHARED_SECRET is not configured');
  return jwt.sign({ email }, SHARED_SECRET, { expiresIn: '2m', algorithm: 'HS256' });
}

/**
 * Validate a shared-secret token received from the Trek side.
 * Returns the user's email on success, null on failure.
 * Safe to call even when BIKEPACK_SHARED_SECRET is not set (returns null).
 */
export function verifySsoToken(token: string): { email: string } | null {
  if (!SHARED_SECRET) return null;
  try {
    const payload = jwt.verify(token, SHARED_SECRET, { algorithms: ['HS256'] }) as { email: string };
    if (typeof payload.email !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

import express, { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { writeAudit, getClientIp } from '../services/auditLog';
import { setAuthCookie } from '../services/cookie';
import { db } from '../db/database';
import * as passkey from '../services/passkeyService';

const router = express.Router();

const WINDOW = 15 * 60 * 1000;
const LOGIN_MIN_LATENCY_MS = 350;

// ---------------------------------------------------------------------------
// Rate limiter (shared map per bucket)
// ---------------------------------------------------------------------------

const buckets = new Map<string, Map<string, { count: number; first: number }>>();

function getStore(bucket: string): Map<string, { count: number; first: number }> {
  if (!buckets.has(bucket)) buckets.set(bucket, new Map());
  return buckets.get(bucket)!;
}

setInterval(() => {
  const now = Date.now();
  for (const store of buckets.values()) {
    for (const [key, record] of store) {
      if (now - record.first >= WINDOW) store.delete(key);
    }
  }
}, 60_000);

function rateLimit(bucket: string, max: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const store = getStore(bucket);
    const key = req.ip || 'unknown';
    const now = Date.now();
    const record = store.get(key);
    if (record && record.count >= max && now - record.first < WINDOW) {
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return;
    }
    if (!record || now - record.first >= WINDOW) {
      store.set(key, { count: 1, first: now });
    } else {
      record.count++;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Guard: passkey_login must be enabled in app_settings
// ---------------------------------------------------------------------------

function passkeyEnabled(req: Request, res: Response, next: NextFunction): void {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'passkey_login'").get() as { value: string } | undefined;
  if (row?.value !== 'true') {
    res.status(404).json({ error: 'Passkey login is not enabled.' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Registration (authenticated)
// POST /api/auth/passkey/register/options
// POST /api/auth/passkey/register/verify
// ---------------------------------------------------------------------------

router.post('/register/options', authenticate, rateLimit('passkey_mfa', 5), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = await passkey.passkeyRegisterOptions(authReq.user.id, req.body?.password);
  if (result.error) return res.status(result.status!).json({ error: result.error });
  res.json(result.options);
});

router.post('/register/verify', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = await passkey.passkeyRegisterVerify(authReq.user.id, req.body);
  if (result.error) return res.status(result.status!).json({ error: result.error });
  writeAudit({ userId: authReq.user.id, action: 'user.passkey_register', ip: getClientIp(req) });
  res.json({ success: true, credential: result.credential });
});

// ---------------------------------------------------------------------------
// Authentication (public — discoverable-credential login)
// POST /api/auth/passkey/login/options
// POST /api/auth/passkey/login/verify
// ---------------------------------------------------------------------------

router.post('/login/options', passkeyEnabled, rateLimit('passkey_login', 10), async (_req: Request, res: Response) => {
  const result = await passkey.passkeyLoginOptions();
  if (result.error) return res.status(result.status!).json({ error: result.error });
  res.json(result.options);
});

router.post('/login/verify', passkeyEnabled, rateLimit('passkey_login', 10), async (req: Request, res: Response) => {
  const started = Date.now();
  const result = await passkey.passkeyLoginVerify(req.body);

  if (result.auditAction) {
    writeAudit({ userId: result.auditUserId ?? null, action: result.auditAction, ip: getClientIp(req) });
  }

  // Pad to the same floor as password login so timing can't distinguish a
  // known credential from an unknown one.
  const elapsed = Date.now() - started;
  if (elapsed < LOGIN_MIN_LATENCY_MS) {
    await new Promise((r) => setTimeout(r, LOGIN_MIN_LATENCY_MS - elapsed));
  }

  if (result.error) return res.status(result.status!).json({ error: result.error });

  writeAudit({ userId: result.auditUserId!, action: 'user.login', ip: getClientIp(req), details: { method: 'passkey' } });
  setAuthCookie(res, result.token!, req);
  res.json({ token: result.token, user: result.user });
});

// ---------------------------------------------------------------------------
// Management (authenticated, owner-scoped — NOT toggle-gated so users can
// always view/remove their passkeys even when the feature is disabled)
// GET    /api/auth/passkey/credentials
// PATCH  /api/auth/passkey/credentials/:id
// DELETE /api/auth/passkey/credentials/:id
// ---------------------------------------------------------------------------

router.get('/credentials', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json({ credentials: passkey.listPasskeys(authReq.user.id) });
});

router.patch('/credentials/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = passkey.renamePasskey(authReq.user.id, req.params.id, req.body?.name);
  if (result.error) return res.status(result.status!).json({ error: result.error });
  res.json({ success: true });
});

router.delete('/credentials/:id', authenticate, rateLimit('passkey_login', 5), (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = passkey.deletePasskey(authReq.user.id, req.params.id, req.body?.password);
  if (result.error) return res.status(result.status!).json({ error: result.error });
  writeAudit({ userId: authReq.user.id, action: 'user.passkey_delete', resource: String(req.params.id), ip: getClientIp(req) });
  res.json({ success: true });
});

export default router;

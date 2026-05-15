/**
 * onedrive.ts — OneDrive memories route for Trek
 * Mounted at /api/integrations/memories/onedrive
 */
import express, { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { AuthRequest } from '../../types';
import { canAccessUserPhoto } from '../../services/memories/helpersService';
import {
  getConnectionSettings,
  getConnectionStatus,
  getAuthUrl,
  exchangeCode,
  disconnect,
  listAlbums,
  getAlbumPhotos,
  browseTimeline,
  searchPhotos,
  streamOneDriveAsset,
  syncAlbumAssets,
  isValidAssetId,
} from '../../services/memories/oneDriveService';

const router = express.Router();

// ── Settings / connection ──────────────────────────────────────────────────
router.get('/settings', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json(getConnectionSettings(authReq.user.id));
});

router.get('/status', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json(await getConnectionStatus(authReq.user.id));
});

// ── OAuth flow ─────────────────────────────────────────────────────────────
router.get('/auth-url', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json({ url: getAuthUrl(authReq.user.id) });
});

// OAuth callback — called by Microsoft after user authorizes
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    return res.redirect(`/?onedrive_error=${encodeURIComponent(error)}`);
  }

  let userId: number | null = null;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    userId = decoded.userId;
  } catch {
    return res.redirect('/?onedrive_error=invalid_state');
  }

  if (!userId || !code) return res.redirect('/?onedrive_error=missing_params');

  const result = await exchangeCode(code, userId);
  if (!result.success) {
    return res.redirect(`/?onedrive_error=${encodeURIComponent(result.error || 'auth_failed')}`);
  }

  // Redirect to settings page
  res.redirect('/settings?onedrive_connected=1');
});

router.delete('/disconnect', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  disconnect(authReq.user.id);
  res.json({ success: true });
});

// ── Browse / search ────────────────────────────────────────────────────────
router.get('/browse', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = await browseTimeline(authReq.user.id);
  if ('error' in result && result.error) return res.status((result as any).status || 500).json({ error: result.error });
  res.json(result);
});

router.post('/search', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { from, to, size, page } = req.body;
  const result = await searchPhotos(authReq.user.id, from, to, Number(page) || 1, Math.min(Number(size) || 50, 200));
  if ('error' in result && result.error) return res.status((result as any).status || 500).json({ error: result.error });
  res.json(result);
});

// ── Albums ─────────────────────────────────────────────────────────────────
router.get('/albums', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = await listAlbums(authReq.user.id);
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.json(result);
});

router.get('/albums/:albumId/photos', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const result = await getAlbumPhotos(authReq.user.id, req.params.albumId);
  if ('error' in result && result.error) return res.status((result as any).status || 500).json({ error: result.error });
  res.json(result);
});

// ── Sync album to trip ─────────────────────────────────────────────────────
router.post('/albums/:albumId/sync/:tripId', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { albumId, tripId } = req.params;
  const shared = req.body?.shared !== false;
  const socketId = req.headers['x-socket-id'] as string;

  const result = await syncAlbumAssets(authReq.user.id, tripId, albumId, shared, socketId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, added: result.added });
});

// ── Proxy assets ───────────────────────────────────────────────────────────
router.get('/assets/:tripId/:assetId/:ownerId/thumbnail', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { assetId, ownerId } = req.params;
  if (!isValidAssetId(assetId)) return res.status(400).json({ error: 'Invalid asset ID' });
  await streamOneDriveAsset(res, Number(ownerId), assetId, 'thumbnail');
});

router.get('/assets/:tripId/:assetId/:ownerId/original', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { assetId, ownerId } = req.params;
  if (!isValidAssetId(assetId)) return res.status(400).json({ error: 'Invalid asset ID' });
  await streamOneDriveAsset(res, Number(ownerId), assetId, 'original');
});

export default router;

import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { streamPhoto, getPhotoInfo, resolveTrekPhoto } from '../services/memories/photoResolverService';
import { canAccessTrekPhoto } from '../services/memories/helpersService';

const router = express.Router();

// Helper: intercept res.end/write to capture bytes, convert HEIC→JPEG if needed
async function streamPhotoWithHeicConversion(
  res: Response,
  userId: number,
  photoId: number,
  kind: 'thumbnail' | 'original',
): Promise<void> {
  // Capture the response
  const chunks: Buffer[] = [];
  let capturedContentType = '';

  const originalSetHeader = res.setHeader.bind(res);
  const originalEnd = res.end.bind(res);

  // Intercept setHeader to capture content-type
  (res as any).setHeader = (name: string, value: any) => {
    if (name.toLowerCase() === 'content-type') capturedContentType = String(value);
    return originalSetHeader(name, value);
  };

  // Intercept end to capture bytes
  let resolved = false;
  const capturePromise = new Promise<void>(async (resolve) => {
    (res as any).end = async (chunk: any) => {
      resolved = true;
      // Restore originals
      res.setHeader = originalSetHeader;
      (res as any).end = originalEnd;

      const isHeic = capturedContentType.includes('heic') ||
        capturedContentType.includes('heif') ||
        capturedContentType === 'application/octet-stream';

      if (isHeic && chunk) {
        try {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const sharp = (await import('sharp')).default;
          const jpeg = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', jpeg.length);
          originalEnd(jpeg);
          resolve();
          return;
        } catch (e) {
          // fallback: send original
        }
      }
      originalEnd(chunk);
      resolve();
    };
  });

  await streamPhoto(res, userId, photoId, kind);
  if (!resolved) await capturePromise;
}

router.get('/:id/thumbnail', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const photoId = Number(req.params.id);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: 'Invalid photo ID' });
  if (!canAccessTrekPhoto(authReq.user.id, photoId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await streamPhotoWithHeicConversion(res, authReq.user.id, photoId, 'thumbnail');
});

router.get('/:id/original', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const photoId = Number(req.params.id);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: 'Invalid photo ID' });
  if (!canAccessTrekPhoto(authReq.user.id, photoId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await streamPhotoWithHeicConversion(res, authReq.user.id, photoId, 'original');
});

router.get('/:id/info', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const photoId = Number(req.params.id);
  if (!Number.isFinite(photoId)) return res.status(400).json({ error: 'Invalid photo ID' });
  if (!canAccessTrekPhoto(authReq.user.id, photoId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const result = await getPhotoInfo(authReq.user.id, photoId);
  if ('error' in result) return res.status(result.error.status).json({ error: result.error.message });
  res.json(result.data);
});

export default router;
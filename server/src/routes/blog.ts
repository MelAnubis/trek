import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import * as blog from '../services/blogService';
import { uploadGalleryPhotos, canEdit } from '../services/journeyService';
import { getAllowedExtensions } from '../services/fileService';
import { resolveAndStoreTakenAt, resolveAndStoreGps } from '../services/memories/photoResolverService';

/** Blog de una travesía: /api/journeys/:id/blog (montado con mergeParams). */
const router = express.Router({ mergeParams: true });

const uploadsBase = path.join(__dirname, '../../uploads/journey');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(uploadsBase)) fs.mkdirSync(uploadsBase, { recursive: true });
      cb(null, uploadsBase);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') || file.mimetype.includes('svg')) {
      return cb(Object.assign(new Error('Only image files are allowed'), { statusCode: 400 }));
    }
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const allowed = getAllowedExtensions().split(',').map(e => e.trim().toLowerCase());
    if (ext && !allowed.includes('*') && !allowed.includes(ext)) {
      return cb(Object.assign(new Error(`File type .${ext} is not allowed`), { statusCode: 400 }));
    }
    cb(null, true);
  },
});

const journeyId = (req: Request) => Number(req.params.id);
const sid = (req: Request) => req.headers['x-socket-id'] as string | undefined;

router.get('/', authenticate, (req: Request, res: Response) => {
  const r = blog.listPosts(journeyId(req), (req as AuthRequest).user.id);
  if (!r) return res.status(404).json({ error: 'Journey not found' });
  res.json(r);
});

router.get('/posts/:postId', authenticate, (req: Request, res: Response) => {
  const post = blog.getPost(journeyId(req), req.params.postId, (req as AuthRequest).user.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
});

// Upsert: the id comes from the client, so a retried PUT never duplicates.
router.put('/posts/:postId', authenticate, (req: Request, res: Response) => {
  const parsed = blog.savePostSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid post', details: parsed.error.issues.slice(0, 5) });
  const r = blog.savePost(journeyId(req), req.params.postId, (req as AuthRequest).user.id, parsed.data, sid(req));
  if ('error' in r) return res.status(r.status).json({ error: r.error, ...(r.post ? { post: r.post } : {}) });
  res.status(r.created ? 201 : 200).json({ post: r.post });
});

router.delete('/posts/:postId', authenticate, (req: Request, res: Response) => {
  const r = blog.deletePost(journeyId(req), req.params.postId, (req as AuthRequest).user.id, sid(req));
  if (r === null) return res.status(403).json({ error: 'Not allowed' });
  // Already gone is fine: an offline delete may be replayed.
  res.json({ success: true, existed: r });
});

// A photo taken for the blog goes into the journey gallery. `client_id`
// makes the upload idempotent: the phone may resend it after a dropped
// connection without the photo appearing twice.
router.post('/uploads', authenticate, upload.single('photo'), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const jid = journeyId(req);
  const file = req.file;
  const clientId = String(req.body?.client_id || '');
  const drop = () => { if (file) try { fs.unlinkSync(file.path); } catch { /* ya no está */ } };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) { drop(); return res.status(400).json({ error: 'client_id required' }); }
  if (!canEdit(jid, userId)) { drop(); return res.status(403).json({ error: 'Not allowed' }); }
  const seen = blog.findUpload(clientId, jid);
  if (seen) { drop(); return res.json({ upload: seen }); }
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const [photo] = uploadGalleryPhotos(jid, userId, [{ path: `journey/${file.filename}` }]) as { id: number; photo_id: number }[];
  if (!photo) { drop(); return res.status(403).json({ error: 'Not allowed' }); }
  await resolveAndStoreTakenAt(photo.photo_id, userId);
  await resolveAndStoreGps(photo.photo_id, userId);
  res.status(201).json({ upload: blog.recordUpload(clientId, jid, photo.id, photo.photo_id) });
});

export default router;

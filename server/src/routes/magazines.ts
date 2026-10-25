import express, { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../types';
import { createMagazine, listMagazines, magazineSources } from '../services/magazineService';

/** /api/magazines — la revista #ESTODOBAJADA (ver services/magazineService.ts). */
const router = express.Router();

router.get('/', authenticate, (req: Request, res: Response) => {
  res.json({ magazines: listMagazines((req as AuthRequest).user.id) });
});

router.get('/sources', authenticate, (req: Request, res: Response) => {
  res.json(magazineSources((req as AuthRequest).user.id));
});

const createSchema = z.object({
  title: z.string().max(200).default(''),
  subtitle: z.string().max(300).nullable().optional(),
  journey_ids: z.array(z.number().int().positive()).max(20).default([]),
  story_ids: z.array(z.string().min(1).max(64)).max(40).default([]),
});

router.post('/', authenticate, (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid magazine' });
  const result = createMagazine((req as AuthRequest).user.id, parsed.data);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ journey_id: result.journeyId, volume: result.volume });
});

export default router;

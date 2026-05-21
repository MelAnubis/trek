// ─────────────────────────────────────────────────────────────────────────────
// routes/suggestions.ts
//
// POST /api/trips/:tripId/suggestions/must-see
//   → returns AI-suggested must-see places for the trip, geocoded
// ─────────────────────────────────────────────────────────────────────────────

import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireTripAccess } from '../middleware/tripAccess';
import { AuthRequest } from '../types';
import { getMustSeeSuggestions } from '../services/suggestionsService';

const router = express.Router({ mergeParams: true });

router.post('/must-see', authenticate, requireTripAccess, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const lang = (req.query.lang as string) || 'en';

  try {
    const suggestions = await getMustSeeSuggestions(Number(tripId), authReq.user.id, lang);
    res.json({ suggestions });
  } catch (err: any) {
    const msg: string = err?.message ?? 'Unknown error';
    if (msg.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI suggestions are not configured. Ask your admin to set ANTHROPIC_API_KEY.' });
    }
    if (msg.includes('Claude API error')) {
      return res.status(502).json({ error: `AI service error: ${msg}` });
    }
    console.error('[suggestions] must-see error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

export default router;

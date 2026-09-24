// ─────────────────────────────────────────────────────────────────────────────
// journeyCoverSuggestService.ts
//
// "Suggest with AI" for a journey's cover image: samples a handful of the
// journey's gallery photos, sends them all to a vision-capable AI provider
// in one request, and asks it to pick the single best cover shot — then
// applies that choice the same way a manual cover upload would.
//
// Vision-capable providers only (Gemini, then Claude) — same restriction
// receiptScanService.ts documents: Groq's model configured elsewhere in
// this app is text-only. Unlike aiTextService.ts's single system+user
// prompt, a multi-image request has no existing precedent in this codebase
// to share, so the provider calls live here rather than being forced into
// that helper.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db/database';
import { isOwner, updateJourney } from './journeyService';
import { getPhotoThumbnailBytes } from './memories/photoResolverService';

/** Bounds the vision request's size/cost — the gallery itself is never paginated (see journeyService.ts's GALLERY_SELECT), so this is where a large trip's photo count gets capped. */
const MAX_CANDIDATES = 12;

interface Candidate {
  photoId: number;
  bytes: Buffer;
  contentType: string;
}

/** Evenly-spaced sample down to MAX_CANDIDATES rather than just the first N, so a long trip's cover choice isn't biased toward its earliest days. */
function sampleGalleryPhotoIds(journeyId: number): number[] {
  const rows = db.prepare(`
    SELECT gp.photo_id
      FROM journey_photos gp
      JOIN trek_photos tp ON tp.id = gp.photo_id
     WHERE gp.journey_id = ? AND tp.provider != 'onedrive'
     ORDER BY COALESCE(tp.taken_at, gp.created_at) ASC, gp.id ASC
  `).all(journeyId) as { photo_id: number }[];

  const ids = rows.map(r => r.photo_id);
  if (ids.length <= MAX_CANDIDATES) return ids;

  const step = ids.length / MAX_CANDIDATES;
  const sampled: number[] = [];
  for (let i = 0; i < MAX_CANDIDATES; i++) sampled.push(ids[Math.floor(i * step)]);
  return sampled;
}

async function gatherCandidates(userId: number, photoIds: number[]): Promise<Candidate[]> {
  const results = await Promise.all(photoIds.map(async photoId => {
    const fetched = await getPhotoThumbnailBytes(userId, photoId);
    return fetched ? { photoId, ...fetched } : null;
  }));
  return results.filter((c): c is Candidate => c !== null);
}

function buildPrompt(journeyTitle: string, count: number): string {
  return (
    `These are ${count} photos from a travel journal titled "${journeyTitle}", numbered 1 to ${count} in the order shown. ` +
    `Pick the single photo that would make the best cover image for this journal — vivid, well-composed, representative of the trip, ` +
    `not blurry, not a dark or awkward close-up. ` +
    `Respond with ONLY a raw JSON object: {"best": <number 1-${count}>}.`
  );
}

function parseBestIndex(raw: string, count: number): number | null {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(clean) as { best?: number };
    const best = Number(parsed.best);
    return Number.isInteger(best) && best >= 1 && best <= count ? best : null;
  } catch {
    return null;
  }
}

async function askGeminiBestPhoto(candidates: Candidate[], journeyTitle: string): Promise<number | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const parts = [
    { text: buildPrompt(journeyTitle, candidates.length) },
    ...candidates.flatMap((c, i) => [
      { text: `Photo ${i + 1}:` },
      { inline_data: { mime_type: c.contentType, data: c.bytes.toString('base64') } },
    ]),
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 64, temperature: 0.2 } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return parseBestIndex(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '', candidates.length);
}

async function askClaudeBestPhoto(candidates: Candidate[], journeyTitle: string): Promise<number | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const content = [
    { type: 'text', text: buildPrompt(journeyTitle, candidates.length) },
    ...candidates.flatMap((c, i) => [
      { type: 'text', text: `Photo ${i + 1}:` },
      { type: 'image', source: { type: 'base64', media_type: c.contentType, data: c.bytes.toString('base64') } },
    ]),
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 64, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return parseBestIndex(data.content?.find(c => c.type === 'text')?.text ?? '', candidates.length);
}

async function askBestPhoto(candidates: Candidate[], journeyTitle: string): Promise<number | null> {
  if (process.env.GEMINI_API_KEY) return askGeminiBestPhoto(candidates, journeyTitle);
  if (process.env.ANTHROPIC_API_KEY) return askClaudeBestPhoto(candidates, journeyTitle);
  throw new Error(
    'NO_AI_KEY: No vision-capable AI API key configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.',
  );
}

/**
 * Returns:
 * - null: journey doesn't exist, or the caller isn't its owner (cover is
 *   an owner-only setting — see journeyService.ts's updateJourney).
 * - throws NO_ELIGIBLE_PHOTOS: the gallery has no photo whose bytes could
 *   be fetched (empty gallery, or every photo is on an unsupported
 *   provider) — distinct from NO_AI_KEY so the route can tell them apart.
 * - throws NO_AI_KEY: propagated from askBestPhoto, same convention as
 *   the rest of this app's AI routes.
 */
export async function suggestAndApplyCover(journeyId: number, userId: number) {
  if (!isOwner(journeyId, userId)) return null;
  const journey = db.prepare('SELECT title FROM journeys WHERE id = ?').get(journeyId) as { title: string } | undefined;
  if (!journey) return null;

  const photoIds = sampleGalleryPhotoIds(journeyId);
  const candidates = await gatherCandidates(userId, photoIds);
  if (candidates.length === 0) throw new Error('NO_ELIGIBLE_PHOTOS: This journey has no gallery photos an AI provider can read yet.');

  const bestIndex = await askBestPhoto(candidates, journey.title);
  const chosen = candidates[(bestIndex ?? 1) - 1];

  const uploadsRoot = path.join(__dirname, '../../uploads/journey');
  if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });
  const ext = chosen.contentType === 'image/png' ? '.png' : '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(uploadsRoot, filename), chosen.bytes);

  return updateJourney(journeyId, userId, { cover_image: `journey/${filename}` });
}

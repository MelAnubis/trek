/**
 * planner.ts — Rutas guardadas del planificador (/planner)
 *
 * Rutas (todas por usuario, independientes de cualquier viaje):
 *   GET    /api/planner        → lista (sin puntos)
 *   GET    /api/planner/:id    → ruta completa
 *   POST   /api/planner        → crea
 *   PUT    /api/planner/:id    → actualiza (parcial: solo los campos enviados)
 *   DELETE /api/planner/:id    → elimina
 */
import express, { Request, Response } from 'express';
import { db } from '../db/database';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../types';
import { generateRoute } from '../services/routeAssistantService';

const router = express.Router();

const MAX_POINTS = 60000;
const MAX_CUTS = 400;
const MAX_WAYPOINTS = 1000;
const MAX_SETTINGS_BYTES = 4096;

type Pt = [number, number, number | null];

function validPoints(v: unknown): Pt[] | null {
  if (!Array.isArray(v) || v.length > MAX_POINTS) return null;
  const out: Pt[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lat = Number(p[0]), lng = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const ele = p[2] == null ? null : Number(p[2]);
    out.push([lat, lng, ele != null && Number.isFinite(ele) ? ele : null]);
  }
  return out;
}

function validCuts(v: unknown, pointCount: number): { index: number; name?: string }[] | null {
  if (!Array.isArray(v) || v.length > MAX_CUTS) return null;
  const out: { index: number; name?: string }[] = [];
  for (const c of v) {
    const index = Number((c as any)?.index);
    if (!Number.isInteger(index) || index <= 0 || index >= pointCount - 1) return null;
    const name = typeof (c as any)?.name === 'string' ? (c as any).name.slice(0, 120) : undefined;
    out.push(name ? { index, name } : { index });
  }
  return out;
}

function validWaypoints(v: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(v) || v.length > MAX_WAYPOINTS) return null;
  const out: Record<string, unknown>[] = [];
  for (const w of v) {
    const lat = Number((w as any)?.lat), lng = Number((w as any)?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const ele = (w as any)?.ele == null ? null : Number((w as any).ele);
    out.push({
      id: String((w as any)?.id ?? '').slice(0, 64),
      name: String((w as any)?.name ?? '').slice(0, 160),
      lat, lng,
      ele: ele != null && Number.isFinite(ele) ? ele : null,
      type: String((w as any)?.type ?? 'generic').slice(0, 32),
      note: (w as any)?.note ? String((w as any).note).slice(0, 500) : undefined,
      osm_id: (w as any)?.osm_id ? String((w as any).osm_id).slice(0, 40) : undefined,
    });
  }
  return out;
}

function validSettings(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  return JSON.stringify(v).length <= MAX_SETTINGS_BYTES ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseRow(row: any) {
  return {
    ...row,
    points: JSON.parse(row.points_json || '[]'),
    cuts: JSON.parse(row.cuts_json || '[]'),
    waypoints: JSON.parse(row.waypoints_json || '[]'),
    settings: JSON.parse(row.settings_json || '{}'),
    points_json: undefined, cuts_json: undefined, waypoints_json: undefined, settings_json: undefined,
  };
}

// ── Asistente de IA ──────────────────────────────────────────────────────────
// Cada llamada cuesta tokens y consulta servicios externos: límite por usuario.
const AI_LIMIT = 15;
const AI_WINDOW_MS = 60 * 60 * 1000;
const aiCalls = new Map<number, number[]>();

function aiRateLimited(userId: number): boolean {
  const now = Date.now();
  const recent = (aiCalls.get(userId) || []).filter(t => now - t < AI_WINDOW_MS);
  if (recent.length >= AI_LIMIT) { aiCalls.set(userId, recent); return true; }
  recent.push(now);
  aiCalls.set(userId, recent);
  return false;
}

/** Solo para tests. */
export function resetPlannerAiLimiter(): void { aiCalls.clear(); }

router.post('/assistant', authenticate, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (prompt.length < 8) return res.status(400).json({ error: 'prompt too short' });
  if (prompt.length > 1500) return res.status(400).json({ error: 'prompt too long' });
  const lang = typeof req.body?.lang === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(req.body.lang) ? req.body.lang : 'es';

  if (aiRateLimited(userId)) return res.status(429).json({ error: 'Too many AI requests, try again later' });

  try {
    const result = await generateRoute(userId, prompt, lang);
    res.json(result);
  } catch (err: any) {
    const msg: string = err?.message ?? 'Unknown error';
    if (msg.includes('NO_AI_KEY')) {
      return res.status(503).json({ error: 'AI is not configured. Set GROQ_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY in your .env file.', code: 'NO_AI_KEY' });
    }
    if (err?.code) return res.status(err.status || 422).json({ error: msg, code: err.code, unresolved: err.unresolved });
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: msg });
    if (/^(Groq|Gemini|Claude) \d/.test(msg) || err?.status === 502) {
      console.error('[planner] assistant upstream error:', msg);
      return res.status(502).json({ error: 'The AI or routing service failed. Try again.' });
    }
    console.error('[planner] assistant error:', err);
    res.status(500).json({ error: 'Failed to generate route' });
  }
});

router.get('/', authenticate, (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const routes = db.prepare(
    `SELECT id, name, orig_name, total_distance_km, elevation_gain, elevation_loss,
            point_count, stage_count, created_at, updated_at
     FROM planner_routes WHERE user_id = ? ORDER BY updated_at DESC, id DESC`
  ).all(userId);
  res.json({ routes });
});

router.get('/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const row = db.prepare('SELECT * FROM planner_routes WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!row) return res.status(404).json({ error: 'Route not found' });
  res.json({ route: parseRow(row) });
});

router.post('/', authenticate, (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  const points = validPoints(b.points);
  if (!points || points.length < 2) return res.status(400).json({ error: 'Invalid points' });
  const cuts = validCuts(b.cuts ?? [], points.length);
  if (!cuts) return res.status(400).json({ error: 'Invalid cuts' });
  const waypoints = validWaypoints(b.waypoints ?? []);
  if (!waypoints) return res.status(400).json({ error: 'Invalid waypoints' });
  const settings = validSettings(b.settings ?? {});
  if (!settings) return res.status(400).json({ error: 'Invalid settings' });

  const info = db.prepare(
    `INSERT INTO planner_routes
       (user_id, name, orig_name, total_distance_km, elevation_gain, elevation_loss,
        point_count, stage_count, points_json, cuts_json, waypoints_json, settings_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    userId, name, typeof b.orig_name === 'string' ? b.orig_name.slice(0, 200) : null,
    num(b.total_distance_km), num(b.elevation_gain), num(b.elevation_loss),
    points.length, cuts.length + 1,
    JSON.stringify(points), JSON.stringify(cuts), JSON.stringify(waypoints), JSON.stringify(settings),
  );
  const row = db.prepare('SELECT * FROM planner_routes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ route: parseRow(row) });
});

router.put('/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const existing = db.prepare('SELECT * FROM planner_routes WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!existing) return res.status(404).json({ error: 'Route not found' });
  const b = req.body || {};

  let name = existing.name;
  if (b.name !== undefined) {
    name = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : '';
    if (!name) return res.status(400).json({ error: 'name required' });
  }

  let pointsJson = existing.points_json;
  let pointCount = existing.point_count;
  if (b.points !== undefined) {
    const points = validPoints(b.points);
    if (!points || points.length < 2) return res.status(400).json({ error: 'Invalid points' });
    pointsJson = JSON.stringify(points);
    pointCount = points.length;
  }

  let cutsJson = existing.cuts_json;
  let stageCount = existing.stage_count;
  if (b.cuts !== undefined || b.points !== undefined) {
    const cuts = validCuts(b.cuts ?? JSON.parse(existing.cuts_json || '[]'), pointCount);
    if (!cuts) return res.status(400).json({ error: 'Invalid cuts' });
    cutsJson = JSON.stringify(cuts);
    stageCount = cuts.length + 1;
  }

  let waypointsJson = existing.waypoints_json;
  if (b.waypoints !== undefined) {
    const waypoints = validWaypoints(b.waypoints);
    if (!waypoints) return res.status(400).json({ error: 'Invalid waypoints' });
    waypointsJson = JSON.stringify(waypoints);
  }

  let settingsJson = existing.settings_json;
  if (b.settings !== undefined) {
    const settings = validSettings(b.settings);
    if (!settings) return res.status(400).json({ error: 'Invalid settings' });
    settingsJson = JSON.stringify(settings);
  }

  db.prepare(
    `UPDATE planner_routes SET name = ?, total_distance_km = ?, elevation_gain = ?, elevation_loss = ?,
       point_count = ?, stage_count = ?, points_json = ?, cuts_json = ?, waypoints_json = ?, settings_json = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`
  ).run(
    name,
    b.total_distance_km !== undefined ? num(b.total_distance_km) : existing.total_distance_km,
    b.elevation_gain !== undefined ? num(b.elevation_gain) : existing.elevation_gain,
    b.elevation_loss !== undefined ? num(b.elevation_loss) : existing.elevation_loss,
    pointCount, stageCount, pointsJson, cutsJson, waypointsJson, settingsJson,
    req.params.id, userId,
  );
  const row = db.prepare('SELECT * FROM planner_routes WHERE id = ?').get(req.params.id);
  res.json({ route: parseRow(row) });
});

router.delete('/:id', authenticate, (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.id;
  const info = db.prepare('DELETE FROM planner_routes WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Route not found' });
  res.json({ success: true });
});

export default router;

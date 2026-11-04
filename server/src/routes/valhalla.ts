/**
 * valhalla.ts — the routing engine of this Trek, when it has one (5.7.29).
 *
 *   POST /api/valhalla/:action   → (auth) passed to the Valhalla at VALHALLA_URL
 *
 * The public Valhalla (FOSSGIS) answers one request a second, refuses a search
 * radius over 100 m or more than 10 waypoints, and is down now and then; a
 * Valhalla of one's own (docker-compose `valhalla`) has none of that. The
 * browser reaches it through Trek, on its own origin: no CORS, no port to
 * open, and only for people signed in. Without VALHALLA_URL the browser keeps
 * using the public one (the settings say which: `valhalla_proxy`). What lies
 * outside the region the own one was built for (a trip abroad) is asked of the
 * public one instead, at its pace (VALHALLA_PUBLIC_FALLBACK=off to never).
 */
import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/** What Trek asks a Valhalla for; anything else is not passed on. */
const ACTIONS = new Set(['route', 'trace_route', 'trace_attributes', 'height', 'locate']);
const TIMEOUT_MS = 30_000;
/** The public instance, asked only for what lies outside this Trek's own map (a trip abroad). */
const PUBLIC_VALHALLA = 'https://valhalla1.openstreetmap.de';
/** Valhalla's "no road near this location": the place is off the map it was built from. */
const OFF_THE_MAP = new Set([170, 171]);
/** The public instance takes one request a second from one client; Trek's server is one client. */
const PUBLIC_PAUSE_MS = 1100;
let publicTurn = Promise.resolve();

function askPublic(action: string, body: string): Promise<globalThis.Response> {
  const turn = publicTurn.then(() => fetch(`${PUBLIC_VALHALLA}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'trek' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
  publicTurn = turn.then(() => undefined, () => undefined).then(() => new Promise(r => setTimeout(r, PUBLIC_PAUSE_MS)));
  return turn;
}

function offTheMap(action: string, status: number, text: string): boolean {
  try {
    const data = JSON.parse(text);
    // Heights off the elevation it was built with come back empty or as the "no data" -32768.
    if (action === 'height' && status === 200) {
      const heights: unknown[] = Array.isArray(data.height) ? data.height : Array.isArray(data.range_height) ? data.range_height.map((h: unknown[]) => h?.[1]) : [];
      return heights.some(h => h == null || (typeof h === 'number' && h < -1000));
    }
    return status === 400 && OFF_THE_MAP.has(Number(data.error_code));
  } catch { return false; }
}

export function valhallaUrl(): string | null {
  const url = process.env.VALHALLA_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

router.post('/valhalla/:action', authenticate, async (req: Request, res: Response) => {
  const base = valhallaUrl();
  if (!base) return res.status(503).json({ error: 'No routing engine configured (VALHALLA_URL)' });
  const action = req.params.action;
  if (!ACTIONS.has(action)) return res.status(404).json({ error: 'Unknown action' });
  const body = JSON.stringify(req.body ?? {});
  const fallback = process.env.VALHALLA_PUBLIC_FALLBACK !== 'off';
  let status: number;
  let text: string;
  try {
    const upstream = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = upstream.status;
    text = await upstream.text();
  } catch {
    // Still building its tiles (the first hour or two), restarting, or not there: the public one answers meanwhile.
    status = 502;
    text = JSON.stringify({ error: 'Routing engine unreachable' });
  }
  try {
    // Down, or off this Trek's map (built for one region): the public instance has the world.
    if (fallback && (status >= 500 || offTheMap(action, status, text))) {
      const pub = await askPublic(action, body);
      status = pub.status;
      text = await pub.text();
    }
  } catch { /* the public one did not answer either: the own answer stands, and the map draws the fixes as recorded */ }
  res.status(status).type('application/json').send(text);
});

export default router;

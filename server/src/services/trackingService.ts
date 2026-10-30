import crypto from 'crypto';
import { db, canAccessTrip } from '../db/database';
import { escapeXml } from './tripGpxExport';

/**
 * Tracking en vivo (5.7.1) — Trek as an Overland server.
 *
 * Phones run Overland (https://github.com/happytechca/overland-android, or
 * Overland for iOS) and POST batches of GeoJSON points to
 * /api/tracking/overland with `Authorization: Bearer <device token>`. The
 * format is Overland's own (documented in its README): a `locations` array of
 * Point features with a UTC `timestamp`, and optionally status records — a
 * Feature with `properties.action` and no geometry — that tell a phone quiet
 * by design (in a quiet zone, asleep) from one whose tracking was turned off.
 *
 * Replaces the old "Ubicación en vivo", where the Trek page itself read the
 * GPS and posted every few seconds: Android kills that the moment the screen
 * goes off, and nothing was queued while offline. Overland does both of those
 * jobs properly on the phone; Trek only has to store, show and share.
 *
 * ── Rules the phone depends on ──────────────────────────────────────────────
 *
 * - The answer must be `{"result":"ok"}` or the phone keeps the batch and
 *   sends it again later. So a valid token always gets "ok", even when some
 *   points in the batch were malformed (dropped, not retried forever), and a
 *   resent batch is harmless: a point is unique on (device, timestamp).
 * - A token is a secret shown once: only its SHA-256 is stored.
 */

const TOKEN_PREFIX = 'trk_';
const MAX_FEATURES_PER_BATCH = 5000;
/** Points older than this are refused as junk (a phone clock at 1970, a bogus fix). */
const MAX_AGE_MS = 5 * 365 * 24 * 3600 * 1000;
/** A little slack for a phone clock running ahead. */
const MAX_FUTURE_MS = 24 * 3600 * 1000;
const MAX_POINTS_RETURNED = 5000;
const PUBLIC_WINDOW_HOURS = 24;
const MAX_SHARE_HOURS = 24 * 30;

/** Requests per device per minute — a phone sends one a minute by default. */
const RATE_LIMIT_PER_MIN = 120;
const rateHits = new Map<string, { windowStart: number; count: number }>();

export type DeviceStatus = 'tracking' | 'stopped' | 'quiet' | 'sleeping';

const ACTION_STATUS: Record<string, DeviceStatus> = {
  tracking_started: 'tracking',
  tracking_stopped: 'stopped',
  quiet_zone_entered: 'quiet',
  quiet_zone_left: 'tracking',
  sleeping: 'sleeping',
  awake: 'tracking',
};

interface DeviceRow {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  token_hint: string | null;
  overland_device_id: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_speed: number | null;
  last_altitude: number | null;
  last_motion: string | null;
  last_point_at: string | null;
  battery_level: number | null;
  battery_state: string | null;
  status: DeviceStatus | null;
  status_at: string | null;
  retention_days: number | null;
  share_token: string | null;
  share_label: string | null;
  share_started_at: string | null;
  share_expires_at: string | null;
}

export interface TrackPoint {
  ts: string;
  lat: number;
  lng: number;
  altitude: number | null;
  speed: number | null;
  accuracy: number | null;
  motion: string | null;
  battery_level?: number | null;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
}

function sqlNow(): string {
  return new Date().toISOString();
}

/** What the owner sees of a device — never the token hash, the share token only to its owner. */
function publicDevice(row: DeviceRow) {
  const shareActive = !!row.share_token && (!row.share_expires_at || row.share_expires_at > sqlNow());
  return {
    id: row.id,
    name: row.name,
    token_hint: row.token_hint,
    overland_device_id: row.overland_device_id,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    last_position: row.last_lat != null && row.last_lng != null ? {
      lat: row.last_lat, lng: row.last_lng, accuracy: row.last_accuracy, speed: row.last_speed,
      altitude: row.last_altitude, motion: row.last_motion, recorded_at: row.last_point_at,
    } : null,
    battery_level: row.battery_level,
    battery_state: row.battery_state,
    status: row.status,
    status_at: row.status_at,
    retention_days: row.retention_days,
    share: shareActive ? { token: row.share_token, label: row.share_label, started_at: row.share_started_at, expires_at: row.share_expires_at } : null,
  };
}
export type TrackingDevice = ReturnType<typeof publicDevice>;

function deviceOf(userId: number, deviceId: number): DeviceRow | undefined {
  return db.prepare('SELECT * FROM tracking_devices WHERE id = ? AND user_id = ?').get(deviceId, userId) as DeviceRow | undefined;
}

// ── Devices ────────────────────────────────────────────────────────────────

export function listDevices(userId: number): TrackingDevice[] {
  const rows = db.prepare('SELECT * FROM tracking_devices WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(userId) as DeviceRow[];
  return rows.map(publicDevice);
}

export function getDevice(userId: number, deviceId: number): TrackingDevice | null {
  const row = deviceOf(userId, deviceId);
  return row ? publicDevice(row) : null;
}

/** A new device and its token — the only time the token is ever returned. */
export function createDevice(userId: number, name: string): { device: TrackingDevice; token: string } {
  const token = newToken();
  const result = db.prepare(
    'INSERT INTO tracking_devices (user_id, name, token_hash, token_hint) VALUES (?, ?, ?, ?)'
  ).run(userId, name, hashToken(token), token.slice(-4));
  return { device: getDevice(userId, Number(result.lastInsertRowid))!, token };
}

export function updateDevice(userId: number, deviceId: number, patch: { name?: string; retention_days?: number | null }): TrackingDevice | null {
  const row = deviceOf(userId, deviceId);
  if (!row) return null;
  const name = patch.name !== undefined ? patch.name : row.name;
  const retention = patch.retention_days !== undefined ? patch.retention_days : row.retention_days;
  db.prepare('UPDATE tracking_devices SET name = ?, retention_days = ? WHERE id = ?').run(name, retention, deviceId);
  if (patch.retention_days !== undefined) prune(deviceId, retention);
  return getDevice(userId, deviceId);
}

/** A fresh token; the old one stops working at once. */
export function regenerateToken(userId: number, deviceId: number): { device: TrackingDevice; token: string } | null {
  if (!deviceOf(userId, deviceId)) return null;
  const token = newToken();
  db.prepare('UPDATE tracking_devices SET token_hash = ?, token_hint = ? WHERE id = ?').run(hashToken(token), token.slice(-4), deviceId);
  return { device: getDevice(userId, deviceId)!, token };
}

export function deleteDevice(userId: number, deviceId: number): boolean {
  return db.prepare('DELETE FROM tracking_devices WHERE id = ? AND user_id = ?').run(deviceId, userId).changes > 0;
}

/** Points past the device's retention go. Null keeps everything. */
function prune(deviceId: number, retentionDays: number | null) {
  if (!retentionDays || retentionDays <= 0) return;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();
  db.prepare('DELETE FROM tracking_points WHERE device_id = ? AND ts < ?').run(deviceId, cutoff);
}

// ── Overland ingest ────────────────────────────────────────────────────────

/** Whether a device token may send now; counts the request when it may. */
export function allowRequest(tokenHash: string, now = Date.now()): boolean {
  const hit = rateHits.get(tokenHash);
  if (!hit || now - hit.windowStart >= 60_000) {
    rateHits.set(tokenHash, { windowStart: now, count: 1 });
    if (rateHits.size > 10_000) rateHits.clear();
    return true;
  }
  hit.count++;
  return hit.count <= RATE_LIMIT_PER_MIN;
}

export function deviceByToken(token: string): DeviceRow | undefined {
  if (!token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return undefined;
  return db.prepare('SELECT * FROM tracking_devices WHERE token_hash = ?').get(hashToken(token)) as DeviceRow | undefined;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Overland's "unknown" is -1 for speeds and accuracies. */
const known = (v: unknown): number | null => { const n = num(v); return n == null || n < 0 ? null : n; };

function isoTimestamp(v: unknown, now: number): string | null {
  // Overland sends ISO 8601; some loggers send Unix time instead, in seconds or milliseconds (5.7.9).
  const epoch = typeof v === 'number' ? v : typeof v === 'string' && /^\d{9,13}(\.\d+)?$/.test(v) ? Number(v) : null;
  if (epoch != null && Number.isFinite(epoch)) {
    const ms = epoch < 1e12 ? epoch * 1000 : epoch;
    if (ms < now - MAX_AGE_MS || ms > now + MAX_FUTURE_MS) return null;
    return new Date(Math.round(ms)).toISOString();
  }
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < now - MAX_AGE_MS || t > now + MAX_FUTURE_MS) return null;
  return new Date(t).toISOString();
}

export interface IngestResult {
  received: number;
  stored: number;
  duplicates: number;
  invalid: number;
  statuses: number;
  /** The span of the fixes the batch carried. */
  oldest?: string | null;
  newest?: string | null;
}

/**
 * Whether a batch carries more fixes than one request may: refused whole
 * (413) rather than cut, so the phone keeps them and sends them in smaller
 * parts — Colota halves a refused batch, Overland sends 200 at most anyway.
 */
export function batchTooBig(body: unknown): boolean {
  const raw = body && typeof body === 'object' ? (body as { locations?: unknown }).locations : null;
  return Array.isArray(raw) && raw.length > MAX_FEATURES_PER_BATCH;
}

/** How many uploads per device the log keeps. */
const INGEST_LOG_KEEP = 200;

/**
 * One upload in the device's log (5.7.9): when, what came back, how many
 * fixes it carried and what became of them, and which app sent it. What
 * makes a lost point traceable: never in a batch is the phone; in a batch but
 * not stored is here.
 */
export function logIngest(deviceId: number, httpStatus: number, result: Partial<IngestResult> | null, client: string | null): void {
  try {
    db.prepare(`INSERT INTO tracking_ingests (device_id, at, http_status, received, stored, duplicates, invalid, oldest_ts, newest_ts, client)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      deviceId, new Date().toISOString(), httpStatus, result?.received ?? 0, result?.stored ?? 0, result?.duplicates ?? 0,
      result?.invalid ?? 0, result?.oldest ?? null, result?.newest ?? null, client ? client.slice(0, 120) : null,
    );
    db.prepare(`DELETE FROM tracking_ingests WHERE device_id = ? AND id <= (
                  SELECT id FROM tracking_ingests WHERE device_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`).run(deviceId, deviceId, INGEST_LOG_KEEP);
  } catch { /* the log is a diagnosis aid; it never fails an upload */ }
}

export interface IngestLogRow {
  at: string; http_status: number; received: number; stored: number; duplicates: number; invalid: number;
  oldest_ts: string | null; newest_ts: string | null; client: string | null;
}

/** A device's latest uploads, newest first. */
export function listIngests(userId: number, deviceId: number, limit = 50): IngestLogRow[] | null {
  if (!deviceOf(userId, deviceId)) return null;
  return db.prepare(`SELECT at, http_status, received, stored, duplicates, invalid, oldest_ts, newest_ts, client
                       FROM tracking_ingests WHERE device_id = ? ORDER BY id DESC LIMIT ?`).all(deviceId, Math.min(200, Math.max(1, limit))) as IngestLogRow[];
}

/**
 * Store one Overland batch for a device. Malformed features are counted and
 * dropped; visits (Overland iOS `arrival_date` records) are not points and are
 * skipped; status records move the device's status when newer than the last.
 */
export function ingestOverland(device: DeviceRow, body: unknown): IngestResult {
  const now = Date.now();
  const raw = (body && typeof body === 'object' ? (body as { locations?: unknown }).locations : null);
  // The route refuses a bigger batch whole (batchTooBig) before it gets here.
  const features = Array.isArray(raw) ? raw.slice(0, MAX_FEATURES_PER_BATCH) : [];
  const result: IngestResult = { received: features.length, stored: 0, duplicates: 0, invalid: 0, statuses: 0 };

  const points: (TrackPoint & { battery_state: string | null; overland_id: string | null })[] = [];
  let newestStatus: { status: DeviceStatus; at: string } | null = null;

  for (const f of features) {
    const props = (f && typeof f === 'object' ? (f as { properties?: Record<string, unknown> }).properties : null) ?? null;
    if (!props || typeof props !== 'object') { result.invalid++; continue; }

    if (typeof props.action === 'string') {
      const status = ACTION_STATUS[props.action];
      const at = isoTimestamp(props.timestamp, now);
      if (status && at) {
        result.statuses++;
        if (!newestStatus || at > newestStatus.at) newestStatus = { status, at };
      } else result.invalid++;
      continue;
    }
    // A visit (Overland iOS) is a summary of a stay, not a fix.
    if ('arrival_date' in props) continue;

    const geom = (f as { geometry?: { type?: unknown; coordinates?: unknown } }).geometry;
    const coords = geom && geom.type === 'Point' && Array.isArray(geom.coordinates) ? geom.coordinates : null;
    const lng = num(coords?.[0]);
    const lat = num(coords?.[1]);
    const ts = isoTimestamp(props.timestamp, now);
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !ts) { result.invalid++; continue; }

    const motion = Array.isArray(props.motion)
      ? props.motion.filter((m): m is string => typeof m === 'string' && /^[a-z_]{1,20}$/.test(m)).slice(0, 4).join(',') || null
      : null;
    const battery = num(props.battery_level);
    points.push({
      ts, lat, lng,
      altitude: num(props.altitude),
      speed: known(props.speed),
      accuracy: known(props.horizontal_accuracy),
      motion,
      battery_level: battery != null && battery >= 0 && battery <= 1 ? battery : null,
      battery_state: typeof props.battery_state === 'string' ? props.battery_state.slice(0, 20) : null,
      overland_id: typeof props.device_id === 'string' ? props.device_id.slice(0, 80) : null,
    });
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tracking_points (device_id, ts, lat, lng, altitude, speed, accuracy, motion, battery_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const p of points) {
      const r = insert.run(device.id, p.ts, p.lat, p.lng, p.altitude, p.speed, p.accuracy, p.motion, p.battery_level ?? null);
      if (r.changes > 0) result.stored++; else result.duplicates++;
    }

    const newest = points.reduce<(typeof points)[number] | null>((best, p) => (!best || p.ts > best.ts ? p : best), null);
    const updates: string[] = ['last_seen_at = ?'];
    const args: unknown[] = [sqlNow()];
    if (newest && (!device.last_point_at || newest.ts >= device.last_point_at)) {
      updates.push('last_lat = ?', 'last_lng = ?', 'last_accuracy = ?', 'last_speed = ?', 'last_altitude = ?', 'last_motion = ?', 'last_point_at = ?')
      args.push(newest.lat, newest.lng, newest.accuracy, newest.speed, newest.altitude, newest.motion, newest.ts);
      if (newest.battery_level != null) { updates.push('battery_level = ?'); args.push(newest.battery_level); }
      if (newest.battery_state) { updates.push('battery_state = ?'); args.push(newest.battery_state); }
      if (newest.overland_id) { updates.push('overland_device_id = ?'); args.push(newest.overland_id); }
    }
    // A status record moves the status when it is the latest thing known; a
    // point newer than a "stopped" or "asleep" says the phone is tracking again.
    // (A point inside a quiet zone is a trip leaving it; the zone's own
    // "left" record is what ends the quiet status.)
    let status = device.status;
    let statusAt = device.status_at ?? '';
    if (newestStatus && newestStatus.at >= statusAt) { status = newestStatus.status; statusAt = newestStatus.at; }
    if (newest && newest.ts > statusAt && status !== 'quiet') { status = 'tracking'; statusAt = newest.ts; }
    if (status !== device.status || statusAt !== (device.status_at ?? '')) {
      updates.push('status = ?', 'status_at = ?'); args.push(status, statusAt);
    }
    args.push(device.id);
    db.prepare(`UPDATE tracking_devices SET ${updates.join(', ')} WHERE id = ?`).run(...args);
  })();

  prune(device.id, device.retention_days);
  for (const p of points) {
    if (!result.oldest || p.ts < result.oldest) result.oldest = p.ts;
    if (!result.newest || p.ts > result.newest) result.newest = p.ts;
  }
  return result;
}

// ── Reading the track ──────────────────────────────────────────────────────

/** Every n-th point so a long range stays drawable; the first and last always kept. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

function pointsBetween(deviceId: number, from: string, to: string, maxAccuracy?: number): TrackPoint[] {
  const rows = db.prepare(`
    SELECT ts, lat, lng, altitude, speed, accuracy, motion, battery_level FROM tracking_points
     WHERE device_id = ? AND ts >= ? AND ts <= ? ${maxAccuracy ? 'AND (accuracy IS NULL OR accuracy <= ?)' : ''}
     ORDER BY ts ASC
  `).all(...(maxAccuracy ? [deviceId, from, to, maxAccuracy] : [deviceId, from, to])) as TrackPoint[];
  return rows;
}

export function parseInstant(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** A device's points in [from, to], thinned to what a map can draw. */
export function getTrack(userId: number, deviceId: number, from: string, to: string, maxAccuracy?: number) {
  if (!deviceOf(userId, deviceId)) return null;
  const all = pointsBetween(deviceId, from, to, maxAccuracy);
  // The fixes left out as imprecise, so the map can say a hole is a filter and not a loss (5.7.9).
  const hidden = maxAccuracy
    ? (db.prepare('SELECT COUNT(*) AS n FROM tracking_points WHERE device_id = ? AND ts >= ? AND ts <= ? AND accuracy > ?').get(deviceId, from, to, maxAccuracy) as { n: number }).n
    : 0;
  return { total: all.length, hidden, points: downsample(all, MAX_POINTS_RETURNED), stats: trackStats(all) };
}

/** How many points each local day holds, for the history calendar. `offsetMinutes` is the viewer's UTC offset. */
export function getDays(userId: number, deviceId: number, offsetMinutes: number) {
  if (!deviceOf(userId, deviceId)) return null;
  const off = Math.max(-14 * 60, Math.min(14 * 60, Math.round(offsetMinutes)));
  return db.prepare(`
    SELECT date(ts, ? || ' minutes') AS day, COUNT(*) AS points, MIN(ts) AS first, MAX(ts) AS last
      FROM tracking_points WHERE device_id = ? GROUP BY day ORDER BY day DESC LIMIT 400
  `).all(`${off >= 0 ? '+' : ''}${off}`, deviceId) as { day: string; points: number; first: string; last: string }[];
}

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distance, time span and the motion seen most, from the full (not thinned) points. */
export function trackStats(points: TrackPoint[]) {
  let distance = 0;
  const motions = new Map<string, number>();
  for (let i = 0; i < points.length; i++) {
    if (i > 0) distance += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    for (const m of (points[i].motion ?? '').split(',')) if (m && m !== 'stationary') motions.set(m, (motions.get(m) ?? 0) + 1);
  }
  const dominant = [...motions].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    distance_m: Math.round(distance),
    start: points[0]?.ts ?? null,
    end: points[points.length - 1]?.ts ?? null,
    duration_s: points.length > 1 ? Math.round((Date.parse(points[points.length - 1].ts) - Date.parse(points[0].ts)) / 1000) : 0,
    motion: dominant,
  };
}

/** The points as a GPX 1.1 track, for download or for saving as a trip route. */
export function toGpx(name: string, points: TrackPoint[]): string {
  const pts = points.map(p => {
    const ele = p.altitude != null ? `<ele>${p.altitude}</ele>` : '';
    return `      <trkpt lat="${p.lat}" lon="${p.lng}">${ele}<time>${p.ts}</time></trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TREK — Tracking en vivo (Overland)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function exportGpx(userId: number, deviceId: number, from: string, to: string, maxAccuracy?: number) {
  const row = deviceOf(userId, deviceId);
  if (!row) return null;
  const points = pointsBetween(deviceId, from, to, maxAccuracy);
  return { name: `${row.name} ${from.slice(0, 10)}`, xml: toGpx(`${row.name} ${from.slice(0, 10)}`, points), count: points.length };
}

const MOTION_TO_MODE: Record<string, string> = { cycling: 'cycling', walking: 'walking', running: 'running', driving: 'driving', automotive: 'driving' };

/**
 * Save a stretch of the track as a route of a trip (a gpx_tracks row), so it
 * shows on the trip, the journey and the Studio like any uploaded GPX.
 * `saveTrack` is the GPX tab's own writer, so stats are computed the same way.
 */
/**
 * A drawn line (the track as matched to streets and paths, 5.7.3) given the
 * time and altitude of the recorded fix nearest each of its points. Both run
 * the same way along the day, so the nearest fix is found by walking forward
 * through the fixes with the line rather than searching all of them each time.
 */
export function lineWithFixes(line: [number, number][], points: TrackPoint[]): { lat: number; lng: number; ele: number | null; time: string | null }[] {
  let j = 0;
  return line.map(([lat, lng]) => {
    while (j < points.length - 1
      && haversineM(lat, lng, points[j + 1].lat, points[j + 1].lng) <= haversineM(lat, lng, points[j].lat, points[j].lng)) j++;
    const p = points[j];
    return { lat, lng, ele: p?.altitude ?? null, time: p?.ts ?? null };
  });
}

export function saveAsRoute(
  userId: number, deviceId: number,
  opts: { from: string; to: string; tripId: number; dayId?: number | null; name?: string; maxAccuracy?: number; line?: [number, number][] },
  saveTrack: (tripId: number, userId: number, name: string, orig: string | null,
    points: { lat: number; lng: number; ele: number | null; time?: string | null }[],
    waypoints: { lat: number; lng: number; name: string }[], sortOrder: number, dayId?: number | null, mode?: any) => number,
): { trackId: number; points: number } | { error: string; status: number } {
  const row = deviceOf(userId, deviceId);
  if (!row) return { error: 'Device not found', status: 404 };
  if (!canAccessTrip(opts.tripId, userId)) return { error: 'Trip not found', status: 404 };
  if (opts.dayId != null) {
    const day = db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(opts.dayId, opts.tripId);
    if (!day) return { error: 'Day not in this trip', status: 400 };
  }
  const points = pointsBetween(deviceId, opts.from, opts.to, opts.maxAccuracy);
  if (points.length < 2) return { error: 'Not enough points in that range', status: 400 };
  const stats = trackStats(points);
  const name = (opts.name?.trim() || `${row.name} · ${opts.from.slice(0, 10)}`).slice(0, 120);
  const sortRow = db.prepare('SELECT COUNT(*) as n FROM gpx_tracks WHERE trip_id = ?').get(opts.tripId) as { n: number };
  // The route along the ways when the map drew one, else the recorded fixes.
  const shape = opts.line && opts.line.length > 1
    ? lineWithFixes(opts.line, points)
    : points.map(p => ({ lat: p.lat, lng: p.lng, ele: p.altitude, time: p.ts }));
  const trackId = saveTrack(
    opts.tripId, userId, name, 'overland.gpx',
    shape,
    [], sortRow.n, opts.dayId ?? null, stats.motion ? MOTION_TO_MODE[stats.motion] ?? null : null,
  );
  if (stats.duration_s) db.prepare('UPDATE gpx_tracks SET duration_seconds = ? WHERE id = ?').run(stats.duration_s, trackId);
  return { trackId, points: points.length };
}

// ── Sharing ────────────────────────────────────────────────────────────────

export function startShare(userId: number, deviceId: number, hours: number, label?: string | null): TrackingDevice | null {
  const row = deviceOf(userId, deviceId);
  if (!row) return null;
  const h = Math.max(1, Math.min(MAX_SHARE_HOURS, Math.round(hours || 24)));
  const expires = new Date(Date.now() + h * 3600 * 1000).toISOString();
  const active = row.share_token && (!row.share_expires_at || row.share_expires_at > sqlNow());
  const token = active ? row.share_token : crypto.randomBytes(24).toString('base64url');
  const started = active ? row.share_started_at : sqlNow();
  db.prepare('UPDATE tracking_devices SET share_token = ?, share_label = ?, share_started_at = ?, share_expires_at = ? WHERE id = ?')
    .run(token, label?.trim().slice(0, 80) || null, started, expires, deviceId);
  return getDevice(userId, deviceId);
}

export function stopShare(userId: number, deviceId: number): TrackingDevice | null {
  if (!deviceOf(userId, deviceId)) return null;
  db.prepare('UPDATE tracking_devices SET share_token = NULL, share_label = NULL, share_started_at = NULL, share_expires_at = NULL WHERE id = ?').run(deviceId);
  return getDevice(userId, deviceId);
}

/**
 * What the person with the link sees: where the phone is, how fresh that
 * is, and the track since the link was made (at most the last day). Null for
 * an unknown or expired link.
 */
export function getPublicShare(token: string) {
  if (!token || token.length > 100) return null;
  const row = db.prepare('SELECT * FROM tracking_devices WHERE share_token = ?').get(token) as DeviceRow | undefined;
  if (!row || (row.share_expires_at && row.share_expires_at <= sqlNow())) return null;
  const windowStart = new Date(Date.now() - PUBLIC_WINDOW_HOURS * 3600 * 1000).toISOString();
  const from = row.share_started_at && row.share_started_at > windowStart ? row.share_started_at : windowStart;
  const points = pointsBetween(row.id, from, '9999');
  const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(row.user_id) as { username: string } | undefined;
  return {
    label: row.share_label || owner?.username || row.name,
    expires_at: row.share_expires_at,
    status: row.status,
    status_at: row.status_at,
    battery_level: row.battery_level,
    last_position: row.last_lat != null ? {
      lat: row.last_lat, lng: row.last_lng, accuracy: row.last_accuracy, speed: row.last_speed,
      altitude: row.last_altitude, motion: row.last_motion, recorded_at: row.last_point_at,
    } : null,
    track: downsample(points, 3000).map(p => ({ lat: p.lat, lng: p.lng, ts: p.ts, motion: p.motion })),
    stats: trackStats(points),
  };
}

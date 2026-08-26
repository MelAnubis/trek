import { db } from '../db/database';
import crypto from 'crypto';

const DEFAULT_TTL_HOURS = 24;
// Cap the number of points returned to a public viewer so a multi-day share
// doesn't ship megabytes of track history on every poll.
const MAX_POINTS_RETURNED = 3000;

export interface LiveLocationPoint {
  lat: number;
  lng: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  recorded_at?: string; // ISO string; defaults to now if omitted
}

interface LiveShareRow {
  id: number;
  user_id: number;
  token: string;
  label: string | null;
  active: number;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_speed: number | null;
  last_altitude: number | null;
  last_recorded_at: string | null;
  created_at: string;
  stopped_at: string | null;
  expires_at: string | null;
}

/**
 * Starts (or resumes) live location sharing for a user. A user can only
 * have one active share at a time — calling this again while one is
 * already active just returns the existing token instead of creating a
 * second, orphaned share.
 */
export function startShare(userId: number, label?: string): { token: string; created: boolean; expires_at: string } {
  const existing = db.prepare(
    "SELECT * FROM live_locations WHERE user_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(userId) as LiveShareRow | undefined;
  if (existing) {
    return { token: existing.token, created: false, expires_at: existing.expires_at! };
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO live_locations (user_id, token, label, active, expires_at) VALUES (?, ?, ?, 1, ?)'
  ).run(userId, token, label || null, expiresAt);
  return { token, created: true, expires_at: expiresAt };
}

/** Stops the user's active share, if any. Idempotent. */
export function stopShare(userId: number): void {
  db.prepare(
    "UPDATE live_locations SET active = 0, stopped_at = datetime('now') WHERE user_id = ? AND active = 1"
  ).run(userId);
}

/** Returns the user's currently active share (for the app to know whether it's already sharing). */
export function getMine(userId: number): LiveShareRow | null {
  const row = db.prepare(
    "SELECT * FROM live_locations WHERE user_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id DESC LIMIT 1"
  ).get(userId) as LiveShareRow | undefined;
  return row || null;
}

/**
 * Appends a GPS point to an active share owned by the given user, and
 * updates the "last known position" snapshot on the share row itself so
 * public reads don't need to touch the (potentially large) points table
 * just to show the current marker.
 */
export function addPoint(userId: number, token: string, point: LiveLocationPoint): boolean {
  const share = db.prepare(
    "SELECT id FROM live_locations WHERE token = ? AND user_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(token, userId) as { id: number } | undefined;
  if (!share) return false;

  const recordedAt = point.recorded_at || new Date().toISOString();
  db.prepare(
    'INSERT INTO live_location_points (share_id, lat, lng, accuracy, altitude, speed, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(share.id, point.lat, point.lng, point.accuracy ?? null, point.altitude ?? null, point.speed ?? null, recordedAt);

  db.prepare(
    'UPDATE live_locations SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_speed = ?, last_altitude = ?, last_recorded_at = ? WHERE id = ?'
  ).run(point.lat, point.lng, point.accuracy ?? null, point.speed ?? null, point.altitude ?? null, recordedAt, share.id);

  return true;
}

/**
 * Public read for the viewer page — no auth, just the token from the link.
 * Returns null for an unknown, stopped, or expired share so the viewer can
 * show a clean "this link is no longer active" state.
 */
export function getPublicStatus(token: string): Record<string, unknown> | null {
  const share = db.prepare(
    "SELECT * FROM live_locations WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(token) as LiveShareRow | undefined;
  if (!share) return null;

  const points = db.prepare(
    'SELECT lat, lng, recorded_at FROM live_location_points WHERE share_id = ? ORDER BY recorded_at ASC LIMIT ?'
  ).all(share.id, MAX_POINTS_RETURNED) as { lat: number; lng: number; recorded_at: string }[];

  return {
    active: !!share.active,
    label: share.label,
    started_at: share.created_at,
    stopped_at: share.stopped_at,
    last_position: share.last_lat != null ? {
      lat: share.last_lat,
      lng: share.last_lng,
      accuracy: share.last_accuracy,
      speed: share.last_speed,
      altitude: share.last_altitude,
      recorded_at: share.last_recorded_at,
    } : null,
    track: points,
  };
}

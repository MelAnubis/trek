/**
 * Tracking en vivo (5.7.1) — the shapes the server sends and the small,
 * testable rules the pages draw with: how fresh a fix is, what a status is
 * called, which colour a motion gets, and the instants of a local day.
 */

export type TrackingStatus = 'tracking' | 'stopped' | 'quiet' | 'sleeping' | null

export interface TrackingPosition {
  lat: number
  lng: number
  accuracy: number | null
  speed: number | null
  altitude: number | null
  motion: string | null
  recorded_at: string | null
}

export interface TrackingDevice {
  id: number
  name: string
  token_hint: string | null
  overland_device_id: string | null
  created_at: string
  last_seen_at: string | null
  last_position: TrackingPosition | null
  battery_level: number | null
  battery_state: string | null
  status: TrackingStatus
  status_at: string | null
  retention_days: number | null
  share: { token: string; label: string | null; started_at: string | null; expires_at: string | null } | null
}

export interface TrackPoint {
  ts: string
  lat: number
  lng: number
  altitude?: number | null
  speed?: number | null
  accuracy?: number | null
  motion: string | null
}

export interface TrackStats {
  distance_m: number
  start: string | null
  end: string | null
  duration_s: number
  motion: string | null
}

/** The address to paste into Overland's "Receiver endpoint URL". */
export function overlandEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/tracking/overland`
}

/** The public viewer for a share token. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/live/${token}`
}

/** A point's main motion: the first that is not "stationary", else "stationary", else null. */
export function mainMotion(motion: string | null | undefined): string | null {
  if (!motion) return null
  const list = motion.split(',').filter(Boolean)
  return list.find(m => m !== 'stationary') ?? (list.includes('stationary') ? 'stationary' : null)
}

export const MOTION_COLORS: Record<string, string> = {
  driving: '#2563eb',
  automotive: '#2563eb',
  cycling: '#16a34a',
  walking: '#ea580c',
  running: '#dc2626',
  stationary: '#6b7280',
}
const UNKNOWN_COLOR = '#7c3aed'

export function motionColor(motion: string | null | undefined): string {
  const m = mainMotion(motion)
  return (m && MOTION_COLORS[m]) || UNKNOWN_COLOR
}

/**
 * The track cut into runs of the same motion, each run sharing its first
 * point with the previous run's last so the line has no gaps.
 */
export function motionSegments(points: TrackPoint[]): { color: string; motion: string | null; positions: [number, number][] }[] {
  const out: { color: string; motion: string | null; positions: [number, number][] }[] = []
  for (const p of points) {
    const motion = mainMotion(p.motion)
    const last = out[out.length - 1]
    if (last && last.motion === motion) { last.positions.push([p.lat, p.lng]); continue }
    const start: [number, number][] = last ? [last.positions[last.positions.length - 1]] : []
    out.push({ motion, color: motionColor(p.motion), positions: [...start, [p.lat, p.lng]] })
  }
  return out.filter(s => s.positions.length > 1 || out.length === 1)
}

/** Minutes since an instant, never negative (a phone clock a little ahead). */
export function minutesAgo(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null
}

/** Whether the last fix is recent enough to call the device live. */
export function isFresh(device: Pick<TrackingDevice, 'last_position'>, now = Date.now(), maxMinutes = 15): boolean {
  const m = minutesAgo(device.last_position?.recorded_at, now)
  return m != null && m <= maxMinutes
}

/** The local day `yyyy-mm-dd` as the UTC instants of its first and last millisecond. */
export function localDayRange(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** Today as a local `yyyy-mm-dd`. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** The viewer's UTC offset in minutes, the sign the server's day grouping wants (Madrid in winter = +60). */
export function utcOffsetMinutes(now = new Date()): number {
  return -now.getTimezoneOffset()
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km` : `${Math.round(m)} m`
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const min = Math.round((s % 3600) / 60)
  return h ? `${h} h ${String(min).padStart(2, '0')} min` : `${min} min`
}

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

/** One trip of a day (5.7.21): from setting off to stopping for a while. */
export interface DayTrip {
  /** 1, 2, … in the order they were made. */
  n: number
  from: string
  to: string
  points: TrackPoint[]
  distanceM: number
  durationS: number
  /** How most of it was travelled, by fixes, standing aside. */
  motion: string | null
}

/** A stop this long (staying within `STAY_M`) ends one trip and the next starts when the phone moves on. */
export const TRIP_STOP_MS = 20 * 60 * 1000
const STAY_M = 200
/**
 * Whether the time between two fixes is a stop (the end of one trip) rather
 * than a hole in a recording on the move: 20 minutes or more, at walking pace
 * at most between them. A phone that stopped recording during a ride has
 * covered kilometres in that time, and the map bridges that hole instead.
 */
export function isStopBetween(a: { ts: string; lat: number; lng: number }, b: { ts: string; lat: number; lng: number }): boolean {
  const ms = Date.parse(b.ts) - Date.parse(a.ts)
  if (ms < TRIP_STOP_MS) return false
  const m = metres(a, b)
  return m < 500 || (m / 1000) / (ms / 3_600_000) < 3
}

/** Shorter than this, a "trip" is the phone settling down, not a trip. */
const MIN_TRIP_M = 300

export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLa = (b.lat - a.lat) * Math.PI / 180
  const dLo = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/**
 * How far the fixes went (5.7.27): not the fixes joined one to the next,
 * which counts every wobble of a phone standing still and every fix that
 * jumps out and back. A fix that jumps out and straight back is left out,
 * and while the phone says it is standing still a move is only counted once
 * it takes it further than the fixes' spread. The server counts a day the
 * same way (trackingService.ts pathLengthM).
 */
type PathFix = { lat: number; lng: number; accuracy?: number | null; speed?: number | null; motion?: string | null }
/** A fix of a phone that says it is standing still (and is not moving fast). */
const still = (p: PathFix) => !!p.motion && p.motion.split(',').every(m => m === 'stationary') && (p.speed == null || p.speed < 0.7)
export function pathLength(points: PathFix[]): number {
  const acc = (p: PathFix) => (p.accuracy != null && p.accuracy > 0 ? p.accuracy : 10)
  let total = 0
  let anchor = points[0]
  let prev = points[0]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const next = points[i + 1]
    if (next) {
      const away = Math.min(metres(prev, p), metres(p, next))
      if (away > Math.max(40, 2 * acc(p)) && away > 3 * metres(prev, next)) continue
    }
    prev = p
    const d = metres(anchor, p)
    // Standing still, a move within the fixes' spread is the phone wobbling, not going anywhere.
    if (!still(p) || d > Math.min(50, Math.max(10, 1.5 * Math.max(acc(anchor), acc(p))))) { total += d; anchor = p }
  }
  return total
}

/**
 * A day's fixes as the trips it holds (5.7.21): a morning ride, lunch, the
 * drive home. A trip ends where the phone stays within 200 m for 20 minutes
 * or more, or records nothing for that long, and the next one starts where it
 * moves on; the stop itself belongs to neither. Trips under 300 m are left
 * out (a phone settling on a table). A day with one trip answers that one.
 */
export function splitTrips(points: TrackPoint[]): DayTrip[] {
  const t = (p: TrackPoint) => Date.parse(p.ts)
  const cuts: { end: number; start: number }[] = []
  let i = 0
  while (i < points.length - 1) {
    // A long hole at walking pace at most is a stop too; one covered at riding speed is a recording that dropped out.
    if (isStopBetween(points[i], points[i + 1])) { cuts.push({ end: i, start: i + 1 }); i++; continue }
    let j = i + 1
    while (j < points.length && metres(points[i], points[j]) <= STAY_M) j++
    // Fixes i … j-1 stayed within reach of i: a stop when they lasted long enough.
    if (j - 1 > i && t(points[j - 1]) - t(points[i]) >= TRIP_STOP_MS) { cuts.push({ end: i, start: j - 1 }); i = j - 1; continue }
    i++
  }
  const pieces: TrackPoint[][] = []
  let from = 0
  for (const c of cuts) { pieces.push(points.slice(from, c.end + 1)); from = c.start }
  pieces.push(points.slice(from))
  const trips: DayTrip[] = []
  for (const piece of pieces) {
    if (piece.length < 2) continue
    const d = pathLength(piece)
    if (d < MIN_TRIP_M) continue
    const count = new Map<string, number>()
    for (const p of piece) { const m = mainMotion(p.motion); if (m && m !== 'stationary') count.set(m, (count.get(m) ?? 0) + 1) }
    trips.push({
      n: trips.length + 1, from: piece[0].ts, to: piece[piece.length - 1].ts, points: piece, distanceM: Math.round(d),
      durationS: Math.round((t(piece[piece.length - 1]) - t(piece[0])) / 1000),
      motion: [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    })
  }
  return trips
}

/**
 * Whether the line shown ends where the phone is now, so the live position is
 * joined to it (5.7.23): the whole day, or its last trip. An earlier trip ends
 * where that trip ended, and a dotted line from it across the map to where the
 * phone is now read as part of the trip.
 */
export function joinsLive(trip: DayTrip | null, trips: DayTrip[]): boolean {
  return !trip || trip.n === trips[trips.length - 1]?.n
}

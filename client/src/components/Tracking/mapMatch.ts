/**
 * Tracking en vivo (5.7.3) — the recorded points drawn along the streets and
 * paths they were taken on, instead of straight lines from fix to fix.
 *
 * A GPS logger only knows where it was every so often (Overland sends a fix
 * after ~25 m by default, every ~2 min when it thinks the phone is still), and
 * a fix between buildings can be 10–30 m off. Joined straight, a walk round
 * the block becomes a few diagonals with spikes in them. Two steps fix that:
 *
 * 1. `cleanTrack` drops the obvious junk: a fix that jumps out and straight
 *    back (a spike), and fixes jittering inside their own accuracy while
 *    standing still.
 * 2. The rest goes to Valhalla's map matching (`trace_route` with
 *    `map_snap`), the same public FOSSGIS instance the tour planner already
 *    uses, paced through its one-request-a-second turn (tours/routing/
 *    valhalla.ts). Each stretch is matched with the costing of how it was
 *    travelled — on foot as a pedestrian (steps and paths allowed), by bike
 *    as a bicycle, by car as a car — and a long gap in time or space starts
 *    a new stretch, so a train ride or a tunnel is never "routed" through.
 *
 * Every stretch that cannot be matched (no road under it, the router down, an
 * operator's own router without matching) is drawn from the cleaned points as
 * before. Matching changes only the drawing, never the stored points.
 */
import { valhallaBase, valhallaTurn } from '../../tours/routing/valhalla'
import { decodePolyline } from '../../tours/routing/polyline'
import { mainMotion, motionColor, type TrackPoint } from './trackingModel'

export type Costing = 'pedestrian' | 'bicycle' | 'auto'

export interface MatchedLine {
  color: string
  motion: string | null
  positions: [number, number][]
  /** False when the line is the cleaned GPS points because matching failed or was not asked. */
  matched: boolean
}

/** A pause this long between two fixes starts a new stretch: the phone was off, in a tunnel, on a train. */
const GAP_MS = 10 * 60 * 1000
/** A jump this far between two fixes starts a new stretch too. */
const GAP_M = 3000
/** The most points one matching request carries; a longer stretch goes in windows. */
const WINDOW = 1500
/** The most requests one track may take; past that the rest is drawn unmatched. */
const MAX_REQUESTS = 15
const TIMEOUT_MS = 20_000

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLa = (b.lat - a.lat) * Math.PI / 180
  const dLo = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

const acc = (p: TrackPoint) => (p.accuracy != null && p.accuracy > 0 ? p.accuracy : 15)

/**
 * The points without spikes and stand-still jitter.
 *
 * A spike: B is much further from A and from C than A and C are from each
 * other (out and straight back), and further than its own accuracy — the
 * classic bad fix. Jitter: a fix within its accuracy of the last kept one,
 * while not driving or riding, adds nothing but a scribble. The first and
 * last points are always kept, so the track still starts and ends where it did.
 */
export function cleanTrack(points: TrackPoint[]): TrackPoint[] {
  if (points.length < 3) return points.slice()
  const noSpikes: TrackPoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = noSpikes[noSpikes.length - 1]
    const b = points[i]
    const c = points[i + 1]
    const ab = distM(a, b)
    const bc = distM(b, c)
    const ac = distM(a, c)
    const out = Math.min(ab, bc)
    if (out > Math.max(40, 2 * acc(b)) && out > 3 * ac) continue
    noSpikes.push(b)
  }
  noSpikes.push(points[points.length - 1])

  const out: TrackPoint[] = [noSpikes[0]]
  for (let i = 1; i < noSpikes.length; i++) {
    const p = noSpikes[i]
    const last = out[out.length - 1]
    const m = mainMotion(p.motion)
    const moving = m === 'driving' || m === 'automotive' || m === 'cycling'
    if (i < noSpikes.length - 1 && !moving && distM(last, p) < Math.min(25, Math.max(acc(p), acc(last)))) continue
    out.push(p)
  }
  return out
}

/** How a stretch is matched, from how it was travelled. Unknown and still count as on foot, the costing that refuses the fewest ways. */
export function costingFor(motion: string | null): Costing {
  if (motion === 'driving' || motion === 'automotive') return 'auto'
  if (motion === 'cycling') return 'bicycle'
  return 'pedestrian'
}

export interface Stretch {
  costing: Costing
  motion: string | null
  points: TrackPoint[]
}

/**
 * The cleaned points cut where the way of travelling changes (by costing, so
 * walking and standing are one stretch) and at every long gap. A stretch of
 * one or two points joins its neighbour rather than being matched alone; the
 * cut point is shared so the drawn line has no holes.
 */
export function stretches(points: TrackPoint[]): Stretch[] {
  const out: Stretch[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const motion = mainMotion(p.motion)
    const costing = costingFor(motion)
    const last = out[out.length - 1]
    const prev = points[i - 1]
    const gap = !!prev && (Date.parse(p.ts) - Date.parse(prev.ts) > GAP_MS || distM(prev, p) > GAP_M)
    if (last && !gap && last.costing === costing) { last.points.push(p); continue }
    if (last && !gap && last.points.length < 3) {
      // Too short to be its own stretch: take its points into this one.
      last.points.push(p); last.costing = costing; last.motion = motion; continue
    }
    out.push({ costing, motion, points: last && !gap ? [last.points[last.points.length - 1], p] : [p] })
  }
  // A stretch is coloured by how most of it was travelled, standing still aside.
  for (const st of out) {
    const count = new Map<string, number>()
    for (const p of st.points) { const m = mainMotion(p.motion); if (m && m !== 'stationary') count.set(m, (count.get(m) ?? 0) + 1) }
    st.motion = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (st.points.some(p => mainMotion(p.motion) === 'stationary') ? 'stationary' : null)
  }
  return out
}

const COSTING_OPTIONS: Record<Costing, Record<string, unknown>> = {
  pedestrian: { pedestrian: { max_hiking_difficulty: 6 } },
  bicycle: { bicycle: { bicycle_type: 'Hybrid' } },
  auto: {},
}

/** One stretch's points as Valhalla matched them to the network, or null. */
export async function matchPoints(points: TrackPoint[], costing: Costing, signal?: AbortSignal): Promise<[number, number][] | null> {
  const base = valhallaBase()
  if (!base || points.length < 2) return null
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
  try {
    await valhallaTurn(base, signal)
    if (signal?.aborted) return null
    const response = await fetch(`${base}/trace_route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'trek' },
      body: JSON.stringify({
        shape: points.map(p => ({ lat: p.lat, lon: p.lng, time: Math.round(Date.parse(p.ts) / 1000) })),
        costing,
        costing_options: COSTING_OPTIONS[costing],
        shape_match: 'map_snap',
        // The fixes' own spread decides how far a point may be from its road.
        trace_options: { search_radius: 60, gps_accuracy: 20, breakage_distance: GAP_M, turn_penalty_factor: 200 },
        use_timestamps: true,
        directions_options: { units: 'kilometers', directions_type: 'none' },
      }),
      signal: bounded,
    })
    if (!response.ok) return null
    const data = await response.json() as { trip?: { legs?: { shape?: string }[] } }
    const line = (data.trip?.legs ?? []).flatMap(l => (l.shape ? decodePolyline(l.shape, 6) : []))
    return line.length > 1 ? line : null
  } catch {
    return null
  }
}

/** Stretches split into request-sized windows that overlap by one point. */
function windows(points: TrackPoint[]): TrackPoint[][] {
  if (points.length <= WINDOW) return [points]
  const out: TrackPoint[][] = []
  for (let i = 0; i < points.length - 1; i += WINDOW - 1) out.push(points.slice(i, i + WINDOW))
  return out
}

/**
 * The whole track as lines to draw: matched where Valhalla could, the cleaned
 * points where it could not. `onProgress` hears each line as it lands, so a
 * long day fills in stretch by stretch instead of all at once at the end.
 */
function stretchKey(s: Stretch): string {
  return `${s.costing}|${s.points[0].ts}|${s.points[s.points.length - 1].ts}|${s.points.length}`
}

/**
 * The lines to draw right now, without asking anything: matched where the
 * cache already has the stretch, the cleaned points elsewhere. What the map
 * shows the moment new points arrive, so a live day does not flash back to
 * straight lines while its last stretch is matched again.
 */
export function linesNow(points: TrackPoint[], cache?: Map<string, [number, number][]>, clean = true): MatchedLine[] {
  const parts = stretches(clean ? cleanTrack(points) : points)
  return parts.map(st => {
    const known = st.points.length > 1 ? cache?.get(stretchKey(st)) : undefined
    return {
      color: motionColor(st.motion), motion: st.motion, matched: !!known,
      positions: known ?? st.points.map(p => [p.lat, p.lng] as [number, number]),
    }
  })
}

export async function matchTrack(points: TrackPoint[], opts: {
  signal?: AbortSignal
  onProgress?: (lines: MatchedLine[]) => void
  /** Matched lines already known, by stretch: a live day only re-asks for the stretch that grew. */
  cache?: Map<string, [number, number][]>
} = {}): Promise<MatchedLine[]> {
  const parts = stretches(cleanTrack(points))
  const lines = linesNow(points, opts.cache)
  let requests = 0
  for (let i = 0; i < parts.length; i++) {
    if (opts.signal?.aborted) break
    const s = parts[i]
    if (s.points.length < 2) continue
    if (lines[i].matched) continue
    const key = stretchKey(s)
    const pieces: [number, number][] = []
    let ok = true
    for (const w of windows(s.points)) {
      if (requests >= MAX_REQUESTS) { ok = false; break }
      requests++
      const matched = await matchPoints(w, s.costing, opts.signal)
      if (!matched) { ok = false; break }
      pieces.push(...(pieces.length ? matched.slice(1) : matched))
    }
    if (ok && pieces.length > 1) {
      opts.cache?.set(key, pieces)
      if (opts.cache && opts.cache.size > 300) opts.cache.delete(opts.cache.keys().next().value as string)
      lines[i] = { ...lines[i], positions: pieces, matched: true }
      opts.onProgress?.(lines.slice())
    }
  }
  return lines
}


/** Matched stretches shared by every map in the tab, so going back to a day costs no request. */
export const matchCache = new Map<string, [number, number][]>()

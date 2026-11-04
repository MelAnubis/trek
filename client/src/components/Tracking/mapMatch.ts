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
import { isStopBetween, mainMotion, motionColor, type TrackPoint } from './trackingModel'

export type Costing = 'pedestrian' | 'bicycle' | 'auto'

export interface MatchedLine {
  color: string
  motion: string | null
  positions: [number, number][]
  /** False when the line is the cleaned GPS points because matching failed or was not asked. */
  matched: boolean
  /**
   * A stretch with no fixes at all (5.7.7): the phone stopped recording, so
   * the way between the last fix before and the first after is guessed —
   * routed along the network when the router can, a straight line otherwise.
   * Drawn apart (dashed, fainter) so a guess never passes for a recording.
   */
  inferred?: boolean
}

/** A hole in the recording between two stretches: where it stopped, where it started again. */
export interface TrackGap {
  from: TrackPoint
  to: TrackPoint
  distanceM: number
  durationMs: number
  /** How the way between is guessed, from the speed the hole implies and the stretches either side. */
  costing: Costing
}

/** A pause this long between two fixes starts a new stretch: the phone was off, in a tunnel, on a train. */
const GAP_MS = 10 * 60 * 1000
/** A jump this far between two fixes starts a new stretch too. */
const GAP_M = 3000
/** A hole shorter than this is no hole: the stretches just meet. */
const BRIDGE_MIN_M = 150
/** A hole longer than this (an overnight, a flight) is not bridged: the guess would be fiction. */
const BRIDGE_MAX_MS = 3 * 60 * 60 * 1000
const BRIDGE_MAX_M = 150_000
/** The most waypoints one routed request carries (the public instance refuses more than 10, 5.7.23). */
const VIA_MAX = 10
/** Waypoints closer than this add nothing to a routed line. */
const VIA_MIN_M = 120
/** The most points one matching request carries; a longer stretch goes in windows. */
const WINDOW = 100
/** The most requests one track may take; past that the rest is drawn unmatched. */
const MAX_REQUESTS = 120
/** The most matched stretches and windows kept in the tab. */
const CACHE_MAX = 1000
/** The most traces one window may take to get past the fixes the matcher breaks at. */
const MAX_PIECES = 10
/** Pieces of a trace further apart than this are joined along the network, not straight. */
const JOIN_M = 60
/** The share of a window's fixes the matcher must have placed for its trace to be taken. */
const MIN_PLACED = 0.5
/** The most fixes, in metres along them, a trace may leave out before it starts again. */
const SKIP_MAX_M = 5000
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

/** Motions that say nothing about the way travelled: a stop at a junction is not a change of vehicle. */
const NEUTRAL = new Set<string | null>([null, 'stationary', 'unknown'])
/** A run of another motion shorter than both of these is the phone guessing wrong, not a change of vehicle. */
const BLIP_M = 1500
const BLIP_MS = 5 * 60 * 1000
/** Faster than this on average, a "car" run in a day of riding is a car after all. */
const RIDE_KMH = 50
/** Slower than this between two fixes is standing, and left out of a run's speed. */
const MOVING_KMH = 3
/** Faster than these on average, "walking" and "running" are riding. */
const WALK_MAX_KMH = 12
const RUN_MAX_KMH = 18

const isRide = (m: string | null) => m === 'cycling'
const isCar = (m: string | null) => m === 'driving' || m === 'automotive'

/**
 * How each fix was travelled, as the track is drawn and matched (5.7.15).
 *
 * The phone's own activity guess flickers: a bike ride is "in a vehicle" on
 * every fast descent and "still" at every junction, and taken fix by fix that
 * cut one ride into dozens of stretches, the fast ones matched as a car (which
 * may use no track or path) and the request budget spent long before the end.
 * So: a fix with no motion (still, unknown) takes the motion around it; a run
 * of another motion too short to be a change of vehicle (under 1.5 km or 5
 * minutes both) takes its neighbours'; and a "car" run between two rides at riding
 * speed is ridden. The stored points keep what the phone said.
 */
export function effectiveMotions(points: TrackPoint[]): (string | null)[] {
  const raw = points.map(p => mainMotion(p.motion))
  const out = raw.map(m => (NEUTRAL.has(m) ? null : m))
  // Still and unknown take the motion before them, or after them at the start.
  let last: string | null = null
  for (let i = 0; i < out.length; i++) { if (out[i]) last = out[i]; else out[i] = last }
  let next: string | null = null
  for (let i = out.length - 1; i >= 0; i--) { if (raw[i] && !NEUTRAL.has(raw[i])) next = out[i]; if (!out[i]) out[i] = next }

  type Run = { m: string | null; from: number; to: number }
  const speedRuns = (): Run[] => {
    const runs: Run[] = []
    out.forEach((m, i) => { const r = runs[runs.length - 1]; if (r && r.m === m) r.to = i; else runs.push({ m, from: i, to: i }) })
    return runs
  }
  /** A run's length and its speed while moving: the stops (a café, a junction) are left out of the average. */
  const kmhOf = (r: Run) => {
    const end = Math.min(r.to + 1, points.length - 1)
    let d = 0, movingM = 0, movingMs = 0
    for (let i = r.from + 1; i <= end; i++) {
      const seg = distM(points[i - 1], points[i])
      const ms = Date.parse(points[i].ts) - Date.parse(points[i - 1].ts)
      d += seg
      if (ms > 0 && (seg / 1000) / (ms / 3_600_000) >= MOVING_KMH) { movingM += seg; movingMs += ms }
    }
    return { d, kmh: movingMs > 0 ? (movingM / 1000) / (movingMs / 3_600_000) : 0 }
  }
  // "On foot" at the speed of a bike is a bike: an iPhone called a whole ride a walk.
  for (const r of speedRuns()) {
    const { d, kmh } = kmhOf(r)
    if (d < 300) continue
    if ((r.m === 'walking' && kmh > WALK_MAX_KMH) || (r.m === 'running' && kmh > RUN_MAX_KMH)) for (let i = r.from; i <= r.to; i++) out[i] = 'cycling'
  }
  // A day ridden mostly by bike: a "car" run at riding speed is ridden too, at the start or the end as well as between rides.
  {
    const by = new Map<string, number>()
    for (const r of speedRuns()) if (r.m) by.set(r.m, (by.get(r.m) ?? 0) + kmhOf(r).d)
    const dominant = [...by].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
    if (isRide(dominant)) for (const r of speedRuns()) if (isCar(r.m) && kmhOf(r).kmh <= RIDE_KMH) for (let i = r.from; i <= r.to; i++) out[i] = 'cycling'
  }

  const runsOf = (): Run[] => {
    const runs: Run[] = []
    out.forEach((m, i) => { const r = runs[runs.length - 1]; if (r && r.m === m) r.to = i; else runs.push({ m, from: i, to: i }) })
    return runs
  }
  const length = (r: Run) => { let d = 0; for (let i = r.from + 1; i <= r.to + (r.to + 1 < points.length ? 1 : 0); i++) d += distM(points[i - 1], points[i]); return d }
  const lasting = (r: Run) => Date.parse(points[Math.min(r.to + 1, points.length - 1)].ts) - Date.parse(points[r.from].ts)
  for (let guard = 0; guard < 50; guard++) {
    const runs = runsOf()
    if (runs.length < 2) break
    // The shortest blip first, so two blips side by side settle on the ride around them.
    const blips = runs
      .map((r, k) => ({ r, k, d: length(r), t: lasting(r) }))
      .filter(({ r, k, d, t }) => {
        const before = runs[k - 1]?.m ?? null
        const after = runs[k + 1]?.m ?? null
        if (d < BLIP_M && t < BLIP_MS) return true
        // A "car" between two rides at the speed of a ride.
        const kmh = t > 0 ? (d / 1000) / (t / 3_600_000) : Infinity
        return isCar(r.m) && isRide(before) && isRide(after) && kmh <= RIDE_KMH
      })
      .sort((a, b) => a.d - b.d)
    const blip = blips[0]
    if (!blip) break
    const before = runs[blip.k - 1]
    const after = runs[blip.k + 1]
    // The neighbour that lasts longest takes it.
    const into = !before ? after : !after ? before : (length(before) >= length(after) ? before : after)
    for (let i = blip.r.from; i <= blip.r.to; i++) out[i] = into.m
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
  const motions = effectiveMotions(points)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const motion = motions[i]
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
  const motionOf = new Map(points.map((p, i) => [p, motions[i]]))
  for (const st of out) {
    const count = new Map<string, number>()
    for (const p of st.points) { const m = motionOf.get(p) ?? null; if (m && m !== 'stationary') count.set(m, (count.get(m) ?? 0) + 1) }
    st.motion = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (st.points.some(p => mainMotion(p.motion) === 'stationary') ? 'stationary' : null)
  }
  return out
}

const COSTING_OPTIONS: Record<Costing, Record<string, unknown>> = {
  pedestrian: { pedestrian: { max_hiking_difficulty: 6 } },
  // Gravel and dirt tracks are where most rides in the country go: no penalty for them when matching.
  bicycle: { bicycle: { bicycle_type: 'Hybrid', avoid_bad_surfaces: 0 } },
  auto: {},
}

/**
 * How far from its fixes the matcher may look for the way, from how good the
 * fixes are (5.7.19): a phone in low power (an iPhone) logs every few hundred
 * metres and 50–100 m off, and a 60 m search found no road under it at all.
 */
export function traceOptions(points: TrackPoint[]) {
  const accs = points.map(acc).sort((x, y) => x - y)
  const median = accs[Math.floor(accs.length / 2)] ?? 15
  const worst = accs[Math.floor(accs.length * 0.9)] ?? median
  return {
    // The public instance refuses a search radius over 100 m (5.7.23: an iPhone's trace was refused outright).
    search_radius: Math.round(Math.min(100, Math.max(60, worst * 1.5))),
    gps_accuracy: Math.round(Math.min(80, Math.max(10, median))),
    breakage_distance: GAP_M,
    turn_penalty_factor: 200,
  }
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
        trace_options: traceOptions(points),
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

/**
 * One window traced to its end (5.7.23). Where the matcher cannot place a fix
 * (a dual carriageway, a fix off the road) it breaks the trace and the public
 * instance answers with the first piece only: a 9 km drive came back as 700 m.
 * So the trace goes on from the first fix past the piece, and the pieces are
 * joined; null when the first trace gets nothing.
 */
export async function traceThrough(points: TrackPoint[], costing: Costing, signal?: AbortSignal, budget = MAX_PIECES): Promise<{ line: [number, number][]; requests: number; placed: number } | null> {
  const raw = (ps: TrackPoint[]) => ps.map(p => [p.lat, p.lng] as [number, number])
  const out: [number, number][] = []
  let start = 0
  let requests = 0
  let placed = 0
  while (start < points.length - 1 && requests < budget && !signal?.aborted) {
    const rest = points.slice(start)
    requests++
    const line = await matchPoints(rest, costing, signal)
    const first = line ? firstIndex(line, rest) : 0
    const reached = line ? reachedIndex(line, rest, first) : -1
    // No piece, or one that gets no further than a fix: nothing more is matched from here.
    if (!line || reached <= first) break
    /*
     * The matcher starts a piece at the first fix it could place. The fixes it
     * left out are where no mapped way explains them (a road missing from the
     * map, fixes 100 m off it): they are drawn as recorded. With none left out
     * a jump between pieces is routed, or joined straight when the route is a
     * detour.
     */
    const from = out.length ? { lat: out[out.length - 1][0], lng: out[out.length - 1][1] } : rest[0]
    const to = { lat: line[0][0], lng: line[0][1] }
    if (first > 0) {
      out.push(...raw(rest.slice(0, first)))
    } else if (distM(from, to) > JOIN_M && requests < budget) {
      requests++
      const bridge = await routeVia([from, to], costing, signal)
      if (bridge && lineLengthM(bridge) <= Math.max(3 * distM(from, to), distM(from, to) + 1000)) out.push(...bridge)
      else if (!out.length) out.push([from.lat, from.lng])
    }
    out.push(...line)
    placed += reached - first + 1
    // On from the fix after the last one the piece reached.
    start += reached + 1
  }
  if (!placed) return null
  // The fixes after the last piece (a last fix off the road, where the car was parked) are drawn as recorded.
  const last = out[out.length - 1]
  if (start < points.length - 1 || (start === points.length - 1 && distM(points[start], { lat: last[0], lng: last[1] }) > JOIN_M)) {
    out.push(...raw(points.slice(start)))
  }
  return { line: out, requests, placed: placed / points.length }
}

/**
 * The first of `points` a traced piece starts at: the fix nearest where it
 * begins (of fixes as near, the first), within the first few kilometres of
 * fixes the matcher may have left out.
 */
function firstIndex(line: [number, number][], points: TrackPoint[]): number {
  const begin = { lat: line[0][0], lng: line[0][1] }
  let best = 0
  let bestD = Infinity
  let along = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) along += distM(points[i - 1], points[i])
    if (along > SKIP_MAX_M) break
    const d = distM(points[i], begin)
    if (d < bestD - 5) { best = i; bestD = d }
  }
  return best
}

/**
 * The last of `points` a traced piece got to, from the fix it starts at: the
 * fix nearest where it ends, no further along the fixes than the piece is long
 * (a loop comes back past its start: that is not where a piece of its first
 * kilometre ends). -1 when no fix is near its end.
 */
function reachedIndex(line: [number, number][], points: TrackPoint[], from: number): number {
  const end = { lat: line[line.length - 1][0], lng: line[line.length - 1][1] }
  const reach = lineLengthM(line) * 1.5 + 300
  let best = -1
  let bestD = Infinity
  let along = 0
  for (let i = from; i < points.length; i++) {
    if (i > from) along += distM(points[i - 1], points[i])
    if (along > reach) break
    const d = distM(points[i], end)
    // The nearest fix to the end; of fixes as near (standing at the end), the last.
    if (d <= Math.max(150, 3 * acc(points[i])) && d <= bestD + 5) { best = i; bestD = Math.min(bestD, d) }
  }
  return best
}

/** The costing a hole is guessed with: the speed it implies, or the way the stretches either side were travelled. */
function bridgeCosting(distanceM: number, durationMs: number, before: Costing, after: Costing): Costing {
  const kmh = durationMs > 0 ? (distanceM / 1000) / (durationMs / 3_600_000) : Infinity
  if (before === 'auto' || after === 'auto' || kmh > 28) return 'auto'
  if (before === 'bicycle' || after === 'bicycle' || kmh > 9) return 'bicycle'
  return 'pedestrian'
}

/**
 * The holes in a recording: between two stretches cut by a long pause or a
 * jump, where the phone recorded nothing (Android stopping Overland with the
 * screen off is the usual cause). A hole that is too short to matter or too
 * long to guess (an overnight, a flight) is left out.
 */
export function trackGaps(parts: Stretch[]): TrackGap[] {
  const out: TrackGap[] = []
  for (let i = 1; i < parts.length; i++) {
    const a = parts[i - 1].points[parts[i - 1].points.length - 1]
    const b = parts[i].points[0]
    if (!a || !b || a === b) continue
    const distanceM = distM(a, b)
    const durationMs = Date.parse(b.ts) - Date.parse(a.ts)
    if (distanceM < BRIDGE_MIN_M || distanceM > BRIDGE_MAX_M || durationMs > BRIDGE_MAX_MS) continue
    // A stop between two trips of the day (5.7.21) is no hole: nothing is guessed across it.
    if (isStopBetween(a, b)) continue
    out.push({ from: a, to: b, distanceM, durationMs, costing: bridgeCosting(distanceM, durationMs, parts[i - 1].costing, parts[i].costing) })
  }
  return out
}

/** The holes of a day's points, as the map draws and lists them. */
export function gapsOf(points: TrackPoint[]): TrackGap[] {
  return trackGaps(stretches(cleanTrack(points)))
}

/**
 * A line along the network through `points` (as waypoints, in order), for a
 * hole between two fixes and for a stretch too sparse to be matched: a few
 * fixes kilometres apart are a route, not a trace. Null when it cannot be had.
 */
export async function routeVia(points: { lat: number; lng: number }[], costing: Costing, signal?: AbortSignal): Promise<[number, number][] | null> {
  const base = valhallaBase()
  if (!base || points.length < 2) return null
  // Thinned to waypoints that mean something, ends kept, then sent in request-sized windows.
  const via = points.filter((p, i) => i === 0 || i === points.length - 1 || distM(p, points[i - 1]) >= VIA_MIN_M)
  const out: [number, number][] = []
  for (let i = 0; i < via.length - 1; i += VIA_MAX - 1) {
    const win = via.slice(i, i + VIA_MAX)
    if (win.length < 2) break
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
    try {
      await valhallaTurn(base, signal)
      if (signal?.aborted) return null
      const response = await fetch(`${base}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'trek' },
        body: JSON.stringify({
          locations: win.map((p, k) => {
            const loc: Record<string, unknown> = { lat: p.lat, lon: p.lng, type: k === 0 || k === win.length - 1 ? 'break' : 'through', radius: Math.round(Math.min(150, Math.max(50, 1.5 * acc(p as TrackPoint)))) }
            /*
             * The way it was going (5.7.23): without it a waypoint on a dual
             * carriageway lands on the other side, and the route turns round at
             * every one of them (a 9 km drive came back as 27 km).
             */
            const heading = headingAt(win, k)
            if (heading != null) { loc.heading = heading; loc.heading_tolerance = 60 }
            return loc
          }),
          costing,
          costing_options: COSTING_OPTIONS[costing],
          directions_options: { units: 'kilometers', directions_type: 'none' },
        }),
        signal: bounded,
      })
      if (!response.ok) return null
      const data = await response.json() as { trip?: { legs?: { shape?: string }[] } }
      const line = (data.trip?.legs ?? []).flatMap(l => (l.shape ? decodePolyline(l.shape, 6) : []))
      if (line.length < 2) return null
      out.push(...(out.length ? line.slice(1) : line))
    } catch {
      return null
    }
  }
  return out.length > 1 ? out : null
}

/** The bearing of travel at `points[k]` (degrees from north), from its neighbours; null when they are too close to tell. */
function headingAt(points: { lat: number; lng: number }[], k: number): number | null {
  const a = points[Math.max(0, k - 1)]
  const b = points[Math.min(points.length - 1, k + 1)]
  if (a === b || distM(a, b) < 80) return null
  const f1 = a.lat * Math.PI / 180, f2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180
  const y = Math.sin(dl) * Math.cos(f2)
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360)
}

/** Whether a routed guess is believable for the time the hole lasted: no faster than a motorway allows. */
function plausible(line: [number, number][], gap: TrackGap): boolean {
  let m = 0
  for (let i = 1; i < line.length; i++) m += distM({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] })
  // A detour more than three times the straight distance is a router that found another way round.
  if (m > Math.max(gap.distanceM * 3, gap.distanceM + 2000)) return false
  return gap.durationMs <= 0 || (m / 1000) / (gap.durationMs / 3_600_000) < 150
}

/** Metres from a point to the segment a–b, on a local flat projection (fine at these distances). */
function toSegmentM(p: { lat: number; lng: number }, a: [number, number], b: [number, number]): number {
  const k = Math.cos(p.lat * Math.PI / 180) * 111_320
  const ax = (a[1] - p.lng) * k, ay = (a[0] - p.lat) * 110_540
  const bx = (b[1] - p.lng) * k, by = (b[0] - p.lat) * 110_540
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}

function lineLengthM(line: [number, number][]): number {
  let m = 0
  for (let i = 1; i < line.length; i++) m += distM({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] })
  return m
}

/**
 * Whether a matched (or routed) line really is these points along the ways
 * (5.7.17). The public matcher answers "ok" with only the part it could
 * match when part of a trace is off its map, and taken at its word that drew
 * a ride as a few hundred metres. So the line must pass near nearly every
 * fix (within their spread, 50 m at least), and be neither much shorter nor
 * much longer than the fixes joined.
 */
export function covers(line: [number, number][], points: TrackPoint[]): boolean {
  if (line.length < 2 || points.length < 2) return false
  let near = 0
  for (const p of points) {
    const tol = Math.min(120, Math.max(60, 2.5 * acc(p)))
    let best = Infinity
    for (let i = 1; i < line.length && best > tol; i++) best = Math.min(best, toSegmentM(p, line[i - 1], line[i]))
    if (best <= tol) near++
  }
  const raw = lineLengthM(points.map(p => [p.lat, p.lng] as [number, number]))
  const got = lineLengthM(line)
  const ends = distM(points[0], { lat: line[0][0], lng: line[0][1] }) <= 150
    && distM(points[points.length - 1], { lat: line[line.length - 1][0], lng: line[line.length - 1][1] }) <= 150
  return ends && near / points.length >= 0.85 && (raw < 50 || (got >= raw * 0.6 && got <= raw * 2 + 300))
}

/** Stretches split into request-sized windows that overlap by one point. */
export function windows(points: TrackPoint[]): TrackPoint[][] {
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
  return plan(points, clean).map(item => item.line(cache))
}

type Planned = { key: string; matchable: boolean; line: (cache?: Map<string, [number, number][]>) => MatchedLine } & (
  | { kind: 'stretch'; stretch: Stretch }
  | { kind: 'gap'; gap: TrackGap }
)

/** The track as what is drawn, in order: each stretch, and after it the hole to the next one when there is one. */
function plan(points: TrackPoint[], clean = true): Planned[] {
  const parts = stretches(clean ? cleanTrack(points) : points)
  const gaps = clean ? trackGaps(parts) : []
  const out: Planned[] = []
  parts.forEach((st, i) => {
    const key = stretchKey(st)
    out.push({
      kind: 'stretch', stretch: st, key, matchable: st.points.length > 1,
      line: cache => {
        const known = st.points.length > 1 ? cache?.get(key) : undefined
        return { color: motionColor(st.motion), motion: st.motion, matched: !!known, positions: known ?? st.points.map(p => [p.lat, p.lng] as [number, number]) }
      },
    })
    const next = parts[i + 1]
    const gap = next && gaps.find(g => g.from === st.points[st.points.length - 1] && g.to === next.points[0])
    if (gap) {
      const gkey = `gap|${gap.costing}|${gap.from.ts}|${gap.to.ts}`
      out.push({
        kind: 'gap', gap, key: gkey, matchable: false,
        line: cache => {
          const known = cache?.get(gkey)
          return {
            color: motionColor(st.motion ?? next.motion), motion: null, matched: !!known, inferred: true,
            positions: known ?? [[gap.from.lat, gap.from.lng], [gap.to.lat, gap.to.lng]],
          }
        },
      })
    }
  })
  return out
}

export async function matchTrack(points: TrackPoint[], opts: {
  signal?: AbortSignal
  onProgress?: (lines: MatchedLine[]) => void
  /** Matched lines already known, by stretch: a live day only re-asks for the stretch that grew. */
  cache?: Map<string, [number, number][]>
} = {}): Promise<MatchedLine[]> {
  const items = plan(points)
  const lines = items.map(item => item.line(opts.cache))
  let requests = 0
  const remember = (key: string, positions: [number, number][]) => {
    if (!opts.cache) return
    opts.cache.set(key, positions)
    if (opts.cache.size > CACHE_MAX) opts.cache.delete(opts.cache.keys().next().value as string)
  }
  const keep = (i: number, key: string, positions: [number, number][]) => {
    remember(key, positions)
    lines[i] = { ...lines[i], positions, matched: true }
    opts.onProgress?.(lines.slice())
  }
  for (let i = 0; i < items.length; i++) {
    if (opts.signal?.aborted) break
    const item = items[i]
    if (lines[i].matched || requests >= MAX_REQUESTS) continue
    if (item.kind === 'gap') {
      // The hole, guessed along the network; kept straight when the guess is not believable.
      requests++
      const routed = await routeVia([item.gap.from, item.gap.to], item.gap.costing, opts.signal)
      if (routed && plausible(routed, item.gap)) keep(i, item.key, routed)
      continue
    }
    const s = item.stretch
    if (s.points.length < 2) continue
    /*
     * In windows of about a hundred fixes, each matched on its own (5.7.17):
     * with the costing of how it was travelled, then on foot, the costing
     * that refuses the fewest ways; a window too sparse to trace is routed
     * through its fixes instead. A line is only taken when it covers the
     * window's fixes (`covers`); a window nothing covers is drawn from its
     * fixes, so a ride is never cut short by the part the matcher missed.
     */
    const tries: [Costing, 'trace' | 'route'][] = s.costing === 'auto'
      ? [['auto', 'trace'], ['auto', 'route']]
      : s.costing === 'bicycle'
        ? [['bicycle', 'trace'], ['pedestrian', 'trace'], ['bicycle', 'route']]
        : [['pedestrian', 'trace'], ['pedestrian', 'route']]
    const pieces: [number, number][] = []
    let good = 0
    const parts = windows(s.points)
    for (const w of parts) {
      /*
       * Each window is kept on its own too (5.7.27): a live ride is one
       * stretch that grows with every batch, and only its last window has new
       * fixes; the ones before it come from the cache instead of being asked
       * again every minute.
       */
      const wkey = `w|${s.costing}|${w[0].ts}|${w[w.length - 1].ts}|${w.length}`
      let line: [number, number][] | null = opts.cache?.get(wkey) ?? null
      /*
       * Traced to its end first; a window no trace covers is routed through
       * its fixes (5.7.23: before, only a sparse one was, and the routed
       * requests carried more waypoints than the public instance takes).
       */
      for (const [costing, way] of tries) {
        if (line || requests >= MAX_REQUESTS || opts.signal?.aborted) break
        let got: [number, number][] | null
        if (way === 'trace') {
          const traced = await traceThrough(w, costing, opts.signal, Math.min(MAX_PIECES, MAX_REQUESTS - requests))
          requests += traced?.requests ?? 1
          // Taken when the matcher placed most of the window itself, not just a few of its fixes.
          got = traced && traced.placed >= MIN_PLACED ? traced.line : null
        } else {
          requests += Math.ceil(w.length / (VIA_MAX - 1))
          got = await routeVia(w, costing, opts.signal)
        }
        if (got && covers(got, w)) line = got
      }
      if (line) { good++; remember(wkey, line) }
      const piece = line ?? w.map(p => [p.lat, p.lng] as [number, number])
      pieces.push(...(pieces.length ? piece.slice(1) : piece))
    }
    // Drawn as matched when most of it is; the windows left as fixes are still where they were recorded.
    if (good > 0 && good * 2 >= parts.length && pieces.length > 1) keep(i, item.key, pieces)
  }
  return lines
}


/** Matched stretches shared by every map in the tab, so going back to a day costs no request. */
export const matchCache = new Map<string, [number, number][]>()

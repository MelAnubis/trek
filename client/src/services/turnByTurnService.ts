const OSRM_BASE = 'https://router.project-osrm.org/route/v1'

export interface TurnInstruction {
  index: number
  type: string
  modifier?: string
  name: string
  distanceM: number
  location: [number, number]  // [lat, lng]
  bearingAfter: number
}

export async function fetchTurnByTurn(
  waypoints: Array<{ lat: number; lng: number }>,
  profile: 'driving' | 'cycling' | 'walking' = 'cycling',
  signal?: AbortSignal
): Promise<TurnInstruction[]> {
  if (waypoints.length < 2) return []
  const coords = waypoints.map(p => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&geometries=geojson&steps=true`
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error('OSRM unavailable')
  const data = await r.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found')

  const instructions: TurnInstruction[] = []
  let idx = 0
  for (const leg of data.routes[0].legs) {
    for (const step of leg.steps) {
      const m = step.maneuver
      instructions.push({
        index: idx++,
        type: m.type ?? 'continue',
        modifier: m.modifier,
        name: step.name ?? '',
        distanceM: step.distance ?? 0,
        location: [m.location[1], m.location[0]],
        bearingAfter: m.bearing_after ?? 0,
      })
    }
  }
  return instructions
}

// ── Fetch approach route coordinates from OSRM ───────────────────────────────
export async function fetchApproachRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: 'cycling' | 'walking' | 'driving' = 'cycling'
): Promise<{ coords: [number, number][]; instructions: TurnInstruction[] }> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&geometries=geojson&steps=true`
  const r = await fetch(url)
  if (!r.ok) throw new Error('OSRM unavailable')
  const data = await r.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found')

  const route = data.routes[0]
  const routeCoords: [number, number][] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng]
  )

  const instructions: TurnInstruction[] = []
  let idx = 0
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      const m = step.maneuver
      instructions.push({
        index: idx++,
        type: m.type ?? 'continue',
        modifier: m.modifier,
        name: step.name ?? '',
        distanceM: step.distance ?? 0,
        location: [m.location[1], m.location[0]],
        bearingAfter: m.bearing_after ?? 0,
      })
    }
  }
  return { coords: routeCoords, instructions }
}

// ── Generate turn instructions from GPX geometry (no OSRM needed) ────────────
export interface TrackPoint {
  lat: number
  lng: number
  ele?: number | null
}

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearing(la1: number, lo1: number, la2: number, lo2: number): number {
  const dLo = (lo2 - lo1) * Math.PI / 180
  const la1r = la1 * Math.PI / 180
  const la2r = la2 * Math.PI / 180
  const y = Math.sin(dLo) * Math.cos(la2r)
  const x = Math.cos(la1r) * Math.sin(la2r) - Math.sin(la1r) * Math.cos(la2r) * Math.cos(dLo)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function angleDiff(a: number, b: number): number {
  let d = b - a
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/**
 * Analyzes a GPX track's geometry and emits turn instructions wherever the
 * heading changes significantly. Works without OSRM — purely geometric.
 * Uses a 40m lookahead window to smooth micro-zigzags in GPS data.
 */
export function generateTrackInstructions(points: TrackPoint[]): TurnInstruction[] {
  if (points.length < 3) return []

  const WINDOW_M = 40      // metres per heading segment
  const TURN_DEG = 22      // min angle change to qualify as a turn
  const MIN_GAP_M = 30     // min distance between consecutive instructions

  // Build segment headings: advance by WINDOW_M chunks
  interface Segment { idx: number; hdg: number; distFromStart: number }
  const segments: Segment[] = []
  let dist = 0
  let segStart = 0
  let segDist = 0

  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    dist += d
    segDist += d
    if (segDist >= WINDOW_M || i === points.length - 1) {
      const hdg = bearing(points[segStart].lat, points[segStart].lng, points[i].lat, points[i].lng)
      segments.push({ idx: i, hdg, distFromStart: dist })
      segStart = i
      segDist = 0
    }
  }

  const instructions: TurnInstruction[] = []
  let lastInstrDist = 0
  let prevHdg = segments[0]?.hdg ?? 0

  // Depart instruction
  instructions.push({
    index: 0,
    type: 'depart',
    name: 'Inicio de ruta',
    distanceM: 0,
    location: [points[0].lat, points[0].lng],
    bearingAfter: prevHdg,
  })

  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s]
    const delta = angleDiff(prevHdg, seg.hdg)
    const distSinceLast = seg.distFromStart - lastInstrDist

    if (Math.abs(delta) >= TURN_DEG && distSinceLast >= MIN_GAP_M) {
      const pt = points[seg.idx]
      const mod = delta > 45 ? 'right' : delta < -45 ? 'left' : delta > 0 ? 'slight right' : 'slight left'
      instructions.push({
        index: instructions.length,
        type: 'turn',
        modifier: mod,
        name: '',
        distanceM: distSinceLast,
        location: [pt.lat, pt.lng],
        bearingAfter: seg.hdg,
      })
      lastInstrDist = seg.distFromStart
    }
    prevHdg = seg.hdg
  }

  // Arrive instruction
  const last = points[points.length - 1]
  instructions.push({
    index: instructions.length,
    type: 'arrive',
    name: 'Fin de ruta',
    distanceM: segments.length > 0 ? segments[segments.length - 1].distFromStart - lastInstrDist : 0,
    location: [last.lat, last.lng],
    bearingAfter: 0,
  })

  // Re-index
  instructions.forEach((ins, i) => { ins.index = i })
  return instructions
}

// ── Instruction helpers ──────────────────────────────────────────────────────

export function advanceInstructions(
  instructions: TurnInstruction[],
  currentIdx: number,
  userLat: number,
  userLng: number
): number {
  let idx = currentIdx
  while (idx < instructions.length - 1) {
    const instr = instructions[idx]
    if (instr.type === 'arrive') break
    const d = haversineM(userLat, userLng, instr.location[0], instr.location[1])
    if (d < 25) idx++
    else break
  }
  return idx
}

export function distanceToInstruction(instr: TurnInstruction, lat: number, lng: number): number {
  return haversineM(lat, lng, instr.location[0], instr.location[1])
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function maneuverDirection(type: string, modifier?: string): string {
  if (type === 'arrive') return 'arrive'
  if (type === 'depart') return 'straight'
  if (type === 'roundabout' || type === 'rotary') return 'roundabout'
  if (!modifier) return 'straight'
  if (modifier === 'left' || modifier === 'sharp left') return 'left'
  if (modifier === 'right' || modifier === 'sharp right') return 'right'
  if (modifier === 'slight left') return 'slight-left'
  if (modifier === 'slight right') return 'slight-right'
  if (modifier === 'uturn') return 'uturn'
  return 'straight'
}

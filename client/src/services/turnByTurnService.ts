const OSRM_BASE = 'https://router.project-osrm.org/route/v1'

export interface TurnInstruction {
  index: number
  type: string        // 'depart' | 'turn' | 'continue' | 'roundabout' | 'arrive' | ...
  modifier?: string   // 'left' | 'right' | 'slight left' | 'straight' | ...
  name: string
  distanceM: number   // distance of this step
  location: [number, number]  // [lat, lng] where this maneuver happens
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

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Returns the index of the next instruction we're heading towards (skipping already-passed ones). */
export function advanceInstructions(
  instructions: TurnInstruction[],
  currentIdx: number,
  userLat: number,
  userLng: number
): number {
  let idx = currentIdx
  // Advance past instructions we've already passed (within 25m of the maneuver point)
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

/** Icon name for a given maneuver type + modifier. Returns a direction string used by TurnInstruction component. */
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

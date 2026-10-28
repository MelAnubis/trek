import type { RouteResult, RouteSegment, Waypoint } from '../../types'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1'

/** Fetches a full route via OSRM and returns coordinates, distance, and duration estimates for driving/walking. */
export async function calculateRoute(
  waypoints: Waypoint[],
  profile: 'driving' | 'walking' | 'cycling' = 'driving',
  { signal }: { signal?: AbortSignal } = {}
): Promise<RouteResult> {
  if (!waypoints || waypoints.length < 2) {
    throw new Error('At least 2 waypoints required')
  }

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&geometries=geojson&steps=false`

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error('Route could not be calculated')
  }

  const data = await response.json()

  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('No route found')
  }

  const route = data.routes[0]
  const coordinates: [number, number][] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng])

  const distance: number = route.distance
  let duration: number
  if (profile === 'walking') {
    duration = distance / (5000 / 3600)
  } else if (profile === 'cycling') {
    duration = distance / (15000 / 3600)
  } else {
    duration = route.duration
  }

  const walkingDuration = distance / (5000 / 3600)
  const drivingDuration: number = route.duration

  return {
    coordinates,
    distance,
    duration,
    distanceText: formatDistance(distance),
    durationText: formatDuration(duration),
    walkingText: formatDuration(walkingDuration),
    drivingText: formatDuration(drivingDuration),
  }
}

export function generateGoogleMapsUrl(places: Waypoint[]): string | null {
  const valid = places.filter((p) => p.lat && p.lng)
  if (valid.length === 0) return null
  if (valid.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${valid[0].lat},${valid[0].lng}`
  }
  const stops = valid.map((p) => `${p.lat},${p.lng}`).join('/')
  return `https://www.google.com/maps/dir/${stops}`
}

/** Reorders waypoints using a nearest-neighbor heuristic to minimize total Euclidean distance. */
export function optimizeRoute(places: Waypoint[]): Waypoint[] {
  const valid = places.filter((p) => p.lat && p.lng)
  if (valid.length <= 2) return places

  const visited = new Set<number>()
  const result: Waypoint[] = []
  let current = valid[0]
  visited.add(0)
  result.push(current)

  while (result.length < valid.length) {
    let nearestIdx = -1
    let minDist = Infinity
    for (let i = 0; i < valid.length; i++) {
      if (visited.has(i)) continue
      const d = Math.sqrt(
        Math.pow(valid[i].lat - current.lat, 2) + Math.pow(valid[i].lng - current.lng, 2)
      )
      if (d < minDist) { minDist = d; nearestIdx = i }
    }
    if (nearestIdx === -1) break
    visited.add(nearestIdx)
    current = valid[nearestIdx]
    result.push(current)
  }
  return result
}

/** FOSSGIS runs OSRM with real foot and bike profiles; the demo server only knows the car. */
const FOSSGIS_OSRM = 'https://routing.openstreetmap.de'

/**
 * The line a day's stops are joined by, along paths and roads rather than straight: on foot,
 * or by bike when the day is planned cycling. Falls back to the car router, and to null
 * (the caller keeps the straight line) when nobody can route it.
 */
// Routed legs are kept on the device, so a day opens with its roads at once and only new or
// changed legs go to the router again (the public servers ask for fair use).
const ROUTE_CACHE_KEY = 'trek-route-cache-v1'
const ROUTE_CACHE_MAX = 300
let routeCache: Map<string, [number, number][]> | null = null

function loadRouteCache(): Map<string, [number, number][]> {
  if (routeCache) return routeCache
  routeCache = new Map()
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY)
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, [number, number][]][]) routeCache.set(k, v)
  } catch { /* no storage: memory only */ }
  return routeCache
}

function saveRouteCache(): void {
  const cache = loadRouteCache()
  while (cache.size > ROUTE_CACHE_MAX) cache.delete(cache.keys().next().value as string)
  try { localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify([...cache])) } catch {
    // full: keep the newer half
    const keep = [...cache].slice(Math.floor(cache.size / 2))
    cache.clear(); keep.forEach(([k, v]) => cache.set(k, v))
    try { localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(keep)) } catch { /* memory only */ }
  }
}

/** Fewer points to keep: ~5 m precision is plenty for drawing a day on a map. */
function compactLine(line: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [lat, lng] of line) {
    const p: [number, number] = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

/** Clears the routed legs kept on this device (tests, or a user asking to refresh). */
export function clearRouteCache(): void {
  routeCache = new Map()
  try { localStorage.removeItem(ROUTE_CACHE_KEY) } catch { /* ignore */ }
}

/**
 * The day's stops joined leg by leg along paths and roads, each leg from the device cache when
 * it was routed before. A leg nobody can route stays straight. Null when no leg could be routed.
 */
export async function routeDayLine(
  waypoints: Waypoint[],
  profile: 'foot' | 'bike',
  { signal }: { signal?: AbortSignal } = {},
): Promise<[number, number][] | null> {
  if (!waypoints || waypoints.length < 2) return null
  const cache = loadRouteCache()
  const out: [number, number][] = []
  let routedAny = false
  let changed = false
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1]
    const key = `${profile}:${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
    let leg = cache.get(key) ?? null
    if (leg) {
      cache.delete(key); cache.set(key, leg) // most recently used last
    } else {
      leg = await routeLine([a, b], profile, { signal })
      if (leg) { leg = compactLine(leg); cache.set(key, leg); changed = true }
    }
    if (leg && leg.length > 1) routedAny = true
    const piece = leg && leg.length > 1 ? leg : [[a.lat, a.lng], [b.lat, b.lng]] as [number, number][]
    out.push(...(out.length ? piece.slice(1) : piece))
  }
  if (changed) saveRouteCache()
  return routedAny ? out : null
}

export async function routeLine(
  waypoints: Waypoint[],
  profile: 'foot' | 'bike',
  { signal }: { signal?: AbortSignal } = {},
): Promise<[number, number][] | null> {
  if (!waypoints || waypoints.length < 2) return null
  const coords = waypoints.map(p => `${p.lng},${p.lat}`).join(';')
  const urls = [
    `${FOSSGIS_OSRM}/routed-${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`,
    `${OSRM_BASE}/driving/${coords}?overview=full&geometries=geojson&steps=false`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal })
      if (!res.ok) continue
      const data = await res.json()
      const line = data?.code === 'Ok' ? data.routes?.[0]?.geometry?.coordinates : null
      if (Array.isArray(line) && line.length > 1) return line.map(([lng, lat]: [number, number]) => [lat, lng])
    } catch (err) {
      if (signal?.aborted) throw err
    }
  }
  return null
}

/** Fetches per-leg distance/duration from OSRM and returns segment metadata (midpoints, walking/driving times). */
export async function calculateSegments(
  waypoints: Waypoint[],
  { signal }: { signal?: AbortSignal } = {}
): Promise<RouteSegment[]> {
  if (!waypoints || waypoints.length < 2) return []

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/driving/${coords}?overview=false&geometries=geojson&steps=false&annotations=distance,duration`

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Route could not be calculated')

  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found')

  const legs = data.routes[0].legs
  return legs.map((leg: { distance: number; duration: number }, i: number): RouteSegment => {
    const from: [number, number] = [waypoints[i].lat, waypoints[i].lng]
    const to: [number, number] = [waypoints[i + 1].lat, waypoints[i + 1].lng]
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    const walkingDuration = leg.distance / (5000 / 3600)
    const cyclingDuration = leg.distance / (15000 / 3600)
    return {
      mid, from, to,
      walkingText: formatDuration(walkingDuration),
      drivingText: formatDuration(leg.duration),
      cyclingText: formatDuration(cyclingDuration),
    }
  })
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) {
    return `${h} h ${m} min`
  }
  return `${m} min`
}

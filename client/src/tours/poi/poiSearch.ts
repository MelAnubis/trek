// A lo largo de la excursión (PLN-02 de liketrek/TREK v5): lugares cerca de la línea, buscados solo cuando se pide.
// La v5 lo pregunta a su servidor; aquí se pregunta a Overpass (OpenStreetMap) con un `around` sobre la propia línea.
import type { TourType } from '../toursApi'

export type PoiCategory =
  | 'viewpoint' | 'shelter' | 'drinking_water' | 'food' | 'peak' | 'toilets' | 'picnic' | 'campsite' | 'sights'
  | 'bike_repair' | 'ebike_charging' | 'park' | 'cafe'

/** The categories each tour type offers, the most asked first (TOUR_POI_CATEGORIES_BY_TYPE of the v5). */
export const POI_CATEGORIES_BY_TYPE: Record<TourType, readonly PoiCategory[]> = {
  hike: ['viewpoint', 'shelter', 'drinking_water', 'food', 'peak', 'toilets', 'picnic', 'campsite', 'sights'],
  bike: ['drinking_water', 'bike_repair', 'food', 'ebike_charging', 'viewpoint', 'toilets', 'shelter', 'picnic', 'campsite', 'sights'],
  run: ['drinking_water', 'toilets', 'park', 'viewpoint', 'cafe', 'food', 'shelter', 'sights'],
}
export const POI_CORRIDORS_M = [250, 500, 1000, 2000] as const
export const POI_MAX_CATEGORIES = 6
export const POI_LIMIT = 60
const MAX_LINE_POINTS = 200

/** OpenStreetMap tags of each category, as Overpass filters. */
const FILTERS: Record<PoiCategory, string[]> = {
  viewpoint: ['["tourism"="viewpoint"]'],
  shelter: ['["amenity"="shelter"]', '["tourism"~"^(alpine_hut|wilderness_hut)$"]'],
  drinking_water: ['["amenity"="drinking_water"]', '["amenity"="water_point"]'],
  food: ['["amenity"~"^(restaurant|fast_food|pub|biergarten|cafe)$"]'],
  peak: ['["natural"="peak"]["name"]'],
  toilets: ['["amenity"="toilets"]'],
  picnic: ['["tourism"="picnic_site"]', '["leisure"="picnic_table"]["name"]'],
  campsite: ['["tourism"="camp_site"]'],
  sights: ['["tourism"~"^(attraction|artwork)$"]["name"]', '["historic"~"^(castle|monument|ruins|memorial|archaeological_site)$"]["name"]'],
  bike_repair: ['["amenity"="bicycle_repair_station"]', '["shop"="bicycle"]'],
  ebike_charging: ['["amenity"="charging_station"]["bicycle"~"^(yes|designated)$"]'],
  park: ['["leisure"="park"]["name"]'],
  cafe: ['["amenity"="cafe"]'],
}

export interface TourPoi {
  id: string
  name: string
  lat: number
  lng: number
  category: PoiCategory
  kind: string
  opening_hours: string | null
  website: string | null
  /** Metres from the line, straight across. */
  distance_m: number
  /** Metres along the line from its start to the point nearest the place. */
  along_m: number
}

/** At most `most` points of a line, its ends kept. */
export function thinned(line: ReadonlyArray<[number, number]>, most: number): Array<[number, number]> {
  if (line.length <= most) return [...line]
  const step = (line.length - 1) / (most - 1)
  return Array.from({ length: most }, (_, i) => line[Math.min(line.length - 1, Math.round(i * step))])
}

export function overpassQuery(line: ReadonlyArray<[number, number]>, categories: readonly PoiCategory[], corridorM: number): string {
  const coords = thinned(line, MAX_LINE_POINTS).map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(',')
  const parts = categories.flatMap(c => FILTERS[c].flatMap(f => [`node${f}(around:${corridorM},${coords});`, `way${f}(around:${corridorM},${coords});`]))
  return `[out:json][timeout:25];(${parts.join('')});out center tags 400;`
}

function categoryOf(tags: Record<string, string>, asked: readonly PoiCategory[]): PoiCategory | null {
  for (const c of asked) {
    const match = FILTERS[c].some(f => [...f.matchAll(/\["([^"]+)"(=|~)"([^"]+)"\]/g)].every(([, k, op, v]) => {
      const tv = tags[k]
      if (tv === undefined) return false
      return op === '=' ? tv === v : new RegExp(v).test(tv)
    }))
    if (match) return c
  }
  return null
}

const RAD = Math.PI / 180
/** Metres from a point to the line, and how far along the line the nearest spot lies. */
export function placeAgainstLine(lat: number, lng: number, line: ReadonlyArray<[number, number]>): { distance: number; along: number } {
  const k = Math.cos(lat * RAD) * 111_320
  let best = Infinity, bestAlong = 0, travelled = 0
  for (let i = 0; i < line.length - 1; i++) {
    const [a1, b1] = line[i], [a2, b2] = line[i + 1]
    const ax = (b1 - lng) * k, ay = (a1 - lat) * 111_320
    const bx = (b2 - lng) * k, by = (a2 - lat) * 111_320
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const tt = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    const d = Math.hypot(ax + tt * dx, ay + tt * dy)
    const seg = Math.sqrt(len2)
    if (d < best) { best = d; bestAlong = travelled + tt * seg }
    travelled += seg
  }
  return { distance: best, along: bestAlong }
}

export interface PoiAnswer { pois: TourPoi[]; truncated: boolean }

/** The Overpass answer read into places along the line, the nearest to the line first, then listed from the start. */
export function poisFrom(data: unknown, line: ReadonlyArray<[number, number]>, asked: readonly PoiCategory[], corridorM: number, unnamed: (c: PoiCategory) => string): PoiAnswer {
  const elements = (data as { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> })?.elements ?? []
  const seen = new Set<string>()
  const rows: TourPoi[] = []
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon
    if (lat == null || lng == null) continue
    const tags = el.tags ?? {}
    const category = categoryOf(tags, asked)
    if (!category) continue
    const id = `${el.type}:${el.id}`
    if (seen.has(id)) continue
    seen.add(id)
    const { distance, along } = placeAgainstLine(lat, lng, line)
    if (distance > corridorM * 1.05) continue
    const kindKey = ['amenity', 'tourism', 'natural', 'historic', 'leisure', 'shop'].find(k => tags[k])
    rows.push({
      id, lat, lng, category,
      name: tags.name || unnamed(category),
      kind: kindKey ? `${kindKey}=${tags[kindKey]}` : '',
      opening_hours: tags.opening_hours ?? null,
      website: tags.website ?? tags['contact:website'] ?? null,
      distance_m: Math.round(distance),
      along_m: Math.round(along),
    })
  }
  const nearest = rows.sort((a, b) => a.distance_m - b.distance_m).slice(0, POI_LIMIT)
  return { pois: nearest.sort((a, b) => a.along_m - b.along_m), truncated: rows.length > POI_LIMIT }
}

export async function searchAlongTour(line: ReadonlyArray<[number, number]>, categories: readonly PoiCategory[], corridorM: number, unnamed: (c: PoiCategory) => string, signal?: AbortSignal): Promise<PoiAnswer> {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(line, categories, corridorM))}`,
    signal,
  })
  if (!response.ok) throw new Error(`overpass ${response.status}`)
  return poisFrom(await response.json(), line, categories, corridorM, unnamed)
}

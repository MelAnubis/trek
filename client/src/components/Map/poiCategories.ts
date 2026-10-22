import { Utensils, Coffee, Wine, BedDouble, Camera, Landmark, Trees, Ticket, Droplet, Tent, ShoppingCart, Wrench, type LucideIcon } from 'lucide-react'

// The POI categories shown in the map "explore" pill. The `key` is the contract
// with the server (CATEGORY_OSM_FILTERS in mapsService.ts) — the OSM tag mapping
// lives there; label/icon/colour live here. `color` doubles as the active-pill
// fill AND the marker colour, so the pill and the map agree visually.
export interface PoiCategory {
  key: string
  labelKey: string
  Icon: LucideIcon
  color: string
}

export const POI_CATEGORIES: PoiCategory[] = [
  { key: 'restaurant', labelKey: 'poi.cat.restaurants', Icon: Utensils, color: '#EF4444' },
  { key: 'cafe', labelKey: 'poi.cat.cafes', Icon: Coffee, color: '#B45309' },
  { key: 'bar', labelKey: 'poi.cat.bars', Icon: Wine, color: '#A855F7' },
  { key: 'hotel', labelKey: 'poi.cat.hotels', Icon: BedDouble, color: '#2563EB' },
  { key: 'sights', labelKey: 'poi.cat.sights', Icon: Camera, color: '#EC4899' },
  { key: 'museum', labelKey: 'poi.cat.museums', Icon: Landmark, color: '#6366F1' },
  { key: 'nature', labelKey: 'poi.cat.nature', Icon: Trees, color: '#16A34A' },
  { key: 'activity', labelKey: 'poi.cat.activities', Icon: Ticket, color: '#F59E0B' },
  // For bikepacking and hiking — the server already searches these for the
  // route planner (CATEGORY_OSM_FILTERS); colours match plannerRoute.ts.
  { key: 'water', labelKey: 'poi.cat.water', Icon: Droplet, color: '#0EA5E9' },
  { key: 'camping', labelKey: 'poi.cat.camping', Icon: Tent, color: '#16A34A' },
  { key: 'supermarket', labelKey: 'poi.cat.supermarket', Icon: ShoppingCart, color: '#D97706' },
  { key: 'bike_shop', labelKey: 'poi.cat.bikeShop', Icon: Wrench, color: '#7C3AED' },
]

/**
 * What to call a POI on the map. A drinking fountain or a spring usually has
 * no name in OpenStreetMap, and the server keeps those with an empty one —
 * the category's own label stands in rather than a blank tooltip.
 */
export function poiDisplayName(poi: Pick<Poi, 'name' | 'category'>, t: (key: string) => string): string {
  const name = (poi.name || '').trim()
  if (name) return name
  const cat = POI_CATEGORIES.find(c => c.key === poi.category)
  return cat ? t(cat.labelKey) : ''
}

export const POI_CATEGORY_BY_KEY: Record<string, PoiCategory> = Object.fromEntries(
  POI_CATEGORIES.map(c => [c.key, c]),
)

// One POI result from /api/maps/pois (mirror of the server's OverpassPoi).
export interface Poi {
  osm_id: string
  name: string
  lat: number
  lng: number
  category: string
  poi_type: string
  address: string | null
  website: string | null
  phone: string | null
  opening_hours: string | null
  cuisine: string | null
  source: 'openstreetmap'
}

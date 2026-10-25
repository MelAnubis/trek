// Preferred map app (TREK v5): which app the navigate buttons open. Empty asks every time.
export type NavAppId = 'google' | 'apple' | 'waze' | 'osm' | 'comaps'

export interface NavPlace { lat: number | null; lng: number | null; name?: string | null; google_place_id?: string | null }

export const NAV_APPS: { id: NavAppId; name: string }[] = [
  { id: 'google', name: 'Google Maps' },
  { id: 'apple', name: 'Apple Maps' },
  { id: 'waze', name: 'Waze' },
  { id: 'osm', name: 'OpenStreetMap' },
  { id: 'comaps', name: 'CoMaps' },
]

export function navAppName(id: string | null | undefined): string | null {
  return NAV_APPS.find(a => a.id === id)?.name ?? null
}

/** The link that opens a place in a map app, or null for a place without coordinates. */
export function navUrl(app: NavAppId, place: NavPlace): string | null {
  if (place.lat == null || place.lng == null) return null
  const { lat, lng } = place
  const name = encodeURIComponent(place.name ?? '')
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/search/?api=1&query=${place.google_place_id ? `${name}&query_place_id=${place.google_place_id}` : `${lat},${lng}`}`
    case 'apple':
      return `https://maps.apple.com/?ll=${lat},${lng}&q=${name || `${lat},${lng}`}`
    case 'waze':
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    case 'osm':
      return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
    case 'comaps':
      return `https://comaps.at/?ll=${lat},${lng}&n=${name}`
  }
}

export function isNavAppId(v: unknown): v is NavAppId {
  return typeof v === 'string' && NAV_APPS.some(a => a.id === v)
}

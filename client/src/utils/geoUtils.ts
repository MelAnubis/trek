import type { Day, AssignmentsMap } from '../types'

/**
 * Haversine formula — returns distance in km between two lat/lng points.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Returns the day ID whose assigned places are geographically closest to (lat, lng).
 *
 * Computes the centroid (average lat/lng) of each day's geo-tagged places and
 * returns the day with the smallest Haversine distance to the target point.
 *
 * Returns null when no day has any places with valid coordinates.
 */
export function findNearestDay(
  lat: number,
  lng: number,
  days: Day[],
  assignments: AssignmentsMap,
): number | null {
  let nearestDayId: number | null = null
  let minDistance = Infinity

  for (const day of days) {
    const geoPlaces = (assignments[String(day.id)] ?? [])
      .map((a) => a.place)
      .filter((p) => p?.lat != null && p?.lng != null)

    if (geoPlaces.length === 0) continue

    const centLat = geoPlaces.reduce((s, p) => s + p!.lat!, 0) / geoPlaces.length
    const centLng = geoPlaces.reduce((s, p) => s + p!.lng!, 0) / geoPlaces.length
    const dist = haversineDistance(lat, lng, centLat, centLng)

    if (dist < minDistance) {
      minDistance = dist
      nearestDayId = day.id
    }
  }

  return nearestDayId
}

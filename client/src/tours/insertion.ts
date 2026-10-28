// Dónde cabe una parada nueva: in the gap of the route where it adds the least detour, or at the
// end when it lies beyond the finish — not always at the end, which made a place picked from
// the trip land after the destination.
interface P { lat: number; lng: number }

function km(a: P, b: P): number {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

/**
 * Index the new point should take in `points` (0 … points.length). The start is kept as the
 * start: a point is only put first when there is nothing yet to keep.
 */
export function bestInsertIndex(points: P[], at: P): number {
  if (points.length < 2) return points.length
  let best = points.length
  let bestCost = km(points[points.length - 1], at) // after the finish
  for (let i = 0; i < points.length - 1; i++) {
    const cost = km(points[i], at) + km(at, points[i + 1]) - km(points[i], points[i + 1])
    if (cost < bestCost - 1e-9) { bestCost = cost; best = i + 1 }
  }
  return best
}

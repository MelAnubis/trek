// Copiado de liketrek/TREK v5.0.0 (client/src/components/Map/transitGeometry.ts), AGPL-3.0. Cambios: solo los imports.
/** Google polyline decoding with a configurable precision (MOTIS uses 6). */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = Math.pow(10, precision)
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0
      let shift = 0
      let byte = 0x20
      while (byte >= 0x20) {
        if (index >= encoded.length) return coords
        byte = encoded.codePointAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      }
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    coords.push([lat / factor, lng / factor])
  }
  return coords
}

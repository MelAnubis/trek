import { MapView } from './MapView'
import { MapViewGL } from './MapViewGL'
import { useGLEngine } from './useGLEngine'

// Auto-selects the map renderer based on user settings: the GL map for
// Mapbox (with a token) or MapLibre + OpenFreeMap (no key), Leaflet
// otherwise. Mapbox without a token falls back to Leaflet so the trip
// planner never shows an empty map. Atlas is not affected — it imports
// Leaflet directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MapViewAuto(props: any) {
  const gl = useGLEngine()
  if (gl) return <MapViewGL {...props} />
  return <MapView {...props} />
}

import mapboxgl from 'mapbox-gl'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * One GL map engine for the whole app: Mapbox GL (needs the user's token)
 * or MapLibre GL with OpenFreeMap's styles (free, no key, no account — the
 * default upstream liketrek/TREK moved to).
 *
 * MapLibre is a fork of Mapbox GL v1 and keeps its API for everything this
 * app uses — Map, Marker, Popup, LngLatBounds, GeoJSON sources, line and
 * fill-extrusion layers — so the GL map components work against either
 * library through `activeGL()`. What differs is gated on `isMapbox`:
 * mapbox:// URLs, the Standard style family, the DEM terrain and the globe
 * projection in the constructor.
 *
 * Marker/popup DOM classes differ too (.mapboxgl-* vs .maplibregl-*); code
 * that queries them uses GL_MARKER_SELECTOR.
 */

export type GLLib = typeof mapboxgl
export type GLEngine = 'mapbox' | 'maplibre'

let active: GLEngine = 'mapbox'

/** Called by a GL map before it builds itself; the helpers that make markers follow it. */
export function setActiveGLEngine(engine: GLEngine): void {
  active = engine
}

export function glLib(engine: GLEngine): GLLib {
  return (engine === 'maplibre' ? maplibregl : mapboxgl) as unknown as GLLib
}

export function activeGL(): GLLib {
  return glLib(active)
}

export const GL_MARKER_SELECTOR = '.mapboxgl-marker, .maplibregl-marker'

/** OpenFreeMap's styles — free vector tiles from OpenStreetMap, no key. */
export const OPENFREEMAP_STYLES: { id: string; url: string; dark?: boolean }[] = [
  { id: 'liberty', url: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'positron', url: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'dark', url: 'https://tiles.openfreemap.org/styles/dark', dark: true },
  { id: 'fiord', url: 'https://tiles.openfreemap.org/styles/fiord', dark: true },
]
export const DEFAULT_MAPLIBRE_STYLE = OPENFREEMAP_STYLES[0].url

/** Only http(s) style URLs reach MapLibre — a leftover mapbox:// style would fail to load. */
export function maplibreStyleUrl(setting: string | null | undefined): string {
  const s = (setting || '').trim()
  return /^https?:\/\//i.test(s) ? s : DEFAULT_MAPLIBRE_STYLE
}

export interface GLSettings {
  map_provider?: string | null
  mapbox_access_token?: string | null
  mapbox_style?: string | null
  maplibre_style?: string | null
}

/**
 * Which GL engine the settings ask for, or null for the Leaflet map.
 * Mapbox without a token falls back to Leaflet (an empty map otherwise).
 */
export function resolveGLEngine(s: GLSettings): { engine: GLEngine; style: string; token: string } | null {
  if (s.map_provider === 'maplibre') return { engine: 'maplibre', style: maplibreStyleUrl(s.maplibre_style), token: '' }
  if (s.map_provider === 'mapbox-gl' && s.mapbox_access_token) {
    return { engine: 'mapbox', style: s.mapbox_style || 'mapbox://styles/mapbox/standard', token: s.mapbox_access_token }
  }
  return null
}

/**
 * 3D buildings for an OpenFreeMap (OpenMapTiles schema) style: extrude the
 * `building` layer of its `openmaptiles` source by `render_height`. Liberty
 * already ships one, so this only adds it where it is missing.
 */
export function addOpenMapTiles3dBuildings(map: maplibregl.Map | mapboxgl.Map, dark: boolean): void {
  const m = map as maplibregl.Map
  if (m.getLayer('trek-3d-buildings') || !m.getSource('openmaptiles')) return
  const style = m.getStyle()
  if (style?.layers?.some(l => l.type === 'fill-extrusion')) return
  const firstSymbolId = style?.layers?.find(l => l.type === 'symbol')?.id
  try {
    m.addLayer({
      id: 'trek-3d-buildings',
      source: 'openmaptiles',
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': dark ? '#3b3b3f' : '#d6d3cd',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['coalesce', ['get', 'render_height'], 0]],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': 0.85,
      },
    }, firstSymbolId)
  } catch { /* style without building geometry */ }
}

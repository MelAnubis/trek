// FE-GLENGINE-001 to FE-GLENGINE-003
import { maplibreStyleUrl, resolveGLEngine, DEFAULT_MAPLIBRE_STYLE } from './glEngine'

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

describe('resolveGLEngine', () => {
  it('FE-GLENGINE-001: maplibre needs no token; mapbox needs one, else Leaflet (null)', () => {
    expect(resolveGLEngine({ map_provider: 'maplibre' })).toEqual({ engine: 'maplibre', style: DEFAULT_MAPLIBRE_STYLE, token: '' })
    expect(resolveGLEngine({ map_provider: 'mapbox-gl', mapbox_access_token: '' })).toBeNull()
    expect(resolveGLEngine({ map_provider: 'mapbox-gl', mapbox_access_token: 'pk.x' })).toEqual({ engine: 'mapbox', style: 'mapbox://styles/mapbox/standard', token: 'pk.x' })
    expect(resolveGLEngine({ map_provider: 'leaflet', mapbox_access_token: 'pk.x' })).toBeNull()
    expect(resolveGLEngine({})).toBeNull()
  })

  it('FE-GLENGINE-002: the MapLibre style is any http(s) URL, else OpenFreeMap Liberty', () => {
    expect(maplibreStyleUrl('https://tiles.openfreemap.org/styles/dark')).toBe('https://tiles.openfreemap.org/styles/dark')
    expect(maplibreStyleUrl('  https://example.com/style.json ')).toBe('https://example.com/style.json')
    expect(maplibreStyleUrl('mapbox://styles/mapbox/standard')).toBe(DEFAULT_MAPLIBRE_STYLE)
    expect(maplibreStyleUrl('javascript:alert(1)')).toBe(DEFAULT_MAPLIBRE_STYLE)
    expect(maplibreStyleUrl(null)).toBe(DEFAULT_MAPLIBRE_STYLE)
  })

  it('FE-GLENGINE-003: the default is OpenFreeMap Liberty', () => {
    expect(DEFAULT_MAPLIBRE_STYLE).toBe('https://tiles.openfreemap.org/styles/liberty')
  })
})

import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render } from '../../../tests/helpers/render'
import { act } from '@testing-library/react'
import { resetAllStores } from '../../../tests/helpers/store'
import { buildPlace } from '../../../tests/helpers/factories'
import { useSettingsStore } from '../../store/settingsStore'

// Stable fake map so fitBounds call counts survive re-renders.
const glMap = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  loaded: vi.fn().mockReturnValue(true),
  fitBounds: vi.fn(),
  flyTo: vi.fn(),
  jumpTo: vi.fn(),
  getZoom: vi.fn().mockReturnValue(10),
  addControl: vi.fn(),
  removeControl: vi.fn(),
  remove: vi.fn(),
  addSource: vi.fn(),
  getSource: vi.fn().mockReturnValue(null),
  addLayer: vi.fn(),
  setLayoutProperty: vi.fn(),
  getStyle: vi.fn().mockReturnValue({ layers: [] }),
  isStyleLoaded: vi.fn().mockReturnValue(true),
  getCanvasContainer: vi.fn(() => document.createElement('div')),
}))

vi.mock('mapbox-gl', () => ({
  default: {
    accessToken: '',
    Map: vi.fn(() => glMap),
    Marker: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      getElement: vi.fn(() => document.createElement('div')),
    })),
    LngLatBounds: vi.fn(() => ({ extend: vi.fn().mockReturnThis() })),
    NavigationControl: vi.fn(),
    // MapViewGL creates two popups up front (place hover, track click).
    Popup: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      setDOMContent: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
      isOpen: vi.fn(() => false),
      on: vi.fn().mockReturnThis(),
    })),
  },
}))
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}))

// MapLibre: the same API, its own constructor so the tests can tell which engine built the map.
const libreMap = vi.hoisted(() => ({ Map: vi.fn() }))
vi.mock('maplibre-gl', async () => {
  const mapbox = (await vi.importMock<any>('mapbox-gl')).default
  libreMap.Map.mockImplementation(() => glMap)
  return { default: { ...mapbox, Map: libreMap.Map } }
})
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

vi.mock('./mapboxSetup', () => ({
  isStandardFamily: vi.fn(() => false),
  supportsCustom3d: vi.fn(() => false),
  wantsTerrain: vi.fn(() => false),
  addCustom3dBuildings: vi.fn(),
  addTerrainAndSky: vi.fn(),
}))

vi.mock('./locationMarkerMapbox', () => ({
  attachLocationMarker: vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() })),
}))

vi.mock('./reservationsMapbox', () => ({
  ReservationMapboxOverlay: vi.fn().mockImplementation(() => ({ update: vi.fn(), destroy: vi.fn() })),
}))

vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: vi.fn(() => ({
    position: null,
    mode: 'off',
    error: null,
    cycleMode: vi.fn(),
    setMode: vi.fn(),
  })),
}))

vi.mock('../../services/photoService', () => ({
  getCached: vi.fn(() => null),
  isLoading: vi.fn(() => false),
  fetchPhoto: vi.fn(),
  onThumbReady: vi.fn(() => () => {}),
  getAllThumbs: vi.fn(() => ({})),
}))

import { MapViewGL } from './MapViewGL'
import mapboxgl from 'mapbox-gl'

function buildMapPlace(overrides: Record<string, any> = {}) {
  return {
    ...buildPlace(),
    category_name: null,
    category_color: null,
    category_icon: null,
    ...overrides,
  } as any
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      map_provider: 'mapbox-gl',
      mapbox_access_token: 'pk.test_token',
      mapbox_style: 'mapbox://styles/mapbox/streets-v12',
      mapbox_3d_enabled: false,
    },
  } as any)
})

afterEach(() => {
  vi.clearAllMocks()
  resetAllStores()
})

describe('MapViewGL', () => {
  it('FE-COMP-MAPVIEWGL-001: opening place inspector does not refit bounds (issue #921)', async () => {
    const places = [
      buildMapPlace({ id: 1, lat: 48.8584, lng: 2.2945 }),
      buildMapPlace({ id: 2, lat: 48.86, lng: 2.337 }),
    ]

    const { rerender } = render(
      <MapViewGL places={places} fitKey={1} selectedPlaceId={null} hasInspector={false} />,
    )
    await act(async () => {})
    const after_initial = glMap.fitBounds.mock.calls.length

    // Selecting a place flips hasInspector → paddingOpts memo changes.
    // fitBounds must NOT fire again (this was the bug).
    rerender(
      <MapViewGL places={places} fitKey={1} selectedPlaceId={1} hasInspector={true} />,
    )
    await act(async () => {})
    expect(glMap.fitBounds).toHaveBeenCalledTimes(after_initial)
  })

  it('FE-COMP-MAPVIEWGL-002: closing inspector does not refit bounds (issue #921)', async () => {
    const places = [
      buildMapPlace({ id: 1, lat: 48.8584, lng: 2.2945 }),
    ]

    const { rerender } = render(
      <MapViewGL places={places} fitKey={1} selectedPlaceId={1} hasInspector={true} />,
    )
    await act(async () => {})
    const after_initial = glMap.fitBounds.mock.calls.length

    // Closing inspector (X button) clears selectedPlaceId → hasInspector=false → new paddingOpts.
    rerender(
      <MapViewGL places={places} fitKey={1} selectedPlaceId={null} hasInspector={false} />,
    )
    await act(async () => {})
    expect(glMap.fitBounds).toHaveBeenCalledTimes(after_initial)
  })

  it('FE-COMP-MAPVIEWGL-003: bumping fitKey triggers a new fitBounds call', async () => {
    const places = [
      buildMapPlace({ id: 1, lat: 48.8584, lng: 2.2945 }),
    ]

    const { rerender } = render(<MapViewGL places={places} fitKey={1} />)
    await act(async () => {})
    const after_first = glMap.fitBounds.mock.calls.length

    rerender(<MapViewGL places={places} fitKey={2} />)
    await act(async () => {})
    expect(glMap.fitBounds.mock.calls.length).toBeGreaterThan(after_first)
  })

  it('FE-COMP-MAPVIEWGL-004: provider maplibre builds a MapLibre map on an OpenFreeMap style — no token, no Mapbox-only options', async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, map_provider: 'maplibre', mapbox_access_token: '', maplibre_style: 'https://tiles.openfreemap.org/styles/positron' } } as any)
    render(<MapViewGL places={[buildMapPlace({ id: 1, lat: 40.4, lng: -3.7 })]} fitKey={1} />)
    await act(async () => {})
    expect(libreMap.Map).toHaveBeenCalledTimes(1)
    expect((mapboxgl as any).Map).not.toHaveBeenCalled()
    const opts = libreMap.Map.mock.calls[0][0]
    expect(opts.style).toBe('https://tiles.openfreemap.org/styles/positron')
    expect(opts).not.toHaveProperty('projection')
    expect(opts).not.toHaveProperty('antialias')
  })

  it('FE-COMP-MAPVIEWGL-005: a leftover mapbox:// style never reaches MapLibre — it falls back to OpenFreeMap Liberty', async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, map_provider: 'maplibre', maplibre_style: 'mapbox://styles/mapbox/standard' } } as any)
    render(<MapViewGL places={[]} fitKey={1} />)
    await act(async () => {})
    expect(libreMap.Map.mock.calls[0][0].style).toBe('https://tiles.openfreemap.org/styles/liberty')
  })

  it('FE-COMP-MAPVIEWGL-006: provider mapbox-gl still builds a Mapbox map with the token and its own options', async () => {
    render(<MapViewGL places={[]} fitKey={1} />)
    await act(async () => {})
    expect((mapboxgl as any).Map).toHaveBeenCalledTimes(1)
    expect(libreMap.Map).not.toHaveBeenCalled()
    expect((mapboxgl as any).accessToken).toBe('pk.test_token')
    expect((mapboxgl as any).Map.mock.calls[0][0]).toMatchObject({ style: 'mapbox://styles/mapbox/streets-v12', projection: 'mercator' })
  })

  it('FE-COMP-MAPVIEWGL-007: a route that arrives before the style has loaded is drawn once it loads', async () => {
    const setData = vi.fn()
    let sources: Record<string, any> = {}
    glMap.getSource.mockImplementation((id: string) => sources[id] ?? null)
    glMap.addSource.mockImplementation((id: string) => { sources[id] = { setData } })
    glMap.getLayer = vi.fn(() => null) as any
    let onLoad: (() => void) | null = null
    glMap.on.mockImplementation((ev: string, a: any, b?: any) => { if (ev === 'load' && typeof a === 'function') onLoad = a; return glMap })
    const route: [number, number][][] = [[[37.38, -5.98], [37.54, -6.05]]]
    render(<MapViewGL places={[]} route={route} fitKey={1} />)
    await act(async () => {})
    expect(setData).not.toHaveBeenCalled() // no source yet
    await act(async () => { onLoad?.() })
    const routeCall = setData.mock.calls.find(c => c[0]?.features?.[0]?.geometry?.coordinates?.[0]?.[0] === -5.98)
    expect(routeCall).toBeTruthy()
    sources = {}
    glMap.getSource.mockReturnValue(null)
  })
})


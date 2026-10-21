import { useEffect, useRef } from 'react'
import type mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { isStandardFamily, supportsCustom3d, addCustom3dBuildings, addTerrainAndSky } from '../Map/mapboxSetup'
import { addOpenMapTiles3dBuildings, glLib, type GLEngine } from '../Map/glEngine'

interface Props {
  /** 'maplibre' previews an OpenFreeMap style and needs no token. */
  engine?: GLEngine
  token: string
  style: string
  lat: number
  lng: number
  zoom: number
  enable3d: boolean
  quality?: boolean
  onClick?: (latlng: { lat: number; lng: number }) => void
}

export default function MapboxPreview({ engine = 'mapbox', token, style, lat, lng, zoom, enable3d, quality = false, onClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  useEffect(() => {
    const isMapbox = engine === 'mapbox'
    if (!containerRef.current || (isMapbox && !token)) return
    const gl = glLib(engine)
    if (isMapbox) gl.accessToken = token

    const map = new gl.Map({
      container: containerRef.current,
      style,
      center: [lng, lat],
      zoom,
      pitch: enable3d ? 45 : 0,
      attributionControl: true,
      ...(isMapbox ? { antialias: quality, projection: quality ? 'globe' : 'mercator' } : {}),
    } as mapboxgl.MapOptions)
    mapRef.current = map

    map.on('load', () => {
      if (!isMapbox) {
        if (enable3d) addOpenMapTiles3dBuildings(map, document.documentElement.classList.contains('dark'))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (quality) { try { (map as any).setProjection({ type: 'globe' }) } catch { /* noop */ } }
        return
      }
      if (enable3d) {
        if (!isStandardFamily(style)) addTerrainAndSky(map)
        if (supportsCustom3d(style)) {
          const dark = document.documentElement.classList.contains('dark')
          addCustom3dBuildings(map, dark)
        }
      }
      if (style === 'mapbox://styles/mapbox/standard') {
        try { map.setTerrain(null) } catch { /* noop */ }
      }
    })

    map.on('click', (e) => {
      onClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    return () => {
      try { map.remove() } catch { /* noop */ }
      mapRef.current = null
    }
  }, [engine, token, style, enable3d, quality])

  // Recenter without rebuilding the map when lat/lng/zoom change externally
  useEffect(() => {
    if (!mapRef.current) return
    try { mapRef.current.jumpTo({ center: [lng, lat], zoom }) } catch { /* noop */ }
  }, [lat, lng, zoom])

  if (engine === 'mapbox' && !token) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 rounded-lg border border-slate-200 dark:border-slate-700">
        Enter a Mapbox access token to preview
      </div>
    )
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: '8px', overflow: 'hidden' }} />
}

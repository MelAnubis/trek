import React, { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { folderColor } from '../../utils/plannerLibrary'
import ArrowLayer from './ArrowLayer'
import { fmtKm, type OverviewRoute } from '../../utils/plannerRoute'

function FitAll({ routes }: { routes: OverviewRoute[] }) {
  const map = useMap()
  useEffect(() => {
    const pts = routes.flatMap(r => r.preview)
    if (pts.length < 2) return
    const b = L.latLngBounds(pts)
    if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 12 })
  }, [routes, map])
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

/** Todas las rutas del filtro actual sobre un solo mapa: para encontrarlas por dónde están. */
export default function OverviewMap({ routes, openLabel, onOpen }: {
  routes: OverviewRoute[]
  openLabel: string
  onOpen: (id: number) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  return (
    <MapContainer center={[40.4, -3.7]} zoom={6} style={{ width: '100%', height: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19} />
      <FitAll routes={routes} />
      {routes.map(r => r.preview.length > 1 && (
        <ArrowLayer key={`a${r.id}`} positions={r.preview} color={folderColor(r.folder)} spacingPx={140} size={14}
          opacity={hover == null || hover === r.id ? 1 : 0.5} />
      ))}
      {routes.map(r => r.preview.length > 1 && (
        <Polyline key={r.id} positions={r.preview}
          pathOptions={{
            color: folderColor(r.folder),
            weight: hover === r.id ? 7 : r.favorite ? 5 : 3.5,
            opacity: hover == null || hover === r.id ? 0.95 : 0.5,
          }}
          eventHandlers={{ mouseover: () => setHover(r.id), mouseout: () => setHover(null) }}>
          <Popup>
            <div style={{ minWidth: 150, fontSize: 12 }}>
              <div style={{ fontWeight: 700 }}>{r.favorite ? '★ ' : ''}{r.name}</div>
              <div style={{ color: '#64748b', margin: '2px 0 6px' }}>
                {fmtKm(r.total_distance_km)} · +{Math.round(r.elevation_gain)} m{r.folder ? ` · ${r.folder}` : ''}
              </div>
              <button type="button" onClick={() => onOpen(r.id)}
                style={{ background: '#e85d24', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                {openLabel}
              </button>
            </div>
          </Popup>
        </Polyline>
      ))}
    </MapContainer>
  )
}

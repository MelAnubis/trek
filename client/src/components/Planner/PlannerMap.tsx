import React, { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import ArrowLayer from './ArrowLayer'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  CATEGORY_BY_KEY, GENERIC_WAYPOINT,
  type PlannerWaypoint, type RoutePoint, type Stage,
} from '../../utils/plannerRoute'

export const STAGE_COLORS = ['#e85d24', '#2563eb', '#16a34a', '#a855f7', '#f59e0b', '#0891b2', '#db2777', '#65a30d']

export interface PoiMarker {
  osm_id: string
  name: string
  lat: number
  lng: number
  category: string
  km: number
  offM: number
}

interface Props {
  points: RoutePoint[]
  stages: Stage[]
  activeStage: number | null
  waypoints: PlannerWaypoint[]
  pois: PoiMarker[]
  hoverIdx: number | null
  addingWaypoint: boolean
  poiLabel: (category: string) => string
  texts: { addPoi: string; cutHere: string; remove: string; kmLabel: string; offRoute: string }
  /** false mientras el mapa está oculto (p. ej. se muestra la biblioteca): no se encuadra con tamaño 0. */
  visible?: boolean
  /** Cambia cuando hay que volver a encuadrar (p. ej. al volver a la pestaña del mapa en móvil). */
  refitKey?: string | number
  onMapClick: (lat: number, lng: number) => void
  onSelectStage: (i: number) => void
  onAddPoi: (poi: PoiMarker) => void
  onCutAtPoi: (poi: PoiMarker) => void
  onRemoveWaypoint: (id: string) => void
}

function emojiIcon(emoji: string, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#fff;border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 4px rgba(0,0,0,.35)">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

function ClickHandler({ enabled, onClick }: { enabled: boolean; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { if (enabled) onClick(e.latlng.lat, e.latlng.lng) } })
  const map = useMap()
  useEffect(() => {
    map.getContainer().style.cursor = enabled ? 'crosshair' : ''
  }, [enabled, map])
  return null
}

/**
 * Encuadra la ruta al cargarla, al cambiar de etapa activa y cada vez que el mapa vuelve a ser visible.
 * Leaflet guarda el tamaño del contenedor: si se encuadra con el mapa oculto (tamaño 0) o recién mostrado,
 * el zoom sale mal, así que se recalcula el tamaño justo antes de encuadrar.
 */
function FitBounds({ points, stages, activeStage, visible, refitKey }: {
  points: RoutePoint[]; stages: Stage[]; activeStage: number | null; visible: boolean; refitKey?: string | number
}) {
  const map = useMap()
  useEffect(() => {
    if (!visible || points.length < 2) return
    const slice = activeStage != null && stages[activeStage]
      ? points.slice(stages[activeStage].from, stages[activeStage].to + 1)
      : points
    const b = L.latLngBounds(slice.map(p => [p.lat, p.lng] as [number, number]))
    if (!b.isValid()) return
    const id = requestAnimationFrame(() => {
      map.invalidateSize()
      map.fitBounds(b, { padding: [30, 30], maxZoom: 15 })
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, activeStage, stages.length, visible, refitKey, map])
  return null
}

/** Reajusta el tamaño cuando el contenedor cambia (pestañas móviles, paneles). */
function InvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  return null
}

export default function PlannerMap({
  points, stages, activeStage, waypoints, pois, hoverIdx, addingWaypoint, visible = true, refitKey,
  poiLabel, texts, onMapClick, onSelectStage, onAddPoi, onCutAtPoi, onRemoveWaypoint,
}: Props) {
  const segments = useMemo(() => stages.map((st, i) => ({
    i,
    positions: points.slice(st.from, st.to + 1).map(p => [p.lat, p.lng] as [number, number]),
  })), [points, stages])

  const wpIcons = useMemo(() => waypoints.map(w => {
    const cat = CATEGORY_BY_KEY[w.type]
    return emojiIcon(cat?.emoji ?? GENERIC_WAYPOINT.emoji, cat?.color ?? GENERIC_WAYPOINT.color)
  }), [waypoints])

  const center: [number, number] = points.length ? [points[0].lat, points[0].lng] : [40.4, -3.7]

  return (
    <MapContainer center={center} zoom={points.length ? 9 : 6} style={{ width: '100%', height: '100%' }} zoomControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19} />
      <ClickHandler enabled={addingWaypoint} onClick={onMapClick} />
      <InvalidateOnResize />
      <FitBounds points={points} stages={stages} activeStage={activeStage} visible={visible} refitKey={refitKey} />

      {segments.map(seg => (
        <Polyline
          key={seg.i}
          positions={seg.positions}
          pathOptions={{
            color: STAGE_COLORS[seg.i % STAGE_COLORS.length],
            weight: activeStage === seg.i ? 6 : 4,
            opacity: activeStage == null || activeStage === seg.i ? 0.95 : 0.45,
          }}
          eventHandlers={{ click: () => { if (!addingWaypoint) onSelectStage(seg.i) } }}
        />
      ))}

      {/* Sentido del recorrido: flechas del color de cada etapa, siempre visibles */}
      {segments.map(seg => (
        <ArrowLayer key={`arrows-${seg.i}`} positions={seg.positions} color={STAGE_COLORS[seg.i % STAGE_COLORS.length]}
          opacity={activeStage == null || activeStage === seg.i ? 1 : 0.55} />
      ))}

      {points.length > 0 && (
        <>
          <CircleMarker center={[points[0].lat, points[0].lng]} radius={7}
            pathOptions={{ color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }} />
          <CircleMarker center={[points[points.length - 1].lat, points[points.length - 1].lng]} radius={7}
            pathOptions={{ color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }} />
        </>
      )}

      {stages.slice(0, -1).map((st, i) => (
        <CircleMarker key={`cut-${st.to}`} center={[points[st.to].lat, points[st.to].lng]} radius={6}
          pathOptions={{ color: '#fff', fillColor: STAGE_COLORS[(i + 1) % STAGE_COLORS.length], fillOpacity: 1, weight: 2 }} />
      ))}

      {hoverIdx != null && points[hoverIdx] && (
        <CircleMarker center={[points[hoverIdx].lat, points[hoverIdx].lng]} radius={6}
          pathOptions={{ color: '#111827', fillColor: '#fbbf24', fillOpacity: 1, weight: 2 }} />
      )}

      {pois.map(p => {
        const cat = CATEGORY_BY_KEY[p.category]
        return (
          <CircleMarker key={p.osm_id} center={[p.lat, p.lng]} radius={6}
            pathOptions={{ color: '#fff', fillColor: cat?.color ?? '#64748b', fillOpacity: 0.95, weight: 1.5 }}>
            <Popup>
              <div style={{ minWidth: 150, fontSize: 12 }}>
                <div style={{ fontWeight: 700 }}>{cat?.emoji} {p.name || poiLabel(p.category)}</div>
                <div style={{ color: '#64748b', marginBottom: 6 }}>
                  {texts.kmLabel} {p.km.toFixed(1)} · {Math.round(p.offM)} m {texts.offRoute}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => onAddPoi(p)} style={popupBtn('#16a34a')}>{texts.addPoi}</button>
                  <button type="button" onClick={() => onCutAtPoi(p)} style={popupBtn('#e85d24')}>{texts.cutHere}</button>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {waypoints.map((w, i) => (
        <Marker key={w.id} position={[w.lat, w.lng]} icon={wpIcons[i]}>
          <Popup>
            <div style={{ minWidth: 140, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{w.name || poiLabel(w.type)}</div>
              <button type="button" onClick={() => onRemoveWaypoint(w.id)} style={popupBtn('#dc2626')}>{texts.remove}</button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

function popupBtn(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
}

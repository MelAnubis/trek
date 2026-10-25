// El mapa del espacio de Tours (Leaflet, como en la v5): capas Mapa / Topo / Senderismo / Bici / Satélite,
// la línea de la excursión, sus puntos arrastrables, las demás excursiones del viaje en tenue y buscar lugar.
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Map as MapIcon, Mountain, Footprints, Bike, Satellite, Search, X, Crosshair } from 'lucide-react'
import { useTranslation } from '../i18n'
import type { DraftPoint } from './useTourPlanner'
import type { TourRoutePart } from './routing/tourRouting'

export type BaseLayer = 'map' | 'topo' | 'hiking' | 'cycling' | 'satellite'

const LAYERS: Record<BaseLayer, { url: string; attribution: string; maxZoom: number; overlay?: { url: string; attribution: string } }> = {
  map: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 },
  topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17 },
  hiking: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18,
    overlay: { url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', attribution: '&copy; waymarkedtrails.org' },
  },
  cycling: { url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap | CyclOSM', maxZoom: 19 },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri', maxZoom: 19 },
}

export interface OtherTourLine { id: number; color: string; line: [number, number][]; selected?: boolean }

interface Props {
  points: DraftPoint[]
  parts: TourRoutePart[] | null
  color: string
  others: OtherTourLine[]
  addMode: boolean
  editing: boolean
  baseLayer: BaseLayer
  onBaseLayer: (l: BaseLayer) => void
  onMapClick: (lat: number, lng: number) => void
  onRouteClick: (lat: number, lng: number) => void
  onDragPoint: (id: string, lat: number, lng: number) => void
  onSelectPoint: (id: string) => void
  onSelectTour: (id: number) => void
  selectedPointId: string | null
  focus: [number, number] | null
  fitKey: string
  onToggleAddMode: () => void
  /** Where the map opens when nothing is drawn yet: the trip's places. */
  hint: [number, number][]
  /** Room the floating panels take on each side, kept clear when the map fits the tour. */
  pad?: { left: number; right: number }
}

function pointIcon(label: string, kind: 'end' | 'via' | 'shaping', selected: boolean) {
  if (kind === 'shaping') {
    return L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div style="width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #2563eb;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>` })
  }
  const size = kind === 'end' ? 28 : 24
  const bg = selected ? '#111' : '#2563eb'
  const el = document.createElement('div')
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;font:600 12px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)`
  el.textContent = label
  return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: el.outerHTML })
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onClick(e.latlng.lat, e.latlng.lng) })
  return null
}

function Fitter({ fitKey, bounds, pad }: { fitKey: string; bounds: L.LatLngBounds | null; pad: { left: number; right: number } }) {
  const map = useMap()
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!bounds || !bounds.isValid() || last.current === fitKey) return
    last.current = fitKey
    map.fitBounds(bounds, { paddingTopLeft: [pad.left, 70], paddingBottomRight: [pad.right, 80], maxZoom: 15 })
  }, [fitKey, bounds, map, pad])
  return null
}

function Resizer() {
  const map = useMap()
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

function FlyTo({ target }: { target: { lat: number; lng: number; key: number } | null }) {
  const map = useMap()
  useEffect(() => { if (target) map.flyTo([target.lat, target.lng], 14, { duration: 0.8 }) }, [target, map])
  return null
}

function MapSearch({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const { t, language } = useTranslation()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ name: string; lat: number; lng: number }[]>([])
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=${encodeURIComponent(language)}&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() : [])
        .then((rows: { display_name: string; lat: string; lon: string }[]) => setResults(rows.map(r => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))))
        .catch(() => { /* aborted or offline: no suggestions */ })
    }, 350)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [q, language])
  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 500, width: 'min(360px, calc(100% - 120px))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 999, padding: '9px 14px', boxShadow: 'var(--shadow-card)' }}>
        <Search size={15} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('tours.planner.mapSearch')}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', minWidth: 0 }} />
        {q && <button onClick={() => setQ('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0, display: 'flex' }}><X size={14} /></button>}
      </div>
      {results.length > 0 && (
        <div style={{ marginTop: 6, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-elevated)' }}>
          {results.map((r, i) => (
            <button key={i} onClick={() => { onPick(r.lat, r.lng); setResults([]); setQ('') }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderTop: i ? '1px solid var(--border-faint)' : 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)', fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TourMap(props: Props) {
  const { t } = useTranslation()
  const { points, parts, color, others, addMode, editing, baseLayer, selectedPointId } = props
  const [fly, setFly] = useState<{ lat: number; lng: number; key: number } | null>(null)
  const layer = LAYERS[baseLayer]

  const bounds = useMemo(() => {
    const b = L.latLngBounds([])
    if (editing) {
      parts?.forEach(p => p.coordinates.forEach(c => b.extend(c)))
      points.forEach(p => b.extend([p.lat, p.lng]))
    }
    if (!b.isValid()) others.filter(o => o.selected).forEach(o => o.line.forEach(c => b.extend(c)))
    if (!b.isValid()) others.forEach(o => o.line.forEach(c => b.extend(c)))
    if (!b.isValid()) props.hint.forEach(c => b.extend(c))
    return b.isValid() ? b : null
  }, [editing, parts, points, others, props.hint])

  const routable = points.filter(p => !p.shaping)
  const numberOf = (p: DraftPoint) => routable.indexOf(p) + 1

  const layerButtons: { id: BaseLayer; label: string; icon: typeof MapIcon }[] = [
    { id: 'map', label: t('tours.map.base.map'), icon: MapIcon },
    { id: 'topo', label: t('tours.map.base.topo'), icon: Mountain },
    { id: 'hiking', label: t('tours.map.base.hiking'), icon: Footprints },
    { id: 'cycling', label: t('tours.map.base.cycling'), icon: Bike },
    { id: 'satellite', label: t('tours.map.base.satellite'), icon: Satellite },
  ]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: addMode ? 'crosshair' : undefined }} className={addMode ? 'tour-map-adding' : undefined}>
      <MapContainer center={[46.5, 11.3]} zoom={6} zoomControl={false} style={{ width: '100%', height: '100%' }} attributionControl>
        <TileLayer key={baseLayer} url={layer.url} attribution={layer.attribution} maxZoom={layer.maxZoom} subdomains="abc" />
        {layer.overlay && <TileLayer key={`${baseLayer}-o`} url={layer.overlay.url} attribution={layer.overlay.attribution} opacity={0.75} />}
        <Resizer />
        <Fitter fitKey={props.fitKey} bounds={bounds} pad={props.pad ?? { left: 40, right: 40 }} />
        <FlyTo target={fly} />
        <ClickHandler onClick={(lat, lng) => { if (addMode) props.onMapClick(lat, lng) }} />

        {others.map(o => (
          <Polyline key={`o-${o.id}-${o.selected ? 1 : 0}-${editing ? 1 : 0}`} positions={o.line} interactive={!editing}
            pathOptions={{ color: o.color, weight: o.selected ? 5 : 3.5, opacity: editing ? 0.35 : o.selected ? 0.95 : 0.6 }}
            eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); if (!editing) props.onSelectTour(o.id) } }} />
        ))}

        {editing && parts?.map((part, i) => (
          <Polyline key={`casing-${i}`} positions={part.coordinates} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} interactive={false} />
        ))}
        {editing && parts?.map((part, i) => (
          <Polyline key={`route-${i}`} positions={part.coordinates}
            pathOptions={{ color, weight: 5, opacity: 0.95, dashArray: part.free ? '8 8' : undefined }}
            eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); props.onRouteClick(e.latlng.lat, e.latlng.lng) } }} />
        ))}
        {editing && points.map((p, i) => {
          const kind = p.shaping ? 'shaping' : i === 0 || i === points.length - 1 ? 'end' : 'via'
          return (
            <Marker key={p.id} position={[p.lat, p.lng]} draggable
              icon={pointIcon(String(numberOf(p)), kind, selectedPointId === p.id)}
              eventHandlers={{
                dragend: e => { const ll = (e.target as L.Marker).getLatLng(); props.onDragPoint(p.id, ll.lat, ll.lng) },
                click: e => { L.DomEvent.stopPropagation(e as unknown as L.LeafletEvent); props.onSelectPoint(p.id) },
              }} />
          )
        })}
        {props.focus && <CircleMarker center={props.focus} radius={6} pathOptions={{ color: '#111', fillColor: '#fff', fillOpacity: 1, weight: 3 }} interactive={false} />}
      </MapContainer>

      <MapSearch onPick={(lat, lng) => setFly({ lat, lng, key: Date.now() })} />

      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: 4, boxShadow: 'var(--shadow-card)', maxWidth: 'calc(100% - 24px)', overflowX: 'auto' }}>
        {layerButtons.map(b => {
          const active = baseLayer === b.id
          return (
            <button key={b.id} onClick={() => props.onBaseLayer(b.id)} title={b.label}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', background: active ? 'var(--bg-tertiary)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              <b.icon size={14} /> <span className="hidden sm:inline">{b.label}</span>
            </button>
          )
        })}
        {editing && (
          <button onClick={props.onToggleAddMode} title={addMode ? t('tours.planner.addPointActive') : t('tours.planner.addPoint')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, marginLeft: 4, borderRadius: 999, border: 'none', cursor: 'pointer', background: addMode ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: addMode ? 'var(--bg-card)' : 'var(--text-primary)' }}>
            <Crosshair size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

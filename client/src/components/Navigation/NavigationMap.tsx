import React, { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Circle, CircleMarker, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPosition } from '../../hooks/useGeolocation'
import type { TrackPoint, NavPhoto } from '../../hooks/useNavigation'
import type { RecordedPoint } from '../../services/gpxRecorderService'

// ── Auto-center controller ────────────────────────────────────────────────────
function FollowController({ position, follow }: { position: GeoPosition | null; follow: boolean }) {
  const map = useMap()
  const centeredRef = useRef(false)

  useEffect(() => {
    if (!position) return
    if (follow) {
      try {
        map.setView([position.lat, position.lng], Math.max(map.getZoom(), 16), { animate: true, duration: 0.4 })
      } catch { /* noop */ }
      centeredRef.current = true
    } else if (!centeredRef.current) {
      try { map.setView([position.lat, position.lng], 15) } catch { /* noop */ }
      centeredRef.current = true
    }
  }, [position, follow, map])

  return null
}

// ── User position dot + heading cone ─────────────────────────────────────────
function UserMarker({ position }: { position: GeoPosition }) {
  const headingIcon = position.heading !== null && !Number.isNaN(position.heading)
    ? L.divIcon({
        className: '',
        iconSize: [60, 60],
        iconAnchor: [30, 30],
        html: `<div style="
          width:60px;height:60px;
          transform:rotate(${position.heading}deg);
          transition:transform 120ms ease-out;
          background:conic-gradient(from -30deg,rgba(59,130,246,0) 0deg,rgba(59,130,246,0.4) 15deg,rgba(59,130,246,0) 60deg,rgba(59,130,246,0) 360deg);
          border-radius:50%;
          -webkit-mask:radial-gradient(circle, transparent 12px, black 13px);
          mask:radial-gradient(circle, transparent 12px, black 13px);
          pointer-events:none;
        "></div>`,
      })
    : null

  return (
    <>
      {position.accuracy < 500 && (
        <Circle
          center={[position.lat, position.lng]}
          radius={position.accuracy}
          pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1, opacity: 0.3 }}
          interactive={false}
        />
      )}
      {headingIcon && (
        <Marker position={[position.lat, position.lng]} icon={headingIcon} interactive={false} zIndexOffset={900} />
      )}
      <CircleMarker
        center={[position.lat, position.lng]}
        radius={9}
        pathOptions={{ color: 'white', fillColor: '#3b82f6', fillOpacity: 1, weight: 3 }}
        interactive={false}
      />
    </>
  )
}

// ── Start/end markers ─────────────────────────────────────────────────────────
function EndpointMarker({ point, label, color }: { point: [number, number]; label: string; color: string }) {
  const icon = L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};border:2.5px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:800;color:#fff;
      font-family:system-ui,sans-serif;
    ">${label}</div>`,
  })
  return <Marker position={point} icon={icon} interactive={false} />
}

// ── Photo pin marker ──────────────────────────────────────────────────────────
function PhotoMarker({ photo }: { photo: NavPhoto }) {
  const icon = L.divIcon({
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<div style="
      width:32px;height:32px;border-radius:8px;
      background:#0f172a;border:2.5px solid #22d96e;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
      overflow:hidden;
    ">
      <img src="${photo.url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" />
    </div>`,
  })
  return <Marker position={[photo.lat, photo.lng]} icon={icon} interactive={false} />
}

// ── Tile layer catalogue ──────────────────────────────────────────────────────
const TILE_LAYERS = {
  topo: {
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    color: '#4ade80',
  },
  cyclosm: {
    label: 'Ciclismo',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: 'CyclOSM | OpenStreetMap',
    maxZoom: 20,
    color: '#38bdf8',
  },
  dark: {
    label: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
    maxZoom: 19,
    color: '#94a3b8',
  },
  osm: {
    label: 'Estándar',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    color: '#fb923c',
  },
} as const

type TileKey = keyof typeof TILE_LAYERS
const STORAGE_KEY = 'trek_nav_tile'

function loadTileKey(): TileKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v in TILE_LAYERS) return v as TileKey
  } catch { /* noop */ }
  return 'topo'
}

// ── Floating tile picker ──────────────────────────────────────────────────────
function TilePicker({ current, onChange }: { current: TileKey; onChange: (k: TileKey) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'absolute', top: 104, right: 12, zIndex: 400, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Cambiar mapa"
        style={{
          width: 38, height: 38,
          borderRadius: 10,
          background: 'rgba(10,10,20,0.88)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: `1.5px solid ${TILE_LAYERS[current].color}55`,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      >
        {/* Layers icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TILE_LAYERS[current].color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
          <polyline points="2 12 12 17 22 12"/>
        </svg>
      </button>

      {/* Options panel */}
      {open && (
        <div style={{
          background: 'rgba(10,10,20,0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: '6px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          minWidth: 120,
        }}>
          {(Object.keys(TILE_LAYERS) as TileKey[]).map(key => {
            const t = TILE_LAYERS[key]
            const active = key === current
            return (
              <button
                key={key}
                onClick={() => { onChange(key); setOpen(false) }}
                style={{
                  background: active ? `${t.color}18` : 'transparent',
                  border: `1px solid ${active ? t.color + '50' : 'transparent'}`,
                  borderRadius: 8,
                  padding: '7px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: active ? '#f1f5f9' : '#94a3b8', fontWeight: active ? 700 : 400 }}>{t.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Props {
  position: GeoPosition | null
  trackPoints: TrackPoint[]           // GPX track to follow (orange)
  recordedPoints: RecordedPoint[]     // Live-recorded track (green)
  approachRoute?: [number, number][] | null  // Approach route (blue dashed)
  navPhotos?: NavPhoto[]              // Geotagged photos taken during navigation
  follow: boolean
  onMapTouch?: () => void
}

export default function NavigationMap({ position, trackPoints, recordedPoints, approachRoute, navPhotos, follow, onMapTouch }: Props) {
  const [tileKey, setTileKey] = useState<TileKey>(loadTileKey)

  const handleTileChange = (k: TileKey) => {
    setTileKey(k)
    try { localStorage.setItem(STORAGE_KEY, k) } catch { /* noop */ }
  }

  const defaultCenter: [number, number] = position
    ? [position.lat, position.lng]
    : trackPoints.length > 0
      ? [trackPoints[0].lat, trackPoints[0].lng]
      : [40.4168, -3.7038] // Madrid fallback

  const trackLatLngs: [number, number][] = trackPoints.map(p => [p.lat, p.lng])
  const recordedLatLngs: [number, number][] = recordedPoints.map(p => [p.lat, p.lng])
  const tile = TILE_LAYERS[tileKey]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <MapContainer
      center={defaultCenter}
      zoom={15}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      attributionControl={false}
      tap={false}
    >
      <TileLayer
        key={tileKey}
        url={tile.url}
        attribution={tile.attribution}
        maxZoom={tile.maxZoom}
      />

      <FollowController position={position} follow={follow} />

      {/* GPX track to follow */}
      {trackLatLngs.length > 1 && (
        <>
          {/* Shadow stroke */}
          <Polyline
            positions={trackLatLngs}
            pathOptions={{ color: '#000', weight: 6, opacity: 0.3 }}
            interactive={false}
          />
          <Polyline
            positions={trackLatLngs}
            pathOptions={{ color: '#f59e0b', weight: 4, opacity: 0.9, dashArray: undefined }}
            interactive={false}
          />
          {/* Start marker */}
          <EndpointMarker point={trackLatLngs[0]} label="S" color="#22d96e" />
          {/* End marker */}
          <EndpointMarker point={trackLatLngs[trackLatLngs.length - 1]} label="F" color="#ef4444" />
        </>
      )}

      {/* Approach route (blue dashed) */}
      {approachRoute && approachRoute.length > 1 && (
        <Polyline
          positions={approachRoute}
          pathOptions={{ color: '#38bdf8', weight: 3, opacity: 0.85, dashArray: '8 6' }}
          interactive={false}
        />
      )}

      {/* Live recording track */}
      {recordedLatLngs.length > 1 && (
        <Polyline
          positions={recordedLatLngs}
          pathOptions={{ color: '#22d96e', weight: 4, opacity: 0.9 }}
          interactive={false}
        />
      )}

      {/* Nav photo pins */}
      {navPhotos?.map(p => <PhotoMarker key={p.id} photo={p} />)}

      {/* User position */}
      {position && <UserMarker position={position} />}

      {/* Touch handler to break auto-follow */}
      {onMapTouch && <TouchBreaker onTouch={onMapTouch} />}
    </MapContainer>
    <TilePicker current={tileKey} onChange={handleTileChange} />
    </div>
  )
}

function TouchBreaker({ onTouch }: { onTouch: () => void }) {
  const map = useMap()
  useEffect(() => {
    map.on('dragstart', onTouch)
    return () => { map.off('dragstart', onTouch) }
  }, [map, onTouch])
  return null
}

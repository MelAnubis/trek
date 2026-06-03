import React, { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, Circle, CircleMarker, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPosition } from '../../hooks/useGeolocation'
import type { TrackPoint } from '../../hooks/useNavigation'
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

interface Props {
  position: GeoPosition | null
  trackPoints: TrackPoint[]           // GPX track to follow (orange)
  recordedPoints: RecordedPoint[]     // Live-recorded track (green)
  approachRoute?: [number, number][] | null  // Approach route (blue dashed)
  follow: boolean
  onMapTouch?: () => void
}

export default function NavigationMap({ position, trackPoints, recordedPoints, approachRoute, follow, onMapTouch }: Props) {
  const defaultCenter: [number, number] = position
    ? [position.lat, position.lng]
    : trackPoints.length > 0
      ? [trackPoints[0].lat, trackPoints[0].lng]
      : [40.4168, -3.7038] // Madrid fallback

  const trackLatLngs: [number, number][] = trackPoints.map(p => [p.lat, p.lng])
  const recordedLatLngs: [number, number][] = recordedPoints.map(p => [p.lat, p.lng])

  return (
    <MapContainer
      center={defaultCenter}
      zoom={15}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      attributionControl={false}
      tap={false}
    >
      {/* Dark tile layer — better for navigation */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap &copy; CARTO"
        maxZoom={19}
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

      {/* User position */}
      {position && <UserMarker position={position} />}

      {/* Touch handler to break auto-follow */}
      {onMapTouch && <TouchBreaker onTouch={onMapTouch} />}
    </MapContainer>
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

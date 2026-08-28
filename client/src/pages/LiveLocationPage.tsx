import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { liveLocationApi } from '../api/client'

// Refresco de la posición para quien ve el enlace — no es websocket,
// es sondeo simple cada pocos segundos (igual de "en vivo" para el caso
// de uso, y mucho más sencillo de mantener).
const POLL_INTERVAL_MS = 6_000

interface TrackPoint { lat: number; lng: number; recorded_at: string }
interface LiveStatus {
  active: boolean
  label: string | null
  started_at: string
  stopped_at: string | null
  last_position: { lat: number; lng: number; accuracy: number | null; speed: number | null; recorded_at: string } | null
  track: TrackPoint[]
}

const markerIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
})

// El GPS en Android se suspende con la pantalla apagada o la app en segundo
// plano; al reanudar, el siguiente punto puede llegar minutos después del
// anterior. Unirlos con una línea recta dibujaría un tramo que nunca se
// recorrió, así que se corta el trazo en huecos grandes y cada tramo se
// pinta como una polilínea aparte.
const GAP_MS = 5 * 60_000

function splitOnGaps(points: TrackPoint[]): [number, number][][] {
  const segments: [number, number][][] = []
  let current: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && Date.parse(points[i].recorded_at) - Date.parse(points[i - 1].recorded_at) > GAP_MS) {
      segments.push(current)
      current = []
    }
    current.push([points[i].lat, points[i].lng])
  }
  if (current.length > 0) segments.push(current)
  return segments
}

function RecenterOnUpdate({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    map.setView([lat, lng], first.current ? 15 : map.getZoom())
    first.current = false
  }, [lat, lng, map])
  return null
}

export default function LiveLocationPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<LiveStatus | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const poll = () => {
      liveLocationApi.getPublic(token)
        .then((res: LiveStatus) => { if (!cancelled) setData(res) })
        .catch(() => { if (!cancelled) setNotFound(true) })
    }
    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [token])

  if (notFound) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f3f4f6' }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📍</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>Este enlace ya no está activo</h1>
          <p style={{ color: '#6b7280', marginTop: 8 }}>Puede haber caducado o la persona que lo compartió lo ha detenido.</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f3f4f6' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#111827', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  const pos = data.last_position
  const segments = splitOnGaps(data.track)

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
        padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{data.label || 'Ubicación en vivo'}</div>
          {pos && <div style={{ fontSize: 12, color: '#6b7280' }}>Última actualización: {new Date(pos.recorded_at).toLocaleTimeString()}</div>}
        </div>
        {!data.active && (
          <span style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '4px 10px', borderRadius: 999 }}>
            Dejó de compartir
          </span>
        )}
      </div>

      {pos ? (
        <MapContainer center={[pos.lat, pos.lng]} zoom={15} style={{ width: '100%', height: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {segments.map((segment, i) => segment.length > 1 && (
            <Polyline key={i} positions={segment} pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.7 }} />
          ))}
          <Marker position={[pos.lat, pos.lng]} icon={markerIcon} />
          <RecenterOnUpdate lat={pos.lat} lng={pos.lng} />
        </MapContainer>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
          Esperando la primera posición…
        </div>
      )}
    </div>
  )
}

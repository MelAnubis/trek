/**
 * /live/:token — what someone with a "Tracking en vivo" link sees (5.7.1):
 * where the phone is, how fresh that is, what it is doing (moving and how,
 * at home, asleep, tracking off), its battery, and the track since the link
 * was made, coloured by motion. Public, no account; polled every 15 s, which
 * is as often as Overland uploads by default anyway.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { trackingApi } from '../api/client'
import { useTranslation } from '../i18n'
import { BatteryBadge, DeviceStatusChip, useAgo } from '../components/Tracking/DeviceStatus'
import { formatDistance, motionSegments, type TrackPoint, type TrackStats, type TrackingPosition, type TrackingStatus } from '../components/Tracking/trackingModel'

const POLL_INTERVAL_MS = 15_000

interface PublicShare {
  label: string
  expires_at: string | null
  status: TrackingStatus
  status_at: string | null
  battery_level: number | null
  last_position: TrackingPosition | null
  track: TrackPoint[]
  stats: TrackStats
}

const markerIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>',
})

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    map.setView([lat, lng], first.current ? 15 : map.getZoom())
    first.current = false
  }, [lat, lng, map])
  return null
}

export default function LiveLocationPage() {
  const { t } = useTranslation()
  const ago = useAgo()
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicShare | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const poll = () => {
      trackingApi.getPublic(token)
        .then((res: PublicShare) => { if (!cancelled) { setData(res); setNotFound(false) } })
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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{t('tracking.public.gone')}</h1>
          <p style={{ color: '#6b7280', marginTop: 8 }}>{t('tracking.public.goneHint')}</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f3f4f6' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#111827', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    )
  }

  const pos = data.last_position
  const segments = motionSegments(data.track)

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div data-testid="live-header" style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{data.label}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {pos ? `${t('tracking.lastPoint')}: ${ago(pos.recorded_at)}` : t('tracking.public.waiting')}
            {data.stats.distance_m > 0 ? ` · ${formatDistance(data.stats.distance_m)}` : ''}
          </div>
        </div>
        <DeviceStatusChip device={{ status: data.status, last_position: pos, last_seen_at: null }} />
        <BatteryBadge level={data.battery_level} />
      </div>

      {pos ? (
        <MapContainer center={[pos.lat, pos.lng]} zoom={15} style={{ width: '100%', height: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {segments.map((s, i) => <Polyline key={i} positions={s.positions} pathOptions={{ color: s.color, weight: 4, opacity: 0.8 }} />)}
          <Marker position={[pos.lat, pos.lng]} icon={markerIcon} />
          <Recenter lat={pos.lat} lng={pos.lng} />
        </MapContainer>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
          {t('tracking.public.waiting')}
        </div>
      )}
    </div>
  )
}

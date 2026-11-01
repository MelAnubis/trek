/**
 * /live/:token — what someone with a "Tracking en vivo" link sees (5.7.1,
 * reworked in 5.7.13 to read like a messaging app's live location): the map
 * fills the screen, the phone is a pulsing avatar that glides to each new
 * fix with its accuracy and heading, the track since the link was made is
 * drawn under it, and a card at the bottom says who it is, until when the
 * link lasts, how fresh the position is, what the phone is doing and its
 * battery. Public, no account. Polled every 10 s while the page is visible
 * and at once when it is shown again (an installed PWA brought back to the
 * front, the network back), so the viewer never has to reload.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer } from 'react-leaflet'
import { isAxiosError } from 'axios'
import { Crosshair, Maximize2, Minimize2, Navigation2 } from 'lucide-react'
import { trackingApi } from '../api/client'
import { useTranslation } from '../i18n'
import { BatteryBadge, DeviceStatusChip, useAgo } from '../components/Tracking/DeviceStatus'
import { useMatchedTrack } from '../components/Tracking/useMatchedTrack'
import { AutoResize, FollowLive, LIVE_COLOR, LiveMapStyles, LiveMarker, LiveTrail, headingOf, useLiveRefresh, useTick } from '../components/Tracking/LiveMap'
import { formatDistance, isFresh, type TrackPoint, type TrackStats, type TrackingPosition, type TrackingStatus } from '../components/Tracking/trackingModel'

const POLL_INTERVAL_MS = 10_000
const EMPTY: TrackPoint[] = []

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

export default function LiveLocationPage() {
  const { t, locale } = useTranslation()
  const ago = useAgo()
  useTick(5000)
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicShare | null>(null)
  const [notFound, setNotFound] = useState(false)
  /** The last poll failed for a reason other than the link being gone (no signal, server restarting). */
  const [offline, setOffline] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [follow, setFollow] = useState(true)
  const [cardOpen, setCardOpen] = useState(true)
  const inFlight = useRef(false)
  // Along streets and paths, as on the owner's map; a link is live, so matched again a while after it grows.
  const { lines } = useMatchedTrack(data?.track ?? EMPTY, true, 20_000)

  const poll = useCallback(() => {
    if (!token || inFlight.current) return
    inFlight.current = true
    trackingApi.getPublic(token)
      .then((res: PublicShare) => { setData(res); setNotFound(false); setOffline(false); setFetchedAt(Date.now()) })
      .catch((err: unknown) => {
        // Only a link the server says is gone ends the page; anything else keeps the last map and retries.
        if (isAxiosError(err) && err.response?.status === 404) setNotFound(true)
        else setOffline(true)
      })
      .finally(() => { inFlight.current = false })
  }, [token])
  useLiveRefresh(poll, POLL_INTERVAL_MS, !!token && !notFound)

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f3f4f6', color: '#6b7280', fontSize: 13 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#111827', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        {offline && <span>{t('tracking.live.offline')}</span>}
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    )
  }

  const pos = data.last_position
  const live: [number, number] | null = pos ? [pos.lat, pos.lng] : null
  const fresh = isFresh({ last_position: pos })
  const heading = headingOf(data.track, live, pos?.speed)
  const until = data.expires_at ? new Date(data.expires_at).toLocaleString(locale, sameDay(data.expires_at)
    ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
  const speedKmh = fresh && pos?.speed != null && pos.speed > 0.7 ? Math.round(pos.speed * 3.6) : null
  const initial = Array.from(data.label.trim())[0]?.toUpperCase() ?? '•'

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e5e7eb' }}>
      <LiveMapStyles />

      {pos ? (
        <MapContainer center={[pos.lat, pos.lng]} zoom={16} zoomControl={false} style={{ position: 'absolute', inset: 0 }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <LiveTrail lines={lines} snap live={live} />
          <LiveMarker position={[pos.lat, pos.lng]} name={data.label} fresh={fresh} accuracy={pos.accuracy} heading={heading} onClick={() => setFollow(true)} />
          <FollowLive position={live} follow={follow} onUserMove={() => setFollow(false)} />
          <AutoResize />
        </MapContainer>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
          {t('tracking.public.waiting')}
        </div>
      )}

      {/* Top: the live badge and how fresh the page is. */}
      <div style={{
        position: 'absolute', top: 'calc(10px + env(safe-area-inset-top))', left: 12, right: 12, zIndex: 1000,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <div data-testid="live-badge" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999,
          background: 'rgba(17,24,39,0.82)', color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          <span className={offline ? undefined : 'trek-live-dot'} style={{ width: 8, height: 8, borderRadius: '50%', background: offline ? '#f59e0b' : fresh ? '#22c55e' : '#9ca3af' }} />
          {offline ? t('tracking.live.offline') : t('tracking.live.badge')}
          {!offline && fetchedAt && <span style={{ fontWeight: 400, opacity: 0.75 }}>· {t('tracking.live.refreshed', { when: secondsAgo(fetchedAt, t) })}</span>}
        </div>
      </div>

      {/* Right: recentre and hide/show the card. */}
      {pos && (
        <div style={{ position: 'absolute', right: 12, bottom: cardOpen ? 'calc(150px + env(safe-area-inset-bottom))' : 'calc(76px + env(safe-area-inset-bottom))', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" onClick={() => setCardOpen(o => !o)} aria-label={cardOpen ? t('tracking.live.hideCard') : t('tracking.live.showCard')}
            title={cardOpen ? t('tracking.live.hideCard') : t('tracking.live.showCard')} style={fab(false)}>
            {cardOpen ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
          </button>
          <button type="button" data-testid="live-recenter" onClick={() => setFollow(true)} aria-pressed={follow}
            aria-label={t('tracking.live.recenter')} title={t('tracking.live.recenter')} style={fab(follow)}>
            <Crosshair size={20} />
          </button>
        </div>
      )}

      {/* Bottom: who, until when, how fresh, what the phone is doing. */}
      <div data-testid="live-header" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1000,
        background: 'rgba(255,255,255,0.97)', borderRadius: '18px 18px 0 0', boxShadow: '0 -4px 18px rgba(0,0,0,0.15)',
        padding: `10px 16px calc(${cardOpen ? 14 : 10}px + env(safe-area-inset-bottom))`, maxWidth: 640, margin: '0 auto',
      }}>
        <button type="button" onClick={() => setCardOpen(o => !o)} aria-label={cardOpen ? t('tracking.live.hideCard') : t('tracking.live.showCard')}
          style={{ display: 'block', margin: '0 auto 8px', width: 40, height: 5, borderRadius: 3, background: '#d1d5db', border: 'none', padding: 0, cursor: 'pointer' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: fresh ? LIVE_COLOR : '#6b7280', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18,
          }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
            <div style={{ fontSize: 12.5, color: fresh ? '#16a34a' : '#6b7280', fontWeight: 500 }}>
              {until ? t('tracking.live.until', { time: until }) : t('tracking.live.sharing')}
            </div>
          </div>
          {pos && (
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lng}`} target="_blank" rel="noopener noreferrer"
              aria-label={t('tracking.live.directions')} title={t('tracking.live.directions')}
              style={{ width: 40, height: 40, borderRadius: '50%', background: '#eff6ff', color: LIVE_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Navigation2 size={18} />
            </a>
          )}
        </div>
        {cardOpen && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: '#4b5563' }}>
            <span>{pos ? t('tracking.live.updated', { when: ago(pos.recorded_at) }) : t('tracking.public.waiting')}</span>
            {data.stats.distance_m > 0 && <span>· {formatDistance(data.stats.distance_m)}</span>}
            {speedKmh != null && <span>· {speedKmh} km/h</span>}
            {pos?.accuracy != null && pos.accuracy > 0 && <span style={{ color: '#9ca3af' }}>· ±{Math.round(pos.accuracy)} m</span>}
            <span style={{ flex: 1 }} />
            <DeviceStatusChip device={{ status: data.status, last_position: pos, last_seen_at: null }} />
            <BatteryBadge level={data.battery_level} />
          </div>
        )}
      </div>
    </div>
  )
}

function fab(active: boolean): React.CSSProperties {
  return {
    width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: '#fff', color: active ? LIVE_COLOR : '#374151', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}

function sameDay(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function secondsAgo(at: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 5) return t('tracking.justNow')
  if (s < 60) return t('tracking.live.secondsAgo', { n: s })
  return t('tracking.minutesAgo', { n: Math.round(s / 60) })
}

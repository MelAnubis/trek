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
      <div className="!flex !items-center !justify-center !min-h-[100vh] ![background:#f3f4f6]">
        <div className="!text-center !p-[40px]">
          <div className="!text-[length:48px] !mb-[16px]">📍</div>
          <h1 className="!text-[length:20px] !font-[700] ![color:#111827]">{t('tracking.public.gone')}</h1>
          <p className="![color:#6b7280] !mt-[8px]">{t('tracking.public.goneHint')}</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="!flex !flex-col !gap-[12px] !items-center !justify-center !min-h-[100vh] ![background:#f3f4f6] ![color:#6b7280] !text-[length:13px]">
        <div className="!w-[32px] !h-[32px] ![border:3px_solid_#e5e7eb] [&&]:![border-top-color:#111827] !rounded-[50%]" style={{ animation: 'spin 0.6s linear infinite' }} />
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
    <div className="!fixed !inset-[0] ![background:#e5e7eb]">
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
        <div className="!flex !items-center !justify-center !h-[100%] ![color:#6b7280]">
          {t('tracking.public.waiting')}
        </div>
      )}

      {/* Top: the live badge and how fresh the page is. */}
      <div className="!absolute !top-[calc(10px_+_env(safe-area-inset-top))] !left-[12px] !right-[12px] !z-[1000] !flex !justify-center !pointer-events-none">
        <div className="!inline-flex !items-center !gap-[8px] !p-[6px_12px] !rounded-[999px] ![background:rgba(17,24,39,0.82)] ![color:#fff] !text-[length:12px] !font-[600] ![box-shadow:0_2px_8px_rgba(0,0,0,0.25)]" data-testid="live-badge">
          <span className={[offline ? undefined : 'trek-live-dot', '!w-[8px] !h-[8px] !rounded-[50%]'].join(' ')} style={{ background: offline ? '#f59e0b' : fresh ? '#22c55e' : '#9ca3af' }} />
          {offline ? t('tracking.live.offline') : t('tracking.live.badge')}
          {!offline && fetchedAt && <span className="!font-[400]" style={{ opacity: 0.75 }}>· {t('tracking.live.refreshed', { when: secondsAgo(fetchedAt, t) })}</span>}
        </div>
      </div>

      {/* Right: recentre and hide/show the card. */}
      {pos && (
        <div className={['!absolute !z-[1000] !flex !flex-col !gap-[8px]', (cardOpen) ? '!bottom-[calc(150px_+_env(safe-area-inset-bottom))]' : '!bottom-[calc(76px_+_env(safe-area-inset-bottom))]', '!right-[12px]'].join(' ')}>
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
      <div className="!absolute !left-[0] !right-[0] !bottom-[0] !z-[1000] ![background:rgba(255,255,255,0.97)] !rounded-[18px_18px_0_0] ![box-shadow:0_-4px_18px_rgba(0,0,0,0.15)] !max-w-[640px] !m-[0_auto]" data-testid="live-header" style={{ padding: `10px 16px calc(${cardOpen ? 14 : 10}px + env(safe-area-inset-bottom))` }}>
        <button className="!block !m-[0_auto_8px] !w-[40px] !h-[5px] !rounded-[3px] ![background:#d1d5db] ![border:none] !p-[0] !cursor-pointer" type="button" onClick={() => setCardOpen(o => !o)} aria-label={cardOpen ? t('tracking.live.hideCard') : t('tracking.live.showCard')} />
        <div className="!flex !items-center !gap-[12px]">
          <div className="!w-[42px] !h-[42px] !rounded-[50%] !shrink-[0] ![color:#fff] !flex !items-center !justify-center !font-[700] !text-[length:18px]" style={{ background: fresh ? LIVE_COLOR : '#6b7280' }}>{initial}</div>
          <div className="!flex-[1] !min-w-[0]">
            <div className="!font-[700] !text-[length:16px] ![color:#111827] !overflow-hidden !text-ellipsis !whitespace-nowrap">{data.label}</div>
            <div className="!text-[length:12.5px] !font-[500]" style={{ color: fresh ? '#16a34a' : '#6b7280' }}>
              {until ? t('tracking.live.until', { time: until }) : t('tracking.live.sharing')}
            </div>
          </div>
          {pos && (
            <a className="!w-[40px] !h-[40px] !rounded-[50%] ![background:#eff6ff] !flex !items-center !justify-center !shrink-[0]" href={`https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lng}`} target="_blank" rel="noopener noreferrer"
              aria-label={t('tracking.live.directions')} title={t('tracking.live.directions')}
              style={{ color: LIVE_COLOR }}>
              <Navigation2 size={18} />
            </a>
          )}
        </div>
        {cardOpen && (
          <div className="!mt-[10px] !flex !items-center !gap-[10px] !flex-wrap !text-[length:12.5px] ![color:#4b5563]">
            <span>{pos ? t('tracking.live.updated', { when: ago(pos.recorded_at) }) : t('tracking.public.waiting')}</span>
            {data.stats.distance_m > 0 && <span>· {formatDistance(data.stats.distance_m)}</span>}
            {speedKmh != null && <span>· {speedKmh} km/h</span>}
            {pos?.accuracy != null && pos.accuracy > 0 && <span className="![color:#9ca3af]">· ±{Math.round(pos.accuracy)} m</span>}
            <span className="!flex-[1]" />
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

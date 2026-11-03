/**
 * Tracking en vivo (5.7.1) — the owner's map. A phone running Overland posts
 * its points to Trek; this page shows where it is now (pushed over the
 * websocket, no polling), the track of any day coloured by how it was moving,
 * and turns a day into something lasting: a GPX download, a route of a trip
 * (so it shows on the trip, the journey and the Studio), or a public link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ArrowLeft, ChevronUp, Crosshair, Download, Link2, Maximize2, Minimize2, Radio, RefreshCw, Save, Settings, Share2, X } from 'lucide-react'
import { daysApi, trackingApi, tripsApi } from '../api/client'
import { addListener, removeListener } from '../api/websocket'
import { useTranslation } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import { useToast } from '../components/shared/Toast'
import { CopyField } from '../components/Tracking/CopyField'
import { joinedLine, useMatchedTrack, type MatchStatus } from '../components/Tracking/useMatchedTrack'
import { AutoResize, FollowLive, LiveMapStyles, LiveMarker, LiveTrail, headingOf, useLiveRefresh } from '../components/Tracking/LiveMap'
import { gapsOf, type TrackGap } from '../components/Tracking/mapMatch'
import { BatteryBadge, DeviceStatusChip, useAgo } from '../components/Tracking/DeviceStatus'
import {
  MOTION_COLORS, formatDistance, formatDuration, isFresh, joinsLive, localDayRange, localToday, motionColor, shareUrl, splitTrips, utcOffsetMinutes,
  type DayTrip, type TrackPoint, type TrackStats, type TrackingDevice,
} from '../components/Tracking/trackingModel'

const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

/** A trip's start on the map: its number in the colour of how it was travelled. */
function tripIcon(n: number, color: string) {
  return L.divIcon({
    className: '',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font:700 11px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${n}</span>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  })
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const tripStyle = (on: boolean): React.CSSProperties => ({
  border: on ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
  background: on ? 'var(--bg-tertiary)' : 'var(--bg-card)', color: 'var(--text-primary)',
})
/** Points worse than this are left out when "Hide imprecise points" is on. */
const GOOD_ACCURACY_M = 100

/** How often the open map asks again even without websocket news (a PWA whose socket died in the background). */
const FALLBACK_POLL_MS = 30_000

function FitTo({ points, live, follow }: { points: TrackPoint[]; live: [number, number] | null; follow: boolean }) {
  const map = useMap()
  const fittedFor = useRef<string>('')
  useEffect(() => {
    // Fitted once per day shown (its first point), not on every new point of today.
    const key = points.length ? points[0].ts : live ? 'live' : ''
    if (follow && live) return // FollowLive keeps the phone in view.
    if (key === fittedFor.current) return
    fittedFor.current = key
    if (points.length > 1) map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [30, 30] })
    else if (live) map.setView(live, 14)
  }, [points, live, follow, map])
  return null
}

interface Day { day: string; points: number }

export default function TrackingPage() {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const ago = useAgo()
  const [params, setParams] = useSearchParams()
  const tileUrl = useSettingsStore(s => s.settings.map_tile_url) || OSM

  const [devices, setDevices] = useState<TrackingDevice[] | null>(null)
  const deviceId = Number(params.get('device')) || devices?.[0]?.id || null
  const device = devices?.find(d => d.id === deviceId) ?? null
  const [day, setDay] = useState(localToday())
  const [days, setDays] = useState<Day[]>([])
  const [points, setPoints] = useState<TrackPoint[]>([])
  const [stats, setStats] = useState<TrackStats | null>(null)
  const [total, setTotal] = useState(0)
  /** Fixes the accuracy filter left out (5.7.9): a hole that is a filter, not a loss. */
  const [hidden, setHidden] = useState(0)
  const [hideImprecise, setHideImprecise] = useState(true)
  const [follow, setFollow] = useState(false)
  // Drawn along streets and paths (5.7.3) unless turned off; remembered per browser.
  const [snap, setSnapState] = useState(() => { try { return localStorage.getItem('trek-tracking-snap') !== '0' } catch { return true } })
  const setSnap = (v: boolean) => { setSnapState(v); try { localStorage.setItem('trek-tracking-snap', v ? '1' : '0') } catch { /* private mode */ } }
  const [panel, setPanel] = useState<'share' | 'save' | null>(null)
  /** The trip of the day shown on its own (5.7.21), by its number; null shows them all. */
  const [tripSel, setTripSel] = useState<number | null>(null)
  /** On a phone: the map alone, the panel folded away. */
  const [mapOnly, setMapOnly] = useState(false)
  const isToday = day === localToday()

  const loadDevices = useCallback(() => trackingApi.devices()
    .then((r: { devices: TrackingDevice[] }) => setDevices(r.devices))
    .catch(() => setDevices([])), [])
  useEffect(() => { void loadDevices() }, [loadDevices])

  const range = useMemo(() => localDayRange(day), [day])
  const accuracy = hideImprecise ? GOOD_ACCURACY_M : undefined

  const loadTrack = useCallback(() => {
    if (!deviceId) return
    trackingApi.track(deviceId, { ...range, max_accuracy: accuracy })
      .then((r: { points: TrackPoint[]; stats: TrackStats; total: number; hidden?: number }) => { setPoints(r.points); setStats(r.stats); setTotal(r.total); setHidden(r.hidden ?? 0) })
      .catch(() => { setPoints([]); setStats(null); setTotal(0); setHidden(0) })
  }, [deviceId, range, accuracy])
  useEffect(() => { loadTrack() }, [loadTrack])

  useEffect(() => {
    if (!deviceId) return
    trackingApi.days(deviceId, utcOffsetMinutes()).then((r: { days: Day[] }) => setDays(r.days)).catch(() => setDays([]))
  }, [deviceId, total])

  // The phone's batches arrive over the websocket: the device card updates at
  // once, and today's track is fetched again (at most every few seconds).
  const refetchTimer = useRef<number | null>(null)
  useEffect(() => {
    const handler = (event: Record<string, unknown>) => {
      if (event.type !== 'tracking:update') return
      const next = event.device as TrackingDevice | undefined
      if (!next) return
      setDevices(list => list?.map(d => (d.id === next.id ? next : d)) ?? list)
      if (next.id === deviceId && isToday && refetchTimer.current == null) {
        refetchTimer.current = window.setTimeout(() => { refetchTimer.current = null; loadTrack() }, 3000)
      }
    }
    addListener(handler)
    return () => { removeListener(handler); if (refetchTimer.current) { clearTimeout(refetchTimer.current); refetchTimer.current = null } }
  }, [deviceId, isToday, loadTrack])

  // Refreshes by itself: at once when the app comes back to the front (an
  // installed PWA, a tab shown again, the network back) and every half minute
  // while visible, in case the websocket died while it was in the background.
  useLiveRefresh(() => { void loadDevices(); if (isToday) loadTrack() }, FALLBACK_POLL_MS, !!deviceId, false)

  // The day's trips (5.7.21): shown all together or one at a time, and saved one by one or as one.
  const trips = useMemo(() => splitTrips(points), [points])
  useEffect(() => { setTripSel(null) }, [deviceId, day])
  const trip = tripSel != null ? trips.find(x => x.n === tripSel) ?? null : null
  const shown = trip ? trip.points : points
  const shownRange = useMemo(() => (trip ? { from: trip.from, to: trip.to } : range), [trip, range])
  // A live day is matched again a quarter of a minute after its last new point, only its last stretch asked for.
  const { lines, status: matchStatus } = useMatchedTrack(shown, snap, isToday && !trip ? 15_000 : 0)
  const lastDrawn = lines.length ? lines[lines.length - 1].positions[lines[lines.length - 1].positions.length - 1] : null
  const fresh = device ? isFresh(device) : false
  // Where the phone recorded nothing (5.7.7): listed, so a hole is seen as one rather than as a wrong line.
  const gaps = useMemo(() => gapsOf(shown), [shown])
  const live = isToday && device?.last_position ? [device.last_position.lat, device.last_position.lng] as [number, number] : null
  const center: [number, number] = live ?? (points[0] ? [points[0].lat, points[0].lng] : [40.4, -3.7])
  const heading = headingOf(points, live, device?.last_position?.speed)

  if (devices && devices.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-primary)' }}>
        <div className="max-w-md text-center space-y-3">
          <Radio className="w-10 h-10 mx-auto" style={{ color: 'var(--text-faint)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('tracking.title')}</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('tracking.emptyPage')}</p>
          <Link to="/settings?tab=tracking" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
            <Settings className="w-4 h-4" /> {t('tracking.setUp')}
          </Link>
        </div>
      </div>
    )
  }

  const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="flex flex-col md:flex-row" style={{ height: 'calc(100dvh - var(--bottom-nav-h, 0px))', background: 'var(--bg-primary)' }}>
      <LiveMapStyles />
      {/* On a phone the map takes most of the screen and the panel scrolls under it; it can be folded away. */}
      <aside className={`${mapOnly ? 'hidden md:block' : ''} flex-1 min-h-0 md:flex-none md:w-80 md:max-h-full overflow-y-auto p-4 space-y-4 order-2 md:order-1`}
        style={{ borderRight: '1px solid var(--border-secondary)' }}>
        <div className="flex items-center gap-2">
          <Link to="/dashboard" aria-label={t('common.back')} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}><ArrowLeft className="w-4 h-4" /></Link>
          <h1 className="text-base font-bold flex-1" style={{ color: 'var(--text-primary)' }}>{t('tracking.title')}</h1>
          <Link to="/settings?tab=tracking" aria-label={t('tracking.devices')} title={t('tracking.devices')} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}><Settings className="w-4 h-4" /></Link>
        </div>

        {devices && devices.length > 1 && (
          <select value={deviceId ?? ''} onChange={e => setParams({ device: e.target.value })} aria-label={t('tracking.devices')}
            className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}

        {device && (
          <div className="rounded-xl p-3 space-y-1.5" style={{ border: '1px solid var(--border-primary)' }} data-testid="device-card">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{device.name}</span>
              <BatteryBadge level={device.battery_level} state={device.battery_state} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DeviceStatusChip device={device} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ago(device.last_position?.recorded_at)}</span>
            </div>
            {device.last_position?.speed != null && (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{Math.round(device.last_position.speed * 3.6)} km/h</div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input type="date" value={day} max={localToday()} onChange={e => e.target.value && setDay(e.target.value)} aria-label={t('tracking.day')}
              className="flex-1 px-3 py-1.5 rounded-xl text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }} />
            <button type="button" onClick={loadTrack} aria-label={t('tracking.refresh')} title={t('tracking.refresh')} className="p-2 rounded-lg" style={{ color: 'var(--text-muted)' }}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {days.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="day-list">
              {days.slice(0, 14).map(d => (
                <button key={d.day} type="button" onClick={() => setDay(d.day)} aria-pressed={d.day === day}
                  className="px-2 py-1 rounded-lg text-xs" style={{
                    border: d.day === day ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
                    background: d.day === day ? 'var(--bg-tertiary)' : 'none', color: 'var(--text-primary)',
                  }}>
                  {dayLabel(d.day)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl p-3 space-y-1" style={{ background: 'var(--bg-tertiary)' }} data-testid="day-stats">
          {trip ? (
            <>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('tracking.trips.one', { n: trip.n })} · {formatDistance(trip.distanceM)} · {formatDuration(trip.durationS)}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('tracking.pointsCount', { n: trip.points.length })} · {clock(trip.from)}–{clock(trip.to)}
              </div>
            </>
          ) : total > 0 && stats ? (
            <>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatDistance(stats.distance_m)} · {formatDuration(stats.duration_s)}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('tracking.pointsCount', { n: total })}
                {stats.start && stats.end ? ` · ${new Date(stats.start).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}–${new Date(stats.end).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
            </>
          ) : (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tracking.noPointsDay')}</div>
          )}
        </div>

        {trips.length > 1 && (
          <div className="space-y-1" data-testid="day-trips">
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{t('tracking.trips.title', { count: trips.length })}</div>
            <button type="button" onClick={() => setTripSel(null)} aria-pressed={tripSel == null} data-trip="all"
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs" style={tripStyle(tripSel == null)}>
              {t('tracking.trips.all')}
            </button>
            {trips.map(x => (
              <button key={x.n} type="button" onClick={() => setTripSel(x.n)} aria-pressed={tripSel === x.n} data-trip={x.n}
                className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg text-xs" style={tripStyle(tripSel === x.n)}>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white flex-shrink-0" style={{ background: motionColor(x.motion) }}>{x.n}</span>
                <span className="flex-1">{clock(x.from)}–{clock(x.to)}</span>
                <span style={{ color: 'var(--text-muted)' }}>{formatDistance(x.distanceM)}</span>
              </button>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={hideImprecise} onChange={e => setHideImprecise(e.target.checked)} />
          {t('tracking.hideImprecise', { m: GOOD_ACCURACY_M })}
          {hideImprecise && hidden > 0 && (
            <span data-testid="hidden-count" className="ml-auto text-[11px]" style={{ color: '#b45309' }}>{t('tracking.hiddenCount', { n: hidden })}</span>
          )}
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />
          {t('tracking.snap')}
          {snap && total > 1 && <MatchBadge status={matchStatus} />}
        </label>
        <GapNotice gaps={gaps} />
        {device && <UploadLog deviceId={device.id} refreshKey={total} />}
        {isToday && (
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
            {t('tracking.follow')}
          </label>
        )}

        <div className="flex flex-wrap gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {(['driving', 'cycling', 'walking', 'running', 'stationary'] as const).map(m => (
            <span key={m} className="inline-flex items-center gap-1"><span style={{ width: 10, height: 3, borderRadius: 2, background: MOTION_COLORS[m] }} />{t(`tracking.motion.${m}`)}</span>
          ))}
        </div>

        {device && (
          <div className="grid grid-cols-3 gap-1.5">
            <a href={trackingApi.gpxUrl(device.id, { ...shownRange, max_accuracy: accuracy })} download
              className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl text-[11px]"
              style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)', pointerEvents: total ? 'auto' : 'none', opacity: total ? 1 : 0.4 }}>
              <Download className="w-4 h-4" /> GPX
            </a>
            <button type="button" disabled={total < 2} onClick={() => setPanel(panel === 'save' ? null : 'save')}
              className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl text-[11px]"
              style={{ border: panel === 'save' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', color: 'var(--text-secondary)', opacity: total < 2 ? 0.4 : 1 }}>
              <Save className="w-4 h-4" /> {t('tracking.saveRoute')}
            </button>
            <button type="button" onClick={() => setPanel(panel === 'share' ? null : 'share')}
              className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl text-[11px]"
              style={{ border: panel === 'share' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', color: device.share ? '#16a34a' : 'var(--text-secondary)' }}>
              <Share2 className="w-4 h-4" /> {device.share ? t('tracking.sharing') : t('tracking.share')}
            </button>
          </div>
        )}

        {device && panel === 'share' && <SharePanel device={device} onChange={next => setDevices(list => list?.map(d => (d.id === next.id ? next : d)) ?? list)} onClose={() => setPanel(null)} />}
        {device && panel === 'save' && (
          <SaveRoutePanel device={device} day={day} range={shownRange} maxAccuracy={accuracy} onClose={() => setPanel(null)}
            trip={trip} trips={trip ? [] : trips}
            line={snap && matchStatus !== 'failed' && lines.some(l => l.matched) ? joinedLine(lines) : undefined}
            onSaved={where => { toast.success(t(where === 'planner' ? 'tracking.savedPlanner' : 'tracking.saved')); setPanel(null) }} />
        )}
      </aside>

      <main className={`${mapOnly ? 'flex-1' : 'flex-shrink-0'} md:flex-1 relative order-1 md:order-2`}
        style={mapOnly ? undefined : { height: 'max(58dvh, 320px)' }} data-testid="tracking-map">
        {devices && (
          <MapContainer center={center} zoom={13} style={{ position: 'absolute', inset: 0 }}>
            <TileLayer url={tileUrl} attribution="&copy; OpenStreetMap" />
            {/* The live position joined to the end of the line, so the two read as one track: only when the line ends at the day's last fix. */}
            <LiveTrail lines={lines} snap={snap} live={joinsLive(trip, trips) ? live : null} />
            {lastDrawn && !live && <CircleMarker center={lastDrawn} radius={7} pathOptions={{ color: '#111827', fillColor: '#ffffff', fillOpacity: 1, weight: 3 }} />}
            {live && device && (
              <LiveMarker position={live} name={device.name} fresh={fresh} accuracy={device.last_position?.accuracy} heading={heading} onClick={() => setFollow(true)} />
            )}
            <FitTo points={shown} live={live} follow={follow} />
            {/* Each trip's start numbered, so trips on top of each other can be told apart and picked from the list. */}
            {!trip && trips.length > 1 && trips.map(x => (
              <Marker key={x.n} position={[x.points[0].lat, x.points[0].lng]} icon={tripIcon(x.n, motionColor(x.motion))}
                eventHandlers={{ click: () => setTripSel(x.n) }} />
            ))}
            <FollowLive position={live} follow={follow && !!live} onUserMove={() => setFollow(false)} minZoom={14} />
            <AutoResize />
          </MapContainer>
        )}
        <div className="absolute right-3 bottom-6 flex flex-col gap-2" style={{ zIndex: 1000 }}>
          <button type="button" onClick={() => setMapOnly(v => !v)} className="md:hidden w-11 h-11 rounded-full flex items-center justify-center shadow-lg"
            aria-label={mapOnly ? t('tracking.live.showPanel') : t('tracking.live.mapOnly')} title={mapOnly ? t('tracking.live.showPanel') : t('tracking.live.mapOnly')}
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            {mapOnly ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
          {live && (
            <button type="button" data-testid="tracking-recenter" onClick={() => setFollow(true)} aria-pressed={follow}
              aria-label={t('tracking.live.recenter')} title={t('tracking.live.recenter')}
              className="w-11 h-11 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: 'var(--bg-card)', color: follow ? '#2563eb' : 'var(--text-primary)' }}>
              <Crosshair className="w-5 h-5" />
            </button>
          )}
        </div>
        {mapOnly && device && (
          <button type="button" onClick={() => setMapOnly(false)} className="md:hidden absolute left-3 right-16 bottom-6 rounded-2xl px-3 py-2 flex items-center gap-2 shadow-lg text-left"
            style={{ zIndex: 1000, background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold truncate">{device.name}</span>
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                {ago(device.last_position?.recorded_at)}{stats && total > 0 ? ` · ${formatDistance(stats.distance_m)}` : ''}
              </span>
            </span>
            <BatteryBadge level={device.battery_level} state={device.battery_state} />
            <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </main>
    </div>
  )
}

function SharePanel({ device, onChange, onClose }: { device: TrackingDevice; onChange: (d: TrackingDevice) => void; onClose: () => void }) {
  const { t, locale } = useTranslation()
  const [hours, setHours] = useState(24)
  const [label, setLabel] = useState(device.share?.label ?? '')
  const start = async () => onChange((await trackingApi.share(device.id, hours, label)).device)
  const stop = async () => onChange((await trackingApi.stopShare(device.id)).device)
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--border-primary)' }} data-testid="share-panel">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{t('tracking.shareTitle')}</span>
        <button type="button" onClick={onClose} aria-label={t('common.close')} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tracking.shareHint')}</p>
      {device.share && (
        <>
          <CopyField value={shareUrl(window.location.origin, device.share.token)} label={t('tracking.copyLink')} testId="share-link" />
          {device.share.expires_at && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tracking.shareUntil', { when: new Date(device.share.expires_at).toLocaleString(locale, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</div>}
        </>
      )}
      <input value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder={t('tracking.shareLabel')} aria-label={t('tracking.shareLabel')}
        className="w-full px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }} />
      <div className="flex gap-2">
        <select value={hours} onChange={e => setHours(Number(e.target.value))} aria-label={t('tracking.shareFor')}
          className="flex-1 px-2 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}>
          {[2, 8, 24, 72, 168, 720].map(h => <option key={h} value={h}>{h < 48 ? t('tracking.hours', { n: h }) : t('tracking.days', { n: Math.round(h / 24) })}</option>)}
        </select>
        <button type="button" onClick={() => void start()} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
          {device.share ? t('tracking.extend') : t('tracking.createLink')}
        </button>
      </div>
      {device.share && (
        <button type="button" onClick={() => void stop()} className="w-full px-3 py-1.5 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>
          {t('tracking.stopSharing')}
        </button>
      )}
    </div>
  )
}

interface TripOption { id: number; title: string; start_date?: string | null; end_date?: string | null }
interface DayOption { id: number; day_number: number; date: string | null; title?: string | null }

function SaveRoutePanel({ device, day, range, maxAccuracy, line, onClose, onSaved, trip, trips }: {
  device: TrackingDevice; day: string; range: { from: string; to: string }; maxAccuracy?: number
  /** The trip shown on its own, when one is: saved under its own number. */
  trip?: DayTrip | null
  /** The day's trips when all are shown: they can be saved one route each instead of one for the day. */
  trips?: DayTrip[]
  /** The day as drawn along the ways, when it was; saved instead of the raw fixes unless turned off. */
  line?: [number, number][]
  onClose: () => void; onSaved: (where: 'planner' | 'trip') => void
}) {
  const [useLine, setUseLine] = useState(true)
  /** Where it goes (5.7.21): the route planner, a person's own routes, by default; or a trip, as a GPX of it. */
  const [dest, setDest] = useState<'planner' | 'trip'>('planner')
  const [separate, setSeparate] = useState(false)
  const { t } = useTranslation()
  const toast = useToast()
  const [tripOptions, setTripOptions] = useState<TripOption[]>([])
  const [tripId, setTripId] = useState<number | null>(null)
  const [tripDays, setTripDays] = useState<DayOption[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [name, setName] = useState(`${device.name} · ${day}${trip ? ` · ${trip.n}` : ''}`)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    tripsApi.list().then((r: { trips: TripOption[] }) => {
      const list = r.trips ?? []
      setTripOptions(list)
      // The trip whose dates hold this day, if one does.
      const match = list.find(tr => tr.start_date && tr.end_date && tr.start_date <= day && day <= tr.end_date)
      setTripId(match?.id ?? list[0]?.id ?? null)
    }).catch(() => setTripOptions([]))
  }, [day])

  useEffect(() => {
    if (!tripId) { setTripDays([]); return }
    daysApi.list(tripId).then((r: { days: DayOption[] }) => {
      const list = r.days ?? []
      setTripDays(list)
      setDayId(list.find(d => d.date === day)?.id ?? null)
    }).catch(() => setTripDays([]))
  }, [tripId, day])

  const many = !!trips && trips.length > 1 && separate
  const save = async () => {
    if (dest === 'trip' && !tripId) return
    setSaving(true)
    try {
      // One route for each trip, from its own fixes; or one for what is shown, along the ways when it was drawn so.
      const jobs = many
        ? trips!.map(x => ({ from: x.from, to: x.to, name: `${name} · ${x.n}`, line: undefined }))
        : [{ ...range, name, line: line && useLine ? line : undefined }]
      for (const job of jobs) {
        if (dest === 'planner') await trackingApi.saveToPlanner(device.id, { ...job, max_accuracy: maxAccuracy })
        else await trackingApi.saveRoute(device.id, { ...job, trip_id: tripId!, day_id: dayId, max_accuracy: maxAccuracy })
      }
      onSaved(dest)
    } catch { toast.error(t('tracking.error')) } finally { setSaving(false) }
  }

  const field = { background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--border-primary)' }} data-testid="save-panel">
      <div className="flex items-center gap-2">
        <Save className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{t('tracking.saveRouteTitle')}</span>
        <button type="button" onClick={onClose} aria-label={t('common.close')} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
      </div>
      <div role="radiogroup" aria-label={t('tracking.saveWhere')} className="grid grid-cols-2 gap-1" data-testid="save-dest">
        {(['planner', 'trip'] as const).map(d => (
          <button key={d} type="button" role="radio" aria-checked={dest === d} data-value={d} onClick={() => setDest(d)}
            className="px-2 py-1.5 rounded-lg text-xs font-medium" style={{ ...field, border: dest === d ? '1.5px solid var(--text-primary)' : field.border }}>
            {t(d === 'planner' ? 'tracking.toPlanner' : 'tracking.toTrip')}
          </button>
        ))}
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t(dest === 'planner' ? 'tracking.savePlannerHint' : 'tracking.saveRouteHint')}</p>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={120} aria-label={t('tracking.routeName')} className="w-full px-3 py-1.5 rounded-lg text-sm" style={field} />
      {trips && trips.length > 1 && (
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={separate} onChange={e => setSeparate(e.target.checked)} data-testid="save-separate" />
          {t('tracking.trips.saveEach', { count: trips.length })}
        </label>
      )}
      {dest === 'trip' && tripOptions.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{t('tracking.noTrips')}</p>
      ) : (
        <>
          {dest === 'trip' && (<>
          <select value={tripId ?? ''} onChange={e => setTripId(Number(e.target.value))} aria-label={t('tracking.trip')} className="w-full px-2 py-1.5 rounded-lg text-sm" style={field}>
            {tripOptions.map(tr => <option key={tr.id} value={tr.id}>{tr.title}</option>)}
          </select>
          <select value={dayId ?? ''} onChange={e => setDayId(e.target.value ? Number(e.target.value) : null)} aria-label={t('tracking.tripDay')} className="w-full px-2 py-1.5 rounded-lg text-sm" style={field}>
            <option value="">{t('tracking.noDay')}</option>
            {tripDays.map(d => <option key={d.id} value={d.id}>{d.title || t('tracking.dayN', { n: d.day_number })}{d.date ? ` · ${d.date}` : ''}</option>)}
          </select>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('tracking.tripListHint')}</p>
          </>)}
          {line && !many && (
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={useLine} onChange={e => setUseLine(e.target.checked)} />
              {t('tracking.saveSnapped')}
            </label>
          )}
          <button type="button" onClick={() => void save()} disabled={saving || (dest === 'trip' && !tripId)} data-testid="save-go" className="w-full px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'white', opacity: saving ? 0.6 : 1 }}>
            {saving ? t('tracking.saving') : t('tracking.saveRoute')}
          </button>
        </>
      )}
    </div>
  )
}

/** How the drawing along the ways is going: matching, done, partly, or not at all (straight lines shown). */
interface IngestRow {
  at: string; http_status: number; received: number; stored: number; duplicates: number; invalid: number
  oldest_ts: string | null; newest_ts: string | null; client: string | null
}

/**
 * The phone's latest uploads as the server saw them (5.7.9): when each came,
 * how many fixes it carried and what became of them. A hole with no upload
 * covering it is the phone not recording or not sending; fixes received but
 * not stored (invalid) would be the server's to fix.
 */
function UploadLog({ deviceId, refreshKey }: { deviceId: number; refreshKey: number }) {
  const { t, locale } = useTranslation()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<IngestRow[] | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    trackingApi.ingests(deviceId, 40)
      .then((r: { ingests: IngestRow[] }) => { if (!cancelled) setRows(r.ingests) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [open, deviceId, refreshKey])
  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '–')
  const dm = (iso: string) => new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className="text-xs" data-testid="upload-log">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="font-medium" style={{ color: 'var(--text-secondary)' }}>
        {open ? '▾' : '▸'} {t('tracking.uploads.title')}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          <p style={{ color: 'var(--text-muted)' }}>{t('tracking.uploads.hint')}</p>
          {rows === null ? <p style={{ color: 'var(--text-muted)' }}>…</p> : rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('tracking.uploads.none')}</p>
          ) : (
            <ul className="space-y-0.5 max-h-60 overflow-y-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((r, i) => {
                const bad = r.http_status !== 200 || r.invalid > 0
                return (
                  <li key={i} data-testid="upload-row" style={{ color: bad ? '#b45309' : 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{dm(r.at)}</span>{' · '}
                    {r.http_status !== 200
                      ? t(`tracking.uploads.status${r.http_status === 429 ? '429' : r.http_status === 413 ? '413' : 'Other'}`, { code: r.http_status })
                      : t('tracking.uploads.row', { received: r.received, stored: r.stored, duplicates: r.duplicates, invalid: r.invalid, from: hm(r.oldest_ts), to: hm(r.newest_ts) })}
                    {r.client && <span style={{ color: 'var(--text-faint)' }}> · {r.client.split(' ')[0]}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** The holes in the day's recording, with what usually causes them on Android. */
function GapNotice({ gaps }: { gaps: TrackGap[] }) {
  const { t, locale } = useTranslation()
  if (!gaps.length) return null
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return (
    <div data-testid="track-gaps" className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)', color: 'var(--text-secondary)' }}>
      <div className="font-semibold" style={{ color: '#b45309' }}>{t('tracking.gaps.title', { count: gaps.length })}</div>
      <ul className="space-y-0.5">
        {gaps.slice(0, 6).map(g => (
          <li key={g.from.ts}>
            {t('tracking.gaps.item', { from: time(g.from.ts), to: time(g.to.ts), km: formatDistance(g.distanceM) })}
          </li>
        ))}
      </ul>
      <p style={{ color: 'var(--text-muted)' }}>{t('tracking.gaps.hint')}</p>
    </div>
  )
}

function MatchBadge({ status }: { status: MatchStatus }) {
  const { t } = useTranslation()
  if (status === 'off') return null
  const look: Record<Exclude<MatchStatus, 'off'>, { color: string; key: string }> = {
    matching: { color: 'var(--text-muted)', key: 'tracking.snapMatching' },
    matched: { color: '#16a34a', key: 'tracking.snapDone' },
    partial: { color: '#b45309', key: 'tracking.snapPartial' },
    failed: { color: '#dc2626', key: 'tracking.snapFailed' },
  }
  const l = look[status]
  return <span data-testid="match-status" data-status={status} className="ml-auto text-[11px]" style={{ color: l.color }}>{t(l.key)}</span>
}

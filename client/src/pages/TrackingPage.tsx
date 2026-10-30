/**
 * Tracking en vivo (5.7.1) — the owner's map. A phone running Overland posts
 * its points to Trek; this page shows where it is now (pushed over the
 * websocket, no polling), the track of any day coloured by how it was moving,
 * and turns a day into something lasting: a GPX download, a route of a trip
 * (so it shows on the trip, the journey and the Studio), or a public link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ArrowLeft, Download, Link2, Radio, RefreshCw, Save, Settings, Share2, X } from 'lucide-react'
import { daysApi, trackingApi, tripsApi } from '../api/client'
import { addListener, removeListener } from '../api/websocket'
import { useTranslation } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import { useToast } from '../components/shared/Toast'
import { CopyField } from '../components/Tracking/CopyField'
import { joinedLine, lineStyle, useMatchedTrack, type MatchStatus } from '../components/Tracking/useMatchedTrack'
import { gapsOf, type TrackGap } from '../components/Tracking/mapMatch'
import { BatteryBadge, DeviceStatusChip, useAgo } from '../components/Tracking/DeviceStatus'
import {
  MOTION_COLORS, formatDistance, formatDuration, localDayRange, localToday, shareUrl, utcOffsetMinutes,
  type TrackPoint, type TrackStats, type TrackingDevice,
} from '../components/Tracking/trackingModel'

const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
/** Points worse than this are left out when "Hide imprecise points" is on. */
const GOOD_ACCURACY_M = 100

const liveIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>',
})

function FitTo({ points, live, follow }: { points: TrackPoint[]; live: [number, number] | null; follow: boolean }) {
  const map = useMap()
  const fittedFor = useRef<string>('')
  useEffect(() => {
    // Fitted once per day shown (its first point), not on every new point of today.
    const key = points.length ? points[0].ts : live ? 'live' : ''
    if (follow && live) { map.setView(live, Math.max(map.getZoom(), 14)); return }
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

  // A live day is matched again a quarter of a minute after its last new point, only its last stretch asked for.
  const { lines, status: matchStatus } = useMatchedTrack(points, snap, isToday ? 15_000 : 0)
  const lastDrawn = lines.length ? lines[lines.length - 1].positions[lines[lines.length - 1].positions.length - 1] : null
  // Where the phone recorded nothing (5.7.7): listed, so a hole is seen as one rather than as a wrong line.
  const gaps = useMemo(() => gapsOf(points), [points])
  const live = isToday && device?.last_position ? [device.last_position.lat, device.last_position.lng] as [number, number] : null
  const center: [number, number] = live ?? (points[0] ? [points[0].lat, points[0].lng] : [40.4, -3.7])

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
    <div className="flex flex-col md:flex-row" style={{ height: '100dvh', background: 'var(--bg-primary)' }}>
      <aside className="md:w-80 flex-shrink-0 overflow-y-auto p-4 space-y-4 order-2 md:order-1"
        style={{ borderRight: '1px solid var(--border-secondary)', maxHeight: '100dvh' }}>
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
          {total > 0 && stats ? (
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
            <a href={trackingApi.gpxUrl(device.id, { ...range, max_accuracy: accuracy })} download
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
          <SaveRoutePanel device={device} day={day} range={range} maxAccuracy={accuracy} onClose={() => setPanel(null)}
            line={snap && matchStatus !== 'failed' && lines.some(l => l.matched) ? joinedLine(lines) : undefined}
            onSaved={() => { toast.success(t('tracking.saved')); setPanel(null) }} />
        )}
      </aside>

      <main className="flex-1 relative order-1 md:order-2" style={{ minHeight: 320 }}>
        {devices && (
          <MapContainer center={center} zoom={13} style={{ position: 'absolute', inset: 0 }}>
            <TileLayer url={tileUrl} attribution="&copy; OpenStreetMap" />
            {lines.map((s, i) => (
              <Polyline key={i} positions={s.positions} pathOptions={{ ...lineStyle(s, snap), lineCap: s.inferred ? 'round' : undefined }} />
            ))}
            {/* The live dot joined to the end of the line, so the two read as one track. */}
            {live && lastDrawn && (lastDrawn[0] !== live[0] || lastDrawn[1] !== live[1]) && (
              <Polyline positions={[lastDrawn, live]} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.6, dashArray: '4 6' }} />
            )}
            {lastDrawn && !live && <CircleMarker center={lastDrawn} radius={6} pathOptions={{ color: '#111827', fillColor: '#ffffff', fillOpacity: 1, weight: 2 }} />}
            {live && <Marker position={live} icon={liveIcon} />}
            <FitTo points={points} live={live} follow={follow} />
          </MapContainer>
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

function SaveRoutePanel({ device, day, range, maxAccuracy, line, onClose, onSaved }: {
  device: TrackingDevice; day: string; range: { from: string; to: string }; maxAccuracy?: number
  /** The day as drawn along the ways, when it was; saved instead of the raw fixes unless turned off. */
  line?: [number, number][]
  onClose: () => void; onSaved: () => void
}) {
  const [useLine, setUseLine] = useState(true)
  const { t } = useTranslation()
  const toast = useToast()
  const [trips, setTrips] = useState<TripOption[]>([])
  const [tripId, setTripId] = useState<number | null>(null)
  const [tripDays, setTripDays] = useState<DayOption[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [name, setName] = useState(`${device.name} · ${day}`)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    tripsApi.list().then((r: { trips: TripOption[] }) => {
      const list = r.trips ?? []
      setTrips(list)
      // The trip whose dates hold this day, if one does.
      const match = list.find(tr => tr.start_date && tr.end_date && tr.start_date <= day && day <= tr.end_date)
      setTripId(match?.id ?? list[0]?.id ?? null)
    }).catch(() => setTrips([]))
  }, [day])

  useEffect(() => {
    if (!tripId) { setTripDays([]); return }
    daysApi.list(tripId).then((r: { days: DayOption[] }) => {
      const list = r.days ?? []
      setTripDays(list)
      setDayId(list.find(d => d.date === day)?.id ?? null)
    }).catch(() => setTripDays([]))
  }, [tripId, day])

  const save = async () => {
    if (!tripId) return
    setSaving(true)
    try {
      await trackingApi.saveRoute(device.id, { ...range, trip_id: tripId, day_id: dayId, name, max_accuracy: maxAccuracy, line: line && useLine ? line : undefined })
      onSaved()
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
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('tracking.saveRouteHint')}</p>
      {trips.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{t('tracking.noTrips')}</p>
      ) : (
        <>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} aria-label={t('tracking.routeName')} className="w-full px-3 py-1.5 rounded-lg text-sm" style={field} />
          <select value={tripId ?? ''} onChange={e => setTripId(Number(e.target.value))} aria-label={t('tracking.trip')} className="w-full px-2 py-1.5 rounded-lg text-sm" style={field}>
            {trips.map(tr => <option key={tr.id} value={tr.id}>{tr.title}</option>)}
          </select>
          <select value={dayId ?? ''} onChange={e => setDayId(e.target.value ? Number(e.target.value) : null)} aria-label={t('tracking.tripDay')} className="w-full px-2 py-1.5 rounded-lg text-sm" style={field}>
            <option value="">{t('tracking.noDay')}</option>
            {tripDays.map(d => <option key={d.id} value={d.id}>{d.title || t('tracking.dayN', { n: d.day_number })}{d.date ? ` · ${d.date}` : ''}</option>)}
          </select>
          {line && (
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={useLine} onChange={e => setUseLine(e.target.checked)} />
              {t('tracking.saveSnapped')}
            </label>
          )}
          <button type="button" onClick={() => void save()} disabled={saving || !tripId} className="w-full px-3 py-1.5 rounded-lg text-sm font-medium"
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

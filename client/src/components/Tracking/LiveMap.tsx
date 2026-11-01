/**
 * Tracking en vivo (5.7.13) — the pieces both live maps share, so the
 * position reads like a messaging app's "share live location": a round
 * avatar with a pulsing halo while the phone is live, the GPS accuracy as a
 * soft circle, an arrow for where it is heading, a marker that glides to
 * each new fix instead of jumping, a map that follows the phone until the
 * viewer moves it (then a "recentre" button brings it back), and a page that
 * refreshes itself — also when an installed PWA comes back to the front.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { MatchedLine } from './mapMatch'
import { lineStyle } from './useMatchedTrack'
import type { TrackPoint } from './trackingModel'

export const LIVE_COLOR = '#2563eb'
const STALE_COLOR = '#6b7280'

/** The keyframes the live marker uses; rendered once by any live map. */
export function LiveMapStyles() {
  return (
    <style>{`
@keyframes trek-live-pulse { 0% { transform: scale(0.6); opacity: 0.55 } 80%, 100% { transform: scale(2.4); opacity: 0 } }
@keyframes trek-live-blink { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
.trek-live-marker { position: relative; width: 44px; height: 44px; }
.trek-live-marker .halo { position: absolute; inset: 0; border-radius: 50%; animation: trek-live-pulse 2s ease-out infinite; }
.trek-live-marker .avatar { position: absolute; inset: 4px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center; color: #fff; font: 700 16px/1 system-ui, sans-serif; }
.trek-live-marker .heading { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.trek-live-marker .heading::before { content: ''; position: absolute; left: -7px; top: -33px; border-left: 7px solid transparent;
  border-right: 7px solid transparent; border-bottom: 10px solid var(--trek-live-c); filter: drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff); }
.trek-live-dot { animation: trek-live-blink 1.6s ease-in-out infinite; }
.leaflet-container .trek-live-start { background: none; border: none; }
`}</style>
  )
}

function initialOf(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  if (!s) return '•'
  const ch = Array.from(s)[0]
  return ch.toUpperCase().replace(/[<>&"']/g, '')
}

/** Compass bearing in degrees from one fix to the next. */
export function bearing(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r)
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}

/** Metres between two fixes (haversine), enough to tell moving from jitter. */
function metres(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r
  const dLng = (b[1] - a[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * Where the phone is heading, from the last fixes of the track: null while it
 * is still (or the fixes are too close to tell a direction from GPS noise).
 */
export function headingOf(points: TrackPoint[], live: [number, number] | null, speed: number | null | undefined): number | null {
  if (!live || (speed != null && speed < 0.7)) return null
  for (let i = points.length - 1; i >= 0 && i >= points.length - 8; i--) {
    const p: [number, number] = [points[i].lat, points[i].lng]
    if (metres(p, live) >= 15) return bearing(p, live)
  }
  return null
}

/** A position that glides to each new value instead of jumping. */
export function useGlide(target: [number, number] | null, ms = 900): [number, number] | null {
  const [pos, setPos] = useState(target)
  const current = useRef(target)
  useEffect(() => {
    const from = current.current
    if (!target || !from || (from[0] === target[0] && from[1] === target[1])) {
      current.current = target
      setPos(target)
      return
    }
    // A jump of several km (a train, a gap) is not animated across the map.
    if (metres(from, target) > 5000 || typeof window.requestAnimationFrame !== 'function') {
      current.current = target
      setPos(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      const e = 1 - (1 - k) ** 3
      const next: [number, number] = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e]
      current.current = next
      setPos(next)
      if (k < 1) raf = window.requestAnimationFrame(step)
    }
    raf = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(raf)
  }, [target?.[0], target?.[1], ms]) // eslint-disable-line react-hooks/exhaustive-deps
  return pos
}

/**
 * The phone on the map: an avatar with its initial, a pulsing halo while it
 * is live, a soft circle the size of the GPS accuracy and an arrow for its
 * heading when it is moving.
 */
export function LiveMarker({ position, name, fresh, accuracy, heading, onClick }: {
  position: [number, number]; name?: string | null; fresh: boolean; accuracy?: number | null; heading?: number | null
  onClick?: () => void
}) {
  const color = fresh ? LIVE_COLOR : STALE_COLOR
  const glided = useGlide(position) ?? position
  const icon = useMemo(() => L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div class="trek-live-marker" style="--trek-live-c:${color}">`
      + (fresh ? `<div class="halo" style="background:${color}"></div>` : '')
      + (heading != null ? `<div class="heading" style="transform:rotate(${Math.round(heading)}deg)"></div>` : '')
      + `<div class="avatar" style="background:${color}">${initialOf(name)}</div></div>`,
  }), [color, fresh, heading, name])
  return (
    <>
      {accuracy != null && accuracy > 10 && accuracy < 3000 && (
        <Circle center={glided} radius={accuracy} pathOptions={{ color, weight: 1, opacity: 0.35, fillColor: color, fillOpacity: 0.12 }} interactive={false} />
      )}
      <Marker position={glided} icon={icon} zIndexOffset={1000} eventHandlers={onClick ? { click: onClick } : undefined} />
    </>
  )
}

const startIcon = L.divIcon({
  className: 'trek-live-start',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #111827;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>',
})

/**
 * The track as drawn lines, each over a white casing so it stands out on any
 * map; a dashed link from its end to the live position; a ring where it began.
 */
export function LiveTrail({ lines, snap, live, showStart = true }: {
  lines: MatchedLine[]; snap: boolean; live: [number, number] | null; showStart?: boolean
}) {
  const first = lines.find(l => l.positions.length)?.positions[0] ?? null
  const lastLine = lines[lines.length - 1]
  const lastDrawn = lastLine?.positions.length ? lastLine.positions[lastLine.positions.length - 1] : null
  return (
    <>
      {lines.map((s, i) => !s.inferred && s.positions.length > 1 && (
        <Polyline key={`c${i}`} positions={s.positions} interactive={false}
          pathOptions={{ color: '#ffffff', weight: (s.matched ? 5 : 4) + 4, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }} />
      ))}
      {lines.map((s, i) => (
        <Polyline key={i} positions={s.positions}
          pathOptions={{ ...lineStyle(s, snap), lineCap: 'round', lineJoin: 'round' }} />
      ))}
      {live && lastDrawn && (lastDrawn[0] !== live[0] || lastDrawn[1] !== live[1]) && (
        <Polyline positions={[lastDrawn, live]} interactive={false} pathOptions={{ color: LIVE_COLOR, weight: 4, opacity: 0.7, dashArray: '2 8', lineCap: 'round' }} />
      )}
      {showStart && first && lines.some(l => l.positions.length > 1) && <Marker position={first} icon={startIcon} interactive={false} />}
    </>
  )
}

/**
 * Keeps the live position in view while `follow` is on, and turns following
 * off as soon as the viewer drags or zooms the map with a gesture.
 */
export function FollowLive({ position, follow, onUserMove, minZoom = 15 }: {
  position: [number, number] | null; follow: boolean; onUserMove: () => void; minZoom?: number
}) {
  const map = useMap()
  const wasFollowing = useRef(false)
  useMapEvents({
    dragstart: () => onUserMove(),
  })
  useEffect(() => {
    if (!follow || !position) { wasFollowing.current = follow; return }
    if (!wasFollowing.current) map.setView(position, Math.max(map.getZoom(), minZoom), { animate: true })
    else map.panTo(position, { animate: true, duration: 0.8 })
    wasFollowing.current = true
  }, [follow, position?.[0], position?.[1], map, minZoom]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** Leaflet only measures its box once: tell it whenever the box changes (panels, rotation). */
export function AutoResize() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

/**
 * Runs `fn` now, every `intervalMs` while the page is visible, and at once
 * whenever it comes back: a tab shown again, an installed PWA brought to the
 * front, the network back, a page restored from the back/forward cache.
 * Paused while hidden, so a phone in a pocket does not poll.
 */
export function useLiveRefresh(fn: () => void, intervalMs: number, enabled = true, runNow = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    let timer: number | null = null
    let last = 0
    const run = () => { last = Date.now(); ref.current() }
    const stop = () => { if (timer != null) { window.clearInterval(timer); timer = null } }
    const start = () => { stop(); timer = window.setInterval(run, intervalMs) }
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const wake = () => {
      if (!visible()) { stop(); return }
      // focus and visibilitychange often come together: one fetch is enough.
      if (Date.now() - last > 1500) run()
      start()
    }
    if (runNow) run()
    else last = Date.now()
    if (visible()) start()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    window.addEventListener('pageshow', wake)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [enabled, intervalMs, runNow])
}

/** Re-renders every `ms`, for "updated 12 s ago" labels that keep counting. */
export function useTick(ms = 5000) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => set(n => n + 1), ms)
    return () => window.clearInterval(id)
  }, [ms])
}

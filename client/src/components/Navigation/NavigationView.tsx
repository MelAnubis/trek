import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { Navigation, Radio, Square, Crosshair, Mountain, ChevronDown, ChevronUp, Sun, Camera, MapPin } from 'lucide-react'
import { useNavigation } from '../../hooks/useNavigation'
import type { TrackPoint } from '../../hooks/useNavigation'
import NavigationMap from './NavigationMap'
import NavigationHUD from './NavigationHUD'
import TurnInstruction from './TurnInstruction'
import ElevationProfileLive from './ElevationProfileLive'
import { capturePhotoNative, isNativeCapacitor } from '../../services/navCameraService'

// Lazy-load NavSummary so its Leaflet/map imports don't affect NavigationView startup
const NavSummary = React.lazy(() => import('./NavSummary'))

interface Props {
  trackName?: string
  trackPoints?: TrackPoint[]
  tripId?: number
  onExit: () => void
}


const DEFAULT_ROUTE_NAME = () => {
  const d = new Date()
  return `Ruta ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}`
}

// ── Wake Lock hook ────────────────────────────────────────────────────────────
function useWakeLock(enabled: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled) {
      lockRef.current?.release().catch(() => {})
      lockRef.current = null
      return
    }
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          lockRef.current = await (navigator as Navigator & { wakeLock: { request(t: string): Promise<WakeLockSentinel> } })
            .wakeLock.request('screen')
        }
      } catch { /* user denied or feature unsupported */ }
    }
    acquire()
    // Re-acquire after the page becomes visible again (screen unlock)
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      lockRef.current?.release().catch(() => {})
      lockRef.current = null
    }
  }, [enabled])
}

export default function NavigationView({ trackName = 'Ruta', trackPoints, tripId, onExit }: Props) {
  const nav = useNavigation()
  const [autoFollow, setAutoFollow] = useState(true)
  const [showElevation, setShowElevation] = useState(!!trackPoints?.length)
  const [showSummary, setShowSummary] = useState(false)
  const [wakeLock, setWakeLock] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const startedFollowing = useRef(false)

  // Keep screen on whenever the toggle is active, regardless of nav mode
  useWakeLock(wakeLock)

  // Auto-start following when track points provided
  React.useEffect(() => {
    if (trackPoints?.length && !startedFollowing.current && nav.navMode === 'idle') {
      startedFollowing.current = true
      nav.loadTrackAndFollow(trackPoints)
    }
  }, [trackPoints]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStopRecording = useCallback(() => {
    nav.stopRecording()
    setShowSummary(true)
  }, [nav])

  const handleCameraClick = useCallback(async () => {
    // Capacitor native: Camera plugin preserves WebView state on Android.
    // If it fails (permission denied, user cancelled, plugin error) fall through
    // to the file-input path so the button is never a dead end.
    if (isNativeCapacitor()) {
      const captured = await capturePhotoNative()
      if (captured) {
        const file = new File([captured.blob], captured.filename, { type: captured.blob.type })
        if (tripId) {
          await nav.captureNavPhoto(file, tripId)
        } else {
          const url = URL.createObjectURL(captured.blob)
          const a = document.createElement('a'); a.href = url; a.download = captured.filename; a.click()
          URL.revokeObjectURL(url)
        }
        return
      }
      // captured === null → fall through to file input
    }

    // Chrome Android fires a spurious popstate when the camera intent closes.
    // A capture-phase listener with stopImmediatePropagation() intercepts it
    // before React Router's bubble-phase listener ever sees it.
    // No history.pushState manipulation needed — we just block the event entirely.
    let cleanedUp = false
    let maxTimer: ReturnType<typeof setTimeout>

    const blockPop = (e: PopStateEvent) => { e.stopImmediatePropagation() }
    window.addEventListener('popstate', blockPop, { capture: true })

    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      clearTimeout(maxTimer)
      window.removeEventListener('popstate', blockPop, { capture: true })
      window.removeEventListener('blur', onBlur)
      cameraInputRef.current?.removeEventListener('change', onFileChange)
    }

    const onFileChange = () => cleanup()

    // Mobile: window blurs when camera intent opens, regains focus when it closes.
    // Wait 200 ms after focus so the 'change' event (file picked) can fire first.
    const onBlur = () => {
      window.addEventListener('focus', () => setTimeout(cleanup, 200), { once: true })
    }

    // Safety valve: stop intercepting after 2 minutes
    maxTimer = setTimeout(cleanup, 120_000)

    window.addEventListener('blur', onBlur, { once: true })
    cameraInputRef.current?.addEventListener('change', onFileChange, { once: true })

    cameraInputRef.current?.click()
  }, [nav, tripId])

  const handlePhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (tripId) {
      await nav.captureNavPhoto(file, tripId)
    } else {
      // No trip — download the photo directly
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = `foto-nav-${Date.now()}.jpg`
      a.click()
      URL.revokeObjectURL(url)
    }
    e.target.value = ''
  }, [nav, tripId])

  const handleStopFollowing = useCallback(() => {
    nav.stopFollowing()
    onExit()
  }, [nav, onExit])

  const handleSaveToTrip = async (name: string) => {
    if (!tripId) return
    await nav.recorder.saveToTrip(tripId, name)
    setTimeout(onExit, 1200)
  }

  const handleDownload = (name: string) => {
    nav.recorder.downloadGpx(name)
    onExit()
  }

  const hasTrack = nav.navMode === 'following' && nav.trackPoints.length > 0
  const topBarHeight = nav.navMode !== 'idle' ? 96 : 52

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a14', zIndex: 100, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Map fills all space ── */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <NavigationMap
          position={nav.position}
          trackPoints={nav.trackPoints}
          recordedPoints={nav.recordedPoints}
          approachRoute={nav.approachRoute}
          navPhotos={nav.navPhotos}
          follow={autoFollow}
          onMapTouch={() => setAutoFollow(false)}
        />
        {/* Hidden camera input */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handlePhotoCapture}
        />
      </div>

      {/* ── Top HUD ── */}
      <NavigationHUD
        mode={nav.navMode}
        trackName={trackName}
        stats={nav.stats}
        onExit={() => {
          if (nav.navMode === 'recording') { handleStopRecording() }
          else if (nav.navMode === 'following') { handleStopFollowing() }
          else onExit()
        }}
      />

      {/* ── Bottom panel ── */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Elevation toggle button (floating, above bottom panel) */}
        {(hasTrack || nav.recordedPoints.length > 5) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px 6px' }}>
            <button
              onClick={() => setShowElevation(s => !s)}
              style={{
                background: 'rgba(10,10,20,0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                color: showElevation ? '#38bdf8' : '#64748b',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <Mountain size={14} />
              {showElevation ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          </div>
        )}

        {/* Approach banner — shown when user is >150 m from track and not yet navigating to it */}
        {nav.navMode === 'following' && nav.position &&
          nav.distanceToTrackM !== null && nav.distanceToTrackM > 150 && !nav.isApproaching && (
          <div style={{
            background: 'rgba(251,191,36,0.15)',
            borderTop: '1px solid rgba(251,191,36,0.35)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <MapPin size={16} color="#fbbf24" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>
                Estás a {nav.distanceToTrackM < 1000
                  ? `${Math.round(nav.distanceToTrackM / 10) * 10} m`
                  : `${(nav.distanceToTrackM / 1000).toFixed(1)} km`} del track
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Navega hasta el punto más cercano</div>
            </div>
            <button
              onClick={() => nav.navigateToTrack()}
              style={{
                background: 'rgba(251,191,36,0.2)',
                border: '1px solid rgba(251,191,36,0.4)',
                borderRadius: 8,
                padding: '6px 12px',
                color: '#fbbf24',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Ir al track
            </button>
          </div>
        )}

        {/* Approach in-progress indicator */}
        {nav.navMode === 'following' && nav.isApproaching && (
          <div style={{
            background: 'rgba(56,189,248,0.12)',
            borderTop: '1px solid rgba(56,189,248,0.3)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <Navigation size={14} color="#38bdf8" />
            <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>Aproximándose al track…</span>
          </div>
        )}

        {/* Turn instruction (following mode) */}
        {nav.navMode === 'following' && nav.currentInstruction && nav.position && (
          <TurnInstruction
            instruction={nav.currentInstruction}
            userLat={nav.position.lat}
            userLng={nav.position.lng}
            isDeviated={nav.isDeviated}
          />
        )}

        {/* Elevation profile */}
        {showElevation && (
          hasTrack ? (
            <ElevationProfileLive
              trackPoints={nav.trackPoints}
              progressIdx={nav.progressIdx}
              height={80}
            />
          ) : nav.recordedPoints.length > 5 ? (
            <ElevationProfileLive
              trackPoints={nav.recordedPoints.map(p => ({ lat: p.lat, lng: p.lng, ele: p.alt, time: null }))}
              progressIdx={nav.recordedPoints.length - 1}
              height={80}
            />
          ) : null
        )}

        {/* Controls bar */}
        <div style={{
          background: 'rgba(10,10,20,0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: `max(12px, env(safe-area-inset-bottom, 12px))`,
        }}>

          {nav.navMode === 'idle' && (
            <>
              <CtrlButton
                icon={<Radio size={18} color="#ef4444" />}
                label="Grabar ruta"
                onClick={() => nav.startRecording()}
                accent="#ef4444"
              />
              {trackPoints && trackPoints.length > 0 && (
                <CtrlButton
                  icon={<Navigation size={18} color="#3b82f6" />}
                  label="Seguir track"
                  onClick={() => nav.loadTrackAndFollow(trackPoints)}
                  accent="#3b82f6"
                />
              )}
            </>
          )}

          {nav.navMode === 'recording' && (
            <>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'navpulse 1.2s ease-in-out infinite' }} />
                <div>
                  <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>{nav.recordedPoints.length} pts</div>
                  {nav.navPhotos.length > 0 && (
                    <div style={{ fontSize: 10, color: '#22d96e' }}>{nav.navPhotos.length} foto{nav.navPhotos.length !== 1 ? 's' : ''}</div>
                  )}
                </div>
              </div>
              <CtrlButton
                icon={<Camera size={18} color="#22d96e" />}
                label="Foto"
                onClick={handleCameraClick}
                accent="#22d96e"
              />
              <CtrlButton
                icon={<Square size={18} color="#ef4444" />}
                label="Detener"
                onClick={handleStopRecording}
                accent="#ef4444"
              />
            </>
          )}

          {nav.navMode === 'following' && (
            <>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Progreso</div>
                <div style={{ marginTop: 3, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${nav.progressPct.toFixed(1)}%`, background: '#3b82f6', borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{nav.progressPct.toFixed(0)}%</div>
              </div>
              <CtrlButton
                icon={<Camera size={18} color="#22d96e" />}
                label="Foto"
                onClick={handleCameraClick}
                accent="#22d96e"
              />
              <CtrlButton
                icon={<Square size={18} color="#94a3b8" />}
                label="Salir"
                onClick={handleStopFollowing}
              />
            </>
          )}

          {/* Wake lock toggle — keep screen on */}
          {'wakeLock' in navigator && (
            <button
              onClick={() => setWakeLock(s => !s)}
              title={wakeLock ? 'Pantalla encendida (activo)' : 'Mantener pantalla encendida'}
              style={{
                background: wakeLock ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${wakeLock ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 10,
                padding: '8px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sun size={18} color={wakeLock ? '#fbbf24' : '#64748b'} />
            </button>
          )}

          {/* Re-center button */}
          <button
            onClick={() => setAutoFollow(true)}
            style={{
              background: autoFollow ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.08)',
              border: `1px solid ${autoFollow ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 10,
              padding: '8px 10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Crosshair size={18} color={autoFollow ? '#3b82f6' : '#64748b'} />
          </button>
        </div>
      </div>

      {/* ── Route summary (after stop recording) ── */}
      {showSummary && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#0a0a14', zIndex: 200 }} />}>
          <NavSummary
            trackName={DEFAULT_ROUTE_NAME()}
            recordedPoints={nav.recordedPoints}
            stats={nav.stats}
            navPhotos={nav.navPhotos}
            tripId={tripId}
            onSaveToTrip={handleSaveToTrip}
            onDownload={handleDownload}
            onDiscard={onExit}
          />
        </Suspense>
      )}

      <style>{`
        @keyframes navpulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}

// ── Small control button ──────────────────────────────────────────────────────
function CtrlButton({ icon, label, onClick, accent }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  accent?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: accent ? `${accent}18` : 'rgba(255,255,255,0.08)',
        border: `1px solid ${accent ? accent + '35' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 10,
        padding: '8px 14px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        minWidth: 64,
      }}
    >
      {icon}
      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}


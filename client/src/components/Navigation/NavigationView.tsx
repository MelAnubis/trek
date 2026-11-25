import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { Navigation, Radio, Square, Crosshair, Mountain, ChevronDown, ChevronUp, Sun, Camera, MapPin, Pause, Play, Volume2, VolumeX, BatteryLow, History, Download } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useNavigation } from '../../hooks/useNavigation'
import type { TrackPoint } from '../../hooks/useNavigation'
import NavigationMap from './NavigationMap'
import NavigationHUD from './NavigationHUD'
import TurnInstruction from './TurnInstruction'
import ElevationProfileLive from './ElevationProfileLive'
import { capturePhotoNative, isNativeCapacitor } from '../../services/navCameraService'
import { loadNavDraft, clearNavDraft, type NavDraft } from '../../services/navDraftStore'
import { GpxRecorderService } from '../../services/gpxRecorderService'
import { canDownloadLayer, downloadRouteTiles } from '../../services/navTiles'
import { loadTileKey, TILE_LAYERS } from './NavigationMap'

// Lazy-load NavSummary so its Leaflet/map imports don't affect NavigationView startup
const NavSummary = React.lazy(() => import('./NavSummary'))

interface Props {
  trackName?: string
  trackPoints?: TrackPoint[]
  tripId?: number | string
  onExit: () => void
  /** Fase B: record what is done while following the route. */
  recordWhileFollowing?: boolean
  /** Called with the track just saved to the trip (to link it to its tour). */
  onRecordingSaved?: (track: { id: number }) => Promise<void>
  saveNote?: string
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

export default function NavigationView({ trackName = 'Ruta', trackPoints, tripId, onExit, recordWhileFollowing = false, onRecordingSaved, saveNote }: Props) {
  const location = useLocation()
  const nav = useNavigation({
    trackName,
    tripId: tripId != null ? Number(tripId) : null,
    path: `${location.pathname}${location.search}`,
  })
  // A recording left unfinished (app closed by Android, phone off…): undefined while checking.
  const [draft, setDraft] = useState<NavDraft | null | undefined>(undefined)
  const [autoFollow, setAutoFollow] = useState(true)
  const [showElevation, setShowElevation] = useState(!!trackPoints?.length)
  const [showSummary, setShowSummary] = useState(false)
  const [wakeLock, setWakeLock] = useState(false)
  const [photoFlash, setPhotoFlash] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const startedFollowing = useRef(false)

  // Keep screen on whenever the toggle is active, regardless of nav mode
  useWakeLock(wakeLock)

  useEffect(() => {
    let alive = true
    loadNavDraft().then(d => { if (alive) setDraft(d) })
    return () => { alive = false }
  }, [])

  // Auto-start following when track points provided — unless there is a recording to recover first.
  React.useEffect(() => {
    if (draft !== null) return
    if (trackPoints?.length && !startedFollowing.current && nav.navMode === 'idle') {
      startedFollowing.current = true
      nav.loadTrackAndFollow(trackPoints, { record: recordWhileFollowing })
    }
  }, [trackPoints, draft]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Mapa sin conexión": downloads the route's tiles for the layer on screen.
  const [tileProgress, setTileProgress] = useState<number | null>(null)
  const [tileMsg, setTileMsg] = useState<string | null>(null)
  const handleDownloadTiles = useCallback(async () => {
    const layer = loadTileKey()
    const flash = (m: string) => { setTileMsg(m); setTimeout(() => setTileMsg(null), 5000) }
    if (!canDownloadLayer(layer)) {
      flash(`La capa ${TILE_LAYERS[layer].label} no se puede descargar: elige Topo o Ciclismo`)
      return
    }
    if (!navigator.onLine) { flash('Sin conexión: descárgalo antes de salir'); return }
    setTileProgress(0)
    const n = await downloadRouteTiles(nav.trackPoints, layer, (done, total) => setTileProgress(Math.round(done / total * 100)))
    setTileProgress(null)
    flash(n ? `Mapa ${TILE_LAYERS[layer].label} de la ruta guardado (${n} teselas)` : 'No se pudo guardar el mapa')
  }, [nav.trackPoints])

  const handleResumeDraft = useCallback(() => {
    if (!draft) return
    startedFollowing.current = true
    nav.resumeDraft(draft, trackPoints)
    setDraft(null)
  }, [draft, nav, trackPoints])

  const handleDraftSummary = useCallback(() => {
    if (!draft) return
    startedFollowing.current = true
    nav.loadDraftForSummary(draft)
    setDraft(null)
    setShowSummary(true)
  }, [draft, nav])

  const handleDiscardDraft = useCallback(() => {
    void clearNavDraft()
    setDraft(null)
  }, [])

  const handleStopRecording = useCallback(() => {
    nav.stopRecording()
    setShowSummary(true)
  }, [nav])

  const handleCameraClick = useCallback(async () => {
    const savePhoto = async (file: File) => {
      if (tripId) {
        const saved = await nav.captureNavPhoto(file, tripId)
        if (saved) { setPhotoFlash(true); setTimeout(() => setPhotoFlash(false), 600) }
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
        URL.revokeObjectURL(url)
        setPhotoFlash(true); setTimeout(() => setPhotoFlash(false), 600)
      }
    }

    // Push a barrier entry with the SAME URL before opening the camera.
    // Chrome Android fires a spurious popstate when any camera/file-picker
    // Activity closes. Because popstate pops our barrier (not the real nav
    // entry), the URL stays the same → React Router sees no route change.
    //
    // stopImmediatePropagation in capture phase does NOT work: popstate fires
    // on window itself, so all listeners (capture+bubble) run in registration
    // order. React Router registered before us → it always wins that race.
    const prevState = window.history.state
    // React Router (history v5) compares window.history.state.idx to its
    // internal index on every popstate. If idx is unchanged, delta=0 and
    // React Router skips navigation entirely. We must preserve idx (and key)
    // in the barrier so the spurious Chrome popstate looks like a no-op.
    const barrierState = (prevState && typeof prevState === 'object')
      ? { ...prevState, _navCam: true }
      : { _navCam: true }
    window.history.pushState(barrierState, '')
    // replaceState restores the entry without firing popstate.
    const cleanupBarrier = () => window.history.replaceState(prevState, '')

    if (isNativeCapacitor()) {
      const captured = await capturePhotoNative()
      if (captured) {
        const file = new File([captured.blob], captured.filename, { type: captured.blob.type })
        await savePhoto(file)
        cleanupBarrier()
        return
      }
      // null: barrier popped by Chrome (user cancelled) → return; barrier still there → plugin failed → fall through to file input
      const barrierStillThere = (window.history.state as { _navCam?: boolean } | null)?._navCam === true
      if (!barrierStillThere) return
      // Barrier intact → Capacitor plugin unavailable → fall through to file input
    }

    // File input path (browser + Capacitor fallback)
    let done = false
    let safetyTimer: ReturnType<typeof setTimeout>
    let onBlur: (() => void) | null = null

    const finish = () => {
      if (done) return
      done = true
      clearTimeout(safetyTimer)
      cleanupBarrier()
      if (onBlur) window.removeEventListener('blur', onBlur)
      cameraInputRef.current?.removeEventListener('change', onFilePick)
    }
    const onFilePick = () => finish()
    onBlur = () => {
      // Window blurs when camera intent opens; regains focus when it closes.
      // 200 ms grace period so 'change' can fire first if a file was picked.
      window.addEventListener('focus', () => setTimeout(finish, 200), { once: true })
    }
    safetyTimer = setTimeout(finish, 120_000)
    window.addEventListener('blur', onBlur, { once: true })
    cameraInputRef.current?.addEventListener('change', onFilePick, { once: true })
    cameraInputRef.current?.click()
  }, [nav, tripId])

  const handlePhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (tripId) {
      const saved = await nav.captureNavPhoto(file, tripId)
      if (saved) { setPhotoFlash(true); setTimeout(() => setPhotoFlash(false), 600) }
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
    const recorded = nav.isRecording && nav.recordedPoints.length > 1
    nav.stopFollowing()
    if (recorded) setShowSummary(true)
    else onExit()
  }, [nav, onExit])

  const handleSaveToTrip = async (name: string, targetTripId?: number | string) => {
    const id = targetTripId ?? tripId
    if (!id) return
    const track = await nav.recorder.saveToTrip(id, name)
    nav.discardDraft()
    if (onRecordingSaved && track?.id && id === tripId) {
      try { await onRecordingSaved(track) } catch { /* saved anyway; it can be linked from the Tracks tab */ }
    }
    setTimeout(onExit, 1200)
  }

  const handleDownload = async (name: string) => {
    await nav.recorder.downloadGpx(name)
    nav.discardDraft()
    // Don't exit — let user decide after downloading (they may also want to save to trip)
  }

  const hasTrack = nav.navMode === 'following' && nav.trackPoints.length > 0
  const topBarHeight = nav.navMode !== 'idle' ? 96 : 52

  return (
    <div className="!fixed !inset-[0] ![background:#0a0a14] !z-[100] !flex !flex-col !overflow-hidden">

      {/* ── Map fills all space ── */}
      <div className="!absolute !inset-[0]">
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
        {/* Photo captured flash */}
        {photoFlash && (
          <div className="!absolute !inset-[0] ![background:rgba(34,217,110,0.25)] !z-[50] !pointer-events-none !flex !items-center !justify-center">
            <div className="![background:rgba(34,217,110,0.9)] !rounded-[12px] !p-[10px_20px] ![color:#0a0a14] !font-[800] !text-[length:14px]">📷 Foto guardada</div>
          </div>
        )}
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
      <div className="!absolute !bottom-[0] !left-[0] !right-[0] !z-[20] !flex !flex-col">
        {/* Floating buttons above the bottom panel: offline map, voice, elevation */}
        <div className="!flex !justify-end !items-center !gap-[6px] !p-[0_12px_6px]">
          {tileMsg && (
            <span className="!text-[length:11px] ![color:#cbd5e1] ![background:rgba(10,10,20,0.85)] !rounded-[8px] !p-[5px_8px] !mr-auto" data-testid="nav-tiles-msg">{tileMsg}</span>
          )}
          {hasTrack && (
            <button className="![background:rgba(10,10,20,0.85)] ![backdrop-filter:blur(12px)] ![-webkit-backdrop-filter:blur(12px)] ![border:1px_solid_rgba(255,255,255,0.12)] !rounded-[10px] !p-[6px_10px] !flex !items-center !gap-[5px] !cursor-pointer !text-[length:12px] !font-[600] ![color:#94a3b8]"
              onClick={handleDownloadTiles}
              disabled={tileProgress !== null}
              title="Guardar el mapa de la ruta para usarlo sin cobertura"
              data-testid="nav-tiles"
            >
              <Download size={14} />
              {tileProgress !== null ? `${tileProgress}%` : 'Mapa'}
            </button>
          )}
          {nav.navMode !== 'idle' && (
            <button className="![background:rgba(10,10,20,0.85)] ![backdrop-filter:blur(12px)] ![-webkit-backdrop-filter:blur(12px)] ![border:1px_solid_rgba(255,255,255,0.12)] !rounded-[10px] !p-[6px_10px] !flex !items-center !cursor-pointer"
              onClick={() => nav.setVoiceMuted(!nav.voiceMuted)}
              title={nav.voiceMuted ? 'Activar avisos por voz' : 'Silenciar avisos por voz'}
              data-testid="nav-voice"
            >
              {nav.voiceMuted ? <VolumeX size={14} color="#64748b" /> : <Volume2 size={14} color="#22d96e" />}
            </button>
          )}
          {(hasTrack || nav.recordedPoints.length > 5) && (
            <button className="![background:rgba(10,10,20,0.85)] ![backdrop-filter:blur(12px)] ![-webkit-backdrop-filter:blur(12px)] ![border:1px_solid_rgba(255,255,255,0.12)] !rounded-[10px] !p-[6px_10px] !flex !items-center !gap-[5px] !cursor-pointer !text-[length:12px] !font-[600]"
              onClick={() => setShowElevation(s => !s)}
              style={{ color: showElevation ? '#38bdf8' : '#64748b' }}
            >
              <Mountain size={14} />
              {showElevation ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          )}
        </div>

        {/* Unfinished recording found on the phone */}
        {draft && nav.navMode === 'idle' && !showSummary && (
          <DraftCard draft={draft} canFollow={!!trackPoints?.length} onResume={handleResumeDraft} onSummary={handleDraftSummary} onDiscard={handleDiscardDraft} />
        )}

        {/* Low battery */}
        {nav.batteryWarning && nav.navMode !== 'idle' && (
          <div className="![background:rgba(239,68,68,0.15)] ![border-top:1px_solid_rgba(239,68,68,0.35)] !p-[8px_16px] !flex !items-center !gap-[8px]" data-testid="nav-battery">
            <BatteryLow size={16} color="#f87171" style={{ flexShrink: 0 }} />
            <span className="!text-[length:12px] ![color:#fca5a5] !font-[600]">{nav.batteryWarning}</span>
          </div>
        )}

        {/* Paused */}
        {nav.isPaused && (
          <div className="![background:rgba(251,191,36,0.15)] ![border-top:1px_solid_rgba(251,191,36,0.35)] !p-[8px_16px] !flex !items-center !gap-[8px]" data-testid="nav-paused">
            <Pause size={14} color="#fbbf24" />
            <span className="!text-[length:12px] ![color:#fbbf24] !font-[700]">
              {nav.autoPaused ? 'Pausa automática · se reanuda al moverte' : 'Grabación en pausa'}
            </span>
          </div>
        )}

        {/* Approach banner — shown when user is >150 m from track and not yet navigating to it */}
        {nav.navMode === 'following' && nav.position &&
          nav.distanceToTrackM !== null && nav.distanceToTrackM > 150 && !nav.isApproaching && (
          <div className="![background:rgba(251,191,36,0.15)] ![border-top:1px_solid_rgba(251,191,36,0.35)] !p-[10px_16px] !flex !items-center !gap-[10px]">
            <MapPin size={16} color="#fbbf24" style={{ flexShrink: 0 }} />
            <div className="!flex-[1]">
              <div className="!text-[length:12px] ![color:#fbbf24] !font-[700]">
                Estás a {nav.distanceToTrackM < 1000
                  ? `${Math.round(nav.distanceToTrackM / 10) * 10} m`
                  : `${(nav.distanceToTrackM / 1000).toFixed(1)} km`} del track
              </div>
              <div className="!text-[length:11px] ![color:#94a3b8]">Navega hasta el punto más cercano</div>
            </div>
            <button className="![background:rgba(251,191,36,0.2)] ![border:1px_solid_rgba(251,191,36,0.4)] !rounded-[8px] !p-[6px_12px] ![color:#fbbf24] !text-[length:12px] !font-[700] !cursor-pointer !whitespace-nowrap"
              onClick={() => nav.navigateToTrack()}
            >
              Ir al track
            </button>
          </div>
        )}

        {/* Approach in-progress indicator */}
        {nav.navMode === 'following' && nav.isApproaching && (
          <div className="![background:rgba(56,189,248,0.12)] ![border-top:1px_solid_rgba(56,189,248,0.3)] !p-[8px_16px] !flex !items-center !gap-[8px]">
            <Navigation size={14} color="#38bdf8" />
            <span className="!text-[length:12px] ![color:#38bdf8] !font-[600]">Aproximándose al track…</span>
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
        <div className="![background:rgba(10,10,20,0.92)] ![backdrop-filter:blur(16px)] ![-webkit-backdrop-filter:blur(16px)] ![border-top:1px_solid_rgba(255,255,255,0.08)] !p-[12px_12px] !flex !items-center !gap-[8px] [&&]:!pb-[max(12px,_env(safe-area-inset-bottom,_12px))]">

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
                  onClick={() => nav.loadTrackAndFollow(trackPoints, { record: recordWhileFollowing })}
                  accent="#3b82f6"
                />
              )}
            </>
          )}

          {nav.navMode === 'recording' && (
            <>
              <div className="!flex-[1] !flex !items-center !gap-[8px]">
                <div className="!w-[8px] !h-[8px] !rounded-[50%] ![background:#ef4444]" style={{ animation: 'navpulse 1.2s ease-in-out infinite' }} />
                <div>
                  {nav.geoRecordingError ? (
                    <div className="!text-[length:10px] ![color:#f97316] !font-[600] !max-w-[140px] !leading-[1.3]">{nav.geoRecordingError}</div>
                  ) : (
                    <>
                      <div className="!text-[length:13px] ![color:#f1f5f9] !font-[600]">{nav.recordedPoints.length} pts</div>
                      {nav.navPhotos.length > 0 && (
                        <div className="!text-[length:10px] ![color:#22d96e]">{nav.navPhotos.length} foto{nav.navPhotos.length !== 1 ? 's' : ''}</div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <CtrlButton
                icon={nav.isPaused ? <Play size={18} color="#fbbf24" /> : <Pause size={18} color="#fbbf24" />}
                label={nav.isPaused ? 'Seguir' : 'Pausa'}
                onClick={nav.togglePause}
                accent="#fbbf24"
              />
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
              <div className="!flex-[1]">
                <div className="!text-[length:11px] ![color:#64748b] !flex !items-center !gap-[6px]">
                  Progreso
                  {nav.isRecording && (
                    <span className="!inline-flex !items-center !gap-[4px] ![color:#f87171] !font-[700]" data-testid="nav-rec">
                      <span className="!w-[7px] !h-[7px] !rounded-[50%] ![background:#ef4444]" style={{ animation: 'navpulse 1.2s ease-in-out infinite' }} />
                      REC · {nav.recordedPoints.length} pts
                    </span>
                  )}
                </div>
                {nav.geoRecordingError && <div className="!text-[length:10px] ![color:#f97316] !font-[600] !leading-[1.3]">{nav.geoRecordingError}</div>}
                <div className="!mt-[3px] !h-[4px] ![background:rgba(255,255,255,0.1)] !rounded-[2px] !overflow-hidden">
                  <div className="!h-[100%] ![background:#3b82f6] !rounded-[2px] ![transition:width_0.5s]" style={{ width: `${nav.progressPct.toFixed(1)}%` }} />
                </div>
                <div className="!text-[length:10px] ![color:#475569] !mt-[2px]">{nav.progressPct.toFixed(0)}%</div>
              </div>
              <CtrlButton
                icon={<Camera size={18} color="#22d96e" />}
                label="Foto"
                onClick={handleCameraClick}
                accent="#22d96e"
              />
              {nav.isRecording && (
                <CtrlButton
                  icon={nav.isPaused ? <Play size={18} color="#fbbf24" /> : <Pause size={18} color="#fbbf24" />}
                  label={nav.isPaused ? 'Seguir' : 'Pausa'}
                  onClick={nav.togglePause}
                  accent="#fbbf24"
                />
              )}
              <CtrlButton
                icon={<Square size={18} color={nav.isRecording ? '#ef4444' : '#94a3b8'} />}
                label={nav.isRecording ? 'Terminar' : 'Salir'}
                onClick={handleStopFollowing}
                accent={nav.isRecording ? '#ef4444' : undefined}
              />
            </>
          )}

          {/* Wake lock toggle — keep screen on */}
          {'wakeLock' in navigator && (
            <button className="!rounded-[10px] !p-[8px_10px] !cursor-pointer !flex !items-center !justify-center"
              onClick={() => setWakeLock(s => !s)}
              title={wakeLock ? 'Pantalla encendida (activo)' : 'Mantener pantalla encendida'}
              style={{ background: wakeLock ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${wakeLock ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'}` }}
            >
              <Sun size={18} color={wakeLock ? '#fbbf24' : '#64748b'} />
            </button>
          )}

          {/* Re-center button */}
          <button className="!rounded-[10px] !p-[8px_10px] !cursor-pointer !flex !items-center !justify-center"
            onClick={() => setAutoFollow(true)}
            style={{ background: autoFollow ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${autoFollow ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)'}` }}
          >
            <Crosshair size={18} color={autoFollow ? '#3b82f6' : '#64748b'} />
          </button>
        </div>
      </div>

      {/* ── Route summary (after stop recording) ── */}
      {showSummary && (
        <Suspense fallback={<div className="!fixed !inset-[0] ![background:#0a0a14] !z-[200]" />}>
          <NavSummary
            trackName={recordWhileFollowing ? trackName : DEFAULT_ROUTE_NAME()}
            saveNote={saveNote}
            recordedPoints={nav.recordedPoints}
            stats={nav.stats}
            navPhotos={nav.navPhotos}
            tripId={tripId}
            onSaveToTrip={handleSaveToTrip}
            onDownload={handleDownload}
            onDiscard={() => { nav.discardDraft(); onExit() }}
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
    <button className="!rounded-[10px] !p-[8px_8px] !cursor-pointer !flex !flex-col !items-center !gap-[3px] !min-w-[52px]"
      onClick={onClick}
      style={{ background: accent ? `${accent}18` : 'rgba(255,255,255,0.08)', border: `1px solid ${accent ? accent + '35' : 'rgba(255,255,255,0.12)'}` }}
    >
      {icon}
      <span className="!text-[length:10px] ![color:#94a3b8] !font-[600] !whitespace-nowrap">{label}</span>
    </button>
  )
}


// ── Unfinished recording card ─────────────────────────────────────────────────
function DraftCard({ draft, canFollow, onResume, onSummary, onDiscard }: {
  draft: NavDraft
  canFollow: boolean
  onResume: () => void
  onSummary: () => void
  onDiscard: () => void
}) {
  const rec = new GpxRecorderService()
  rec.load(draft.points, draft.startedAt)
  const km = rec.totalDistanceM() / 1000
  const when = new Date(draft.startedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const followNote = draft.following && !canFollow ? ' (sin la guía de la ruta)' : ''
  return (
    <div className="![background:rgba(10,10,20,0.95)] ![border-top:1px_solid_rgba(56,189,248,0.35)] !p-[12px_16px] !flex !flex-col !gap-[10px]" data-testid="nav-draft">
      <div className="!flex !items-center !gap-[10px]">
        <History size={18} color="#38bdf8" style={{ flexShrink: 0 }} />
        <div className="!flex-[1] !min-w-[0]">
          <div className="!text-[length:13px] ![color:#f1f5f9] !font-[700]">Grabación sin terminar</div>
          <div className="!text-[length:11px] ![color:#94a3b8] !overflow-hidden !text-ellipsis !whitespace-nowrap">
            {draft.trackName} · {km.toFixed(1).replace('.', ',')} km · {when}
          </div>
        </div>
      </div>
      <div className="!flex !gap-[8px]">
        <button className="!flex-[1] !rounded-[10px] !p-[9px] !text-[length:12px] !font-[700] !cursor-pointer ![background:rgba(239,68,68,0.15)] ![border:1px_solid_rgba(239,68,68,0.35)] ![color:#f87171]" onClick={onResume}>
          Continuar grabando{followNote}
        </button>
        <button className="!flex-[1] !rounded-[10px] !p-[9px] !text-[length:12px] !font-[700] !cursor-pointer ![background:rgba(59,130,246,0.15)] ![border:1px_solid_rgba(59,130,246,0.35)] ![color:#60a5fa]" onClick={onSummary}>
          Terminar y guardar
        </button>
      </div>
      <button className="![background:none] ![border:none] ![color:#64748b] !text-[length:11px] !cursor-pointer !self-center" onClick={onDiscard}>
        Descartar la grabación
      </button>
    </div>
  )
}

import React, { useState, useCallback, useRef } from 'react'
import { Navigation, Radio, Square, Crosshair, Mountain, ChevronDown, ChevronUp, Save, Download, MapPin } from 'lucide-react'
import { useNavigation } from '../../hooks/useNavigation'
import type { TrackPoint } from '../../hooks/useNavigation'
import NavigationMap from './NavigationMap'
import NavigationHUD from './NavigationHUD'
import TurnInstruction from './TurnInstruction'
import ElevationProfileLive from './ElevationProfileLive'

interface Props {
  trackName?: string
  trackPoints?: TrackPoint[]
  tripId?: number
  onExit: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function NavigationView({ trackName = 'Ruta', trackPoints, tripId, onExit }: Props) {
  const nav = useNavigation()
  const [autoFollow, setAutoFollow] = useState(true)
  const [showElevation, setShowElevation] = useState(!!trackPoints?.length)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveName, setSaveName] = useState(() => {
    const d = new Date()
    return `Ruta ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}`
  })
  const startedFollowing = useRef(false)

  // Auto-start following when track points provided
  React.useEffect(() => {
    if (trackPoints?.length && !startedFollowing.current && nav.navMode === 'idle') {
      startedFollowing.current = true
      nav.loadTrackAndFollow(trackPoints)
    }
  }, [trackPoints]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStopRecording = useCallback(() => {
    nav.stopRecording()
    if (nav.recordedPoints.length > 2) {
      setShowSaveDialog(true)
    } else {
      onExit()
    }
  }, [nav, onExit])

  const handleStopFollowing = useCallback(() => {
    nav.stopFollowing()
    onExit()
  }, [nav, onExit])

  const handleSaveToTrip = async () => {
    if (!tripId) return
    setSaveState('saving')
    try {
      await nav.recorder.saveToTrip(tripId, saveName)
      setSaveState('saved')
      setTimeout(onExit, 1200)
    } catch {
      setSaveState('error')
    }
  }

  const handleDownload = () => {
    nav.recorder.downloadGpx(saveName)
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
          follow={autoFollow}
          onMapTouch={() => setAutoFollow(false)}
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
                <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>
                  {nav.recordedPoints.length} puntos GPS
                </span>
              </div>
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
                icon={<Square size={18} color="#94a3b8" />}
                label="Salir"
                onClick={handleStopFollowing}
              />
            </>
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

      {/* ── Save dialog (after stop recording) ── */}
      {showSaveDialog && (
        <SaveDialog
          tripId={tripId}
          name={saveName}
          onNameChange={setSaveName}
          saveState={saveState}
          onSaveToTrip={handleSaveToTrip}
          onDownload={handleDownload}
          onDiscard={onExit}
        />
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

// ── Save dialog ───────────────────────────────────────────────────────────────
function SaveDialog({ tripId, name, onNameChange, saveState, onSaveToTrip, onDownload, onDiscard }: {
  tripId?: number
  name: string
  onNameChange: (n: string) => void
  saveState: SaveState
  onSaveToTrip: () => void
  onDownload: () => void
  onDiscard: () => void
}) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'flex-end',
    }}>
      <div style={{
        background: 'rgba(15,15,30,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '20px 20px 0 0',
        padding: '24px 20px',
        width: '100%',
        paddingBottom: `max(24px, env(safe-area-inset-bottom, 24px))`,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Guardar ruta</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Ruta grabada con éxito.
        </div>

        <input
          value={name}
          onChange={e => onNameChange(e.target.value)}
          placeholder="Nombre de la ruta"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 14,
            color: '#f1f5f9',
            outline: 'none',
            marginBottom: 16,
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tripId && (
            <button
              onClick={onSaveToTrip}
              disabled={saveState === 'saving'}
              style={{
                background: saveState === 'saved' ? 'rgba(34,217,110,0.15)' : 'rgba(59,130,246,0.15)',
                border: `1px solid ${saveState === 'saved' ? 'rgba(34,217,110,0.3)' : 'rgba(59,130,246,0.3)'}`,
                borderRadius: 12,
                padding: '13px 16px',
                color: saveState === 'saved' ? '#22d96e' : '#3b82f6',
                fontWeight: 700,
                fontSize: 14,
                cursor: saveState === 'saving' ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <Save size={18} />
              {saveState === 'idle' ? 'Guardar en el viaje' : saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? '¡Guardado!' : 'Error al guardar'}
            </button>
          )}
          <button
            onClick={onDownload}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: '13px 16px',
              color: '#94a3b8',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <Download size={18} />
            Descargar GPX
          </button>
          <button
            onClick={onDiscard}
            style={{
              background: 'none', border: 'none',
              color: '#64748b', fontSize: 13,
              cursor: 'pointer', padding: '8px',
            }}
          >
            Descartar y salir
          </button>
        </div>
      </div>
    </div>
  )
}

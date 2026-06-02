import React from 'react'
import { X, Navigation, Circle, Mountain } from 'lucide-react'
import type { NavMode, NavStats } from '../../hooks/useNavigation'

interface Props {
  mode: NavMode
  trackName: string
  stats: NavStats
  onExit: () => void
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}

export default function NavigationHUD({ mode, trackName, stats, onExit }: Props) {
  const isRecording = mode === 'recording'
  const isFollowing = mode === 'following'

  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0,
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    }}>
      {/* Top bar: title + exit */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px 10px',
        background: 'rgba(10,10,20,0.82)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {isRecording && (
          <Circle size={12} fill="#ef4444" color="#ef4444" style={{ flexShrink: 0, animation: 'navpulse 1.2s ease-in-out infinite' }} />
        )}
        {isFollowing && (
          <Navigation size={14} color="#3b82f6" style={{ flexShrink: 0 }} />
        )}
        <span style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 600,
          color: '#f1f5f9',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {isRecording ? 'Grabando ruta' : trackName}
        </span>
        <button
          onClick={onExit}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 8,
            padding: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            color: '#94a3b8',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Stats strip */}
      {(isRecording || isFollowing) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          background: 'rgba(10,10,20,0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          gap: 0,
        }}>
          <Stat label="Tiempo" value={fmt(stats.elapsedSeconds)} />
          <Divider />
          {isFollowing ? (
            <>
              <Stat label="Recorrido" value={fmtDist(stats.distanceTraveledM)} />
              <Divider />
              <Stat label="Restante" value={fmtDist(stats.distanceRemainingM)} color="#38bdf8" />
            </>
          ) : (
            <Stat label="Distancia" value={fmtDist(stats.distanceTraveledM)} />
          )}
          <Divider />
          <Stat label="Velocidad" value={`${stats.currentSpeedKmh.toFixed(1)} km/h`} />
          {stats.elevationGainM > 0 && (
            <>
              <Divider />
              <Stat
                label="Desnivel"
                value={`↑ ${Math.round(stats.elevationGainM)} m`}
                color="#f97316"
                icon={<Mountain size={10} style={{ marginRight: 2, color: '#f97316' }} />}
              />
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes navpulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}

function Stat({ label, value, color, icon }: { label: string; value: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color ?? '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}{value}
      </div>
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.1)', flexShrink: 0, margin: '0 4px' }} />
}

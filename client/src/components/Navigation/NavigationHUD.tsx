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
    <div className="!absolute !top-[0] !left-[0] !right-[0] !z-[20] !flex !flex-col !gap-[0]">
      {/* Top bar: title + exit */}
      <div className="!flex !items-center !gap-[10px] !p-[12px_16px_10px] ![background:rgba(10,10,20,0.82)] ![backdrop-filter:blur(16px)] ![-webkit-backdrop-filter:blur(16px)] ![border-bottom:1px_solid_rgba(255,255,255,0.08)]">
        {isRecording && (
          <Circle size={12} fill="#ef4444" color="#ef4444" style={{ flexShrink: 0, animation: 'navpulse 1.2s ease-in-out infinite' }} />
        )}
        {isFollowing && (
          <Navigation size={14} color="#3b82f6" style={{ flexShrink: 0 }} />
        )}
        <span className="!flex-[1] !text-[length:14px] !font-[600] ![color:#f1f5f9] !overflow-hidden !text-ellipsis !whitespace-nowrap">
          {isRecording ? 'Grabando ruta' : trackName}
        </span>
        <button className="![background:rgba(255,255,255,0.1)] ![border:none] !rounded-[8px] !p-[6px] !cursor-pointer !flex !items-center ![color:#94a3b8]"
          onClick={onExit}
        >
          <X size={16} />
        </button>
      </div>

      {/* Stats strip */}
      {(isRecording || isFollowing) && (
        <div className="!flex !items-center !p-[8px_16px] ![background:rgba(10,10,20,0.75)] ![backdrop-filter:blur(12px)] ![-webkit-backdrop-filter:blur(12px)] ![border-bottom:1px_solid_rgba(255,255,255,0.06)] !gap-[0]">
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
    <div className="!flex-[1] !text-center !min-w-[0]">
      <div className="!text-[length:9px] ![color:#64748b] !uppercase !tracking-[0.5px] !mb-[1px]">{label}</div>
      <div className="!text-[length:13px] !font-[700] !flex !items-center !justify-center" style={{ color: color ?? '#f1f5f9' }}>
        {icon}{value}
      </div>
    </div>
  )
}

function Divider() {
  return <div className="!w-[1px] !h-[28px] ![background:rgba(255,255,255,0.1)] !shrink-[0] !m-[0_4px]" />
}

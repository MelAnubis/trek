import { useMemo } from 'react'
import { biggestClimb, profilePaths, type Profile } from './profile'

/**
 * El perfil como imagen: negro, grande, y la pegatina #ESTODOBAJADA justo en
 * el arranque de la peor subida. Es la portada de cada ruta.
 *
 * The SVG stretches to any width (preserveAspectRatio="none", strokes kept
 * crisp with non-scaling-stroke); the sticker is HTML on top so its letters
 * never stretch.
 */
export default function ProfileArt({ profile, height = 160, sticker = true, dark = false, label, className }: {
  profile: Profile
  height?: number
  sticker?: boolean
  /** White line on black (for dark bands). */
  dark?: boolean
  /** Accessible description (e.g. "Perfil: 112 km, +1.240 m"). */
  label?: string
  className?: string
}) {
  const W = 600
  const top = sticker ? 34 : 8
  const geo = useMemo(() => profilePaths(profile, W, height, { top, bottom: 2 }), [profile, height, top])
  const climb = useMemo(() => (sticker ? biggestClimb(profile) : null), [profile, sticker])
  const ink = dark ? '#ffffff' : '#111111'
  const fill = dark ? 'rgba(255,255,255,0.08)' : '#f4f4f5'
  if (!geo) return <div className={className} style={{ height, background: fill }} role="img" aria-label={label} />
  const sx = climb ? geo.x(profile[climb.from][0]) : 0
  const sy = climb ? geo.y(profile[climb.from][1]) : 0
  const leftPct = (sx / W) * 100
  return (
    <div className={`relative ${className || ''}`} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} aria-hidden="true">
        <path d={geo.area} fill={fill} />
        <path d={geo.line} fill="none" stroke={ink} strokeWidth={2.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {climb && <line x1={sx} y1={sy} x2={sx} y2={Math.max(sy - 22, 6)} stroke={ink} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {climb && (
        <>
          <span aria-hidden="true" className="absolute rounded-full" style={{ left: `calc(${leftPct}% - 4px)`, top: sy - 4, width: 8, height: 8, background: ink }} />
          <span aria-hidden="true" className="absolute whitespace-nowrap leading-none"
            style={{
              top: Math.max(sy - 22 - 20, 0), left: `${leftPct}%`,
              transform: leftPct > 70 ? 'translateX(calc(-100% + 8px))' : 'translateX(-8px)',
              background: ink, color: dark ? '#111111' : '#ffffff', padding: '5px 8px',
              fontFamily: "Jost, Futura, 'Century Gothic', sans-serif", fontWeight: 300, fontSize: 11, letterSpacing: '0.1em',
            }}>#ESTODOBAJADA</span>
        </>
      )}
    </div>
  )
}

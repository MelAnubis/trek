// Perfil de altura de una excursión (el del resumen de la v5): área en gris, al pasar marca el punto en el mapa.
import { useMemo, useState } from 'react'
import { useTranslation } from '../i18n'
import { haversineMetres } from './core'
import { formatDistance, formatElevation } from './presentation'

interface Props {
  geometry: readonly (readonly number[])[] | null
  onFocus?: (point: [number, number] | null) => void
  height?: number
  /** MDT-02: where stages end along the route, in metres, marked across the profile. */
  boundariesM?: number[]
}

const W = 300

export default function ElevationProfile({ geometry, onFocus, height = 110, boundariesM = [] }: Props) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)

  const data = useMemo(() => {
    if (!geometry || geometry.length < 2 || geometry.some(p => p.length < 3)) return null
    const step = Math.max(1, Math.floor(geometry.length / 400))
    const pts: { d: number; e: number; lat: number; lng: number }[] = []
    let d = 0
    for (let i = 0; i < geometry.length; i++) {
      if (i > 0) d += haversineMetres(geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1])
      if (i % step === 0 || i === geometry.length - 1) pts.push({ d, e: geometry[i][2], lat: geometry[i][0], lng: geometry[i][1] })
    }
    const min = Math.min(...pts.map(p => p.e))
    const max = Math.max(...pts.map(p => p.e))
    const pad = Math.max(10, (max - min) * 0.12)
    return { pts, total: d, lo: min - pad, hi: max + pad }
  }, [geometry])

  if (!data) {
    return <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '14px 4px' }}>{t('tours.planner.inspector.elevationPlaceholder')}</div>
  }
  const H = height
  const x = (d: number) => (d / (data.total || 1)) * W
  const y = (e: number) => H - ((e - data.lo) / (data.hi - data.lo || 1)) * H
  const line = data.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const focus = hover != null ? data.pts[hover] : null

  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect()
    const d = ((ev.clientX - rect.left) / rect.width) * data.total
    let best = 0
    data.pts.forEach((p, i) => { if (Math.abs(p.d - d) < Math.abs(data.pts[best].d - d)) best = i })
    setHover(best)
    onFocus?.([data.pts[best].lat, data.pts[best].lng])
  }

  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-faint)', borderRadius: 12, padding: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: 'block', touchAction: 'none' }}
        onPointerMove={onMove} onPointerLeave={() => { setHover(null); onFocus?.(null) }} role="img" aria-label={t('tours.planner.inspector.elevation')}>
        <defs>
          <linearGradient id="tour-elev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--text-muted)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--text-muted)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#tour-elev)" />
        <path d={line} fill="none" stroke="var(--text-primary)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        {boundariesM.map((m, i) => <line key={i} data-testid="stage-boundary" x1={x(m)} x2={x(m)} y1={0} y2={H} stroke="var(--text-primary)" strokeOpacity={0.55} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />)}
        {focus && <line x1={x(focus.d)} x2={x(focus.d)} y1={0} y2={H} stroke="var(--text-primary)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 4, minHeight: 14 }}>
        {focus
          ? <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('tours.planner.inspector.profileFocus', { distance: formatDistance(focus.d / 1000), elevation: formatElevation(focus.e) })}</span>
          : <><span>0 km</span><span>{formatDistance(data.total / 1000)}</span></>}
      </div>
    </div>
  )
}

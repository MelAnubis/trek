import React, { useMemo } from 'react'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'
import type { Stage } from '../../utils/plannerRoute'
import { STAGE_COLORS } from './PlannerMap'

interface Props {
  cum: number[]
  smoothed: (number | null)[]
  stages: Stage[]
  activeStage: number | null
  hint: string
  eleLabel: string
  onHover: (idx: number | null) => void
  /** Clic en el perfil: devuelve el índice de punto bajo el cursor. */
  onClickIndex: (idx: number) => void
}

interface Datum { dist: number; ele: number | null; idx: number }

const MAX_CHART_POINTS = 700

export default function PlannerProfile({ cum, smoothed, stages, activeStage, hint, eleLabel, onHover, onClickIndex }: Props) {
  const data = useMemo<Datum[]>(() => {
    const n = cum.length
    if (!n) return []
    const step = Math.max(1, Math.ceil(n / MAX_CHART_POINTS))
    const out: Datum[] = []
    for (let i = 0; i < n; i += step) {
      out.push({ dist: Math.round(cum[i] * 100) / 100, ele: smoothed[i] == null ? null : Math.round(smoothed[i] as number), idx: i })
    }
    if (out[out.length - 1].idx !== n - 1) {
      out.push({ dist: Math.round(cum[n - 1] * 100) / 100, ele: smoothed[n - 1] == null ? null : Math.round(smoothed[n - 1] as number), idx: n - 1 })
    }
    return out
  }, [cum, smoothed])

  const total = cum.length ? cum[cum.length - 1] : 0

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 10px 0' }}>{hint}</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
            onMouseMove={(s: any) => onHover(s?.activePayload?.[0]?.payload?.idx ?? null)}
            onMouseLeave={() => onHover(null)}
            onClick={(s: any) => {
              const idx = s?.activePayload?.[0]?.payload?.idx
              if (typeof idx === 'number') onClickIndex(idx)
            }}
            style={{ cursor: 'crosshair' }}
          >
            <defs>
              <linearGradient id="plannerEleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e85d24" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#e85d24" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <XAxis dataKey="dist" type="number" domain={[0, Math.ceil(total)]}
              tickFormatter={v => `${Math.round(v)}`} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}`} width={40} domain={['dataMin - 20', 'dataMax + 20']} />
            <ReTooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11, color: '#fff' }}
              formatter={(v: any) => [`${v} m`, eleLabel]}
              labelFormatter={(l: any) => `km ${l}`}
            />
            {stages.map((st, i) => (
              <ReferenceArea key={i} x1={st.startKm} x2={st.endKm}
                fill={STAGE_COLORS[i % STAGE_COLORS.length]}
                fillOpacity={activeStage === i ? 0.22 : 0.08} strokeOpacity={0} ifOverflow="visible" />
            ))}
            <Area type="monotone" dataKey="ele" stroke="#e85d24" strokeWidth={1.6}
              fill="url(#plannerEleGrad)" dot={false} isAnimationActive={false} connectNulls />
            {stages.slice(0, -1).map((st, i) => (
              <ReferenceLine key={`c${i}`} x={st.endKm} stroke={STAGE_COLORS[(i + 1) % STAGE_COLORS.length]}
                strokeWidth={2} strokeDasharray="4 2" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

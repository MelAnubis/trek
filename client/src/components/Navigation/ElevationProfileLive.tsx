import React, { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts'
import type { TrackPoint } from '../../hooks/useNavigation'

interface ProfilePoint {
  dist: number  // km from start
  ele: number
  slope: number
}

function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function slopeColor(pct: number): string {
  const a = Math.abs(pct)
  if (a > 15) return '#ef4444'
  if (a > 10) return '#f97316'
  if (a > 6)  return '#f59e0b'
  if (a > 3)  return '#84cc16'
  return '#22d96e'
}

function buildProfile(pts: TrackPoint[]): ProfilePoint[] {
  if (pts.length < 2) return []
  const result: ProfilePoint[] = []
  let dist = 0
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) dist += haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
    const ele = pts[i].ele ?? 0
    let slope = 0
    if (i > 0) {
      const dDist = haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) * 1000
      const dEle = ele - (pts[i - 1].ele ?? ele)
      slope = dDist > 0 ? (dEle / dDist) * 100 : 0
    }
    result.push({ dist: Math.round(dist * 100) / 100, ele, slope })
  }
  return result
}

interface Props {
  trackPoints: TrackPoint[]
  progressIdx: number
  height?: number
}

export default function ElevationProfileLive({ trackPoints, progressIdx, height = 90 }: Props) {
  const profile = useMemo(() => buildProfile(trackPoints), [trackPoints])

  if (profile.length < 2) return null

  const currentDist = profile[Math.min(progressIdx, profile.length - 1)]?.dist ?? 0
  const minEle = Math.min(...profile.map(p => p.ele))
  const maxEle = Math.max(...profile.map(p => p.ele))
  const range = maxEle - minEle

  const currentSlope = profile[Math.min(progressIdx, profile.length - 1)]?.slope ?? 0
  const slopeCol = slopeColor(currentSlope)

  return (
    <div style={{
      background: 'rgba(10,10,20,0.88)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '6px 8px 4px',
    }}>
      {/* Slope info strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, paddingLeft: 4 }}>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: slopeCol,
          background: slopeCol + '20',
          padding: '1px 6px',
          borderRadius: 4,
        }}>
          {currentSlope > 0 ? '+' : ''}{currentSlope.toFixed(1)}%
        </span>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          {profile[Math.min(progressIdx, profile.length - 1)]?.ele?.toFixed(0) ?? '–'} m alt
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#475569' }}>
          {minEle.toFixed(0)}–{maxEle.toFixed(0)} m
          {range > 0 ? ` · Δ${range.toFixed(0)} m` : ''}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={profile} margin={{ top: 2, right: 8, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dist"
            tick={{ fontSize: 9, fill: '#475569' }}
            tickFormatter={v => `${v} km`}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minEle - 20, maxEle + 20]}
            tick={{ fontSize: 9, fill: '#475569' }}
            tickFormatter={v => `${v}m`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,15,30,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 11,
              color: '#f1f5f9',
            }}
            formatter={(val: number, name: string) => [
              name === 'ele' ? `${val.toFixed(0)} m` : `${val.toFixed(1)}%`,
              name === 'ele' ? 'Altitud' : 'Pendiente',
            ]}
            labelFormatter={v => `${v} km`}
          />
          <Area
            type="monotone"
            dataKey="ele"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#elevGrad)"
            dot={false}
            isAnimationActive={false}
          />
          {/* Current position marker */}
          <ReferenceLine
            x={currentDist}
            stroke={slopeCol}
            strokeWidth={2}
            strokeDasharray="0"
            label={{
              value: '▼',
              position: 'insideTop',
              fontSize: 10,
              fill: slopeCol,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

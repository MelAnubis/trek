/**
 * ElevationDetail.tsx
 * Módulo de elevación con IBPIndex para Trek
 * Portado desde Bikelog v22 — adaptado a TypeScript + estilo Trek
 */
import React, { useMemo, useState } from 'react'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid, Brush, Bar,
} from 'recharts'
import { Mountain, ChevronDown, ChevronUp, Layers, RefreshCw, Download } from 'lucide-react'

// ── Colores por track ─────────────────────────────────────────────────────────
const TRACK_COLORS = ['#22d96e', '#38bdf8', '#f59e0b', '#a78bfa', '#f87171', '#34d399']

// ── Tabla IBP oficial (IBPIndex.com) ─────────────────────────────────────────
// Columnas: nivel de forma 0=Muy baja … 4=Muy alta
const IBP_TABLE = [
  { label: 'Muy fácil', color: '#22c55e', max: [6,   13,  25,  50,  100] },
  { label: 'Fácil',     color: '#84cc16', max: [13,  25,  50,  100, 200] },
  { label: 'Media',     color: '#f59e0b', max: [19,  38,  75,  150, 300] },
  { label: 'Dura',      color: '#f97316', max: [25,  50,  100, 200, 400] },
  { label: 'Muy dura',  color: '#ef4444', max: [999, 999, 999, 999, 999] },
]
const FITNESS_LABELS = ['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta']

function calcIBP(distKm: number, gainM: number, maxSlope = 0): number {
  const base  = gainM * 0.04 + distKm * 0.25
  const bonus = maxSlope > 20 ? (maxSlope - 20) * 0.5 : 0
  return Math.round(base + bonus)
}

function ibpCategory(ibp: number, fitness = 2): { label: string; color: string } {
  for (const row of IBP_TABLE) {
    if (ibp <= row.max[fitness]) return { label: row.label, color: row.color }
  }
  return { label: 'Muy dura', color: '#ef4444' }
}

function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 +
            Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
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

function slopeLabel(pct: number): string {
  const a = Math.abs(pct)
  if (a > 15) return 'Muy duro'
  if (a > 10) return 'Duro'
  if (a > 6)  return 'Moderado'
  if (a > 3)  return 'Suave'
  return 'Llano'
}

interface ProfilePoint {
  dist: number
  ele: number
  slope: number
  lat: number
  lng: number
}

interface Profile {
  data: ProfilePoint[]
  minEle: number
  maxEle: number
  totalDist: number
  gain: number
  loss: number
  maxSlope: number
}

function buildProfile(track: GpxTrack): Profile | null {
  const pts = (track.points || []).filter((p: any) => p.ele != null && p.lat != null)
  if (pts.length < 2) return null

  // Sample up to 1000 points to preserve detail
  const step    = Math.max(1, Math.floor(pts.length / 1000))
  const sampled = pts.filter((_: any, i: number) => i % step === 0)

  // Smoothing: ±5 point window (11-point moving average) to reduce GPS elevation noise
  // without flattening genuine peaks/valleys
  const smooth = sampled.map((p: any, i: number) => {
    const s = Math.max(0, i - 5), e = Math.min(sampled.length - 1, i + 5)
    let sum = 0, cnt = 0
    for (let j = s; j <= e; j++) { sum += sampled[j].ele; cnt++ }
    return { ...p, ele: sum / cnt }
  })

  // Pre-compute cumulative distances in metres (needed for distance-based slope window)
  const cumDistM: number[] = [0]
  for (let i = 1; i < smooth.length; i++) {
    cumDistM.push(cumDistM[i - 1] + haversineKm(smooth[i - 1].lat, smooth[i - 1].lng, smooth[i].lat, smooth[i].lng) * 1000)
  }

  // Slope: fixed 200 m lookback window (not point-count based).
  // With dense GPS tracks, point-count windows can be only 10–25 m, making any 2 m
  // GPS noise appear as 8–20% slope. 200 m smooths out noise while still showing real climbs.
  const MIN_SLOPE_DIST_M = 200
  const data: ProfilePoint[] = smooth.map((p: any, i: number) => {
    // Find the last index whose cumulative distance is ≥ MIN_SLOPE_DIST_M behind current
    let pi = 0
    for (let j = i - 1; j >= 0; j--) {
      if (cumDistM[i] - cumDistM[j] >= MIN_SLOPE_DIST_M) { pi = j; break }
    }
    const dD = cumDistM[i] - cumDistM[pi]  // metres
    const dE = p.ele - smooth[pi].ele
    const slope = dD >= MIN_SLOPE_DIST_M ? (dE / dD) * 100 : 0
    return {
      dist:  Math.round(cumDistM[i] / 10) / 100,  // km (2 decimal places)
      ele:   Math.round(p.ele),
      slope: Math.round(slope * 10) / 10,
      lat:   p.lat,
      lng:   p.lng,
    }
  })

  const eles = data.map(d => d.ele)

  // Max slope: use 95th-percentile of absolute slopes to exclude GPS outliers.
  // Raw max always picks the single worst noisy reading; P95 gives a realistic worst climb.
  const absSlopes = data.map(d => Math.abs(d.slope)).filter(s => s > 0).sort((a, b) => a - b)
  const p95 = absSlopes.length > 0 ? absSlopes[Math.floor(absSlopes.length * 0.95)] : 0
  const maxSlope = Math.round(p95)

  // Gain / loss: use stored server values (computed with threshold-hysteresis + smoothing).
  // Only fall back to local cumulative sum if track object lacks those fields.
  let gain: number = track.total_elevation_gain ?? 0
  let loss: number = track.total_elevation_loss ?? 0
  if (track.total_elevation_gain == null || track.total_elevation_loss == null) {
    gain = 0; loss = 0
    for (let i = 1; i < data.length; i++) {
      const dE = data[i].ele - data[i - 1].ele
      if (dE > 0) gain += dE; else loss += Math.abs(dE)
    }
    gain = Math.round(gain); loss = Math.round(loss)
  }

  return {
    data,
    minEle:    Math.min(...eles),
    maxEle:    Math.max(...eles),
    totalDist: data[data.length - 1]?.dist || 0,
    gain,
    loss,
    maxSlope,
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GpxTrack {
  id: number
  track_name: string
  total_distance: number
  total_elevation_gain: number
  total_elevation_loss: number
  max_elevation: number | null
  min_elevation: number | null
  ibp?: number | null
  points?: { lat: number; lng: number; ele: number | null }[]
}

interface ElevationDetailProps {
  tracks: GpxTrack[]
  tripId?: number | string
  onIbpUpdated?: (trackId: number, ibp: number) => void
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{
      background: 'var(--bg-primary, #1e2a3a)',
      border: '1px solid var(--border-primary, #2d3f55)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      lineHeight: 1.8,
    }}>
      <div style={{ fontWeight: 700, color: 'var(--text-primary, #e2e8f0)' }}>📍 {d.dist} km</div>
      <div style={{ color: '#22d96e' }}>⛰ {d.ele} m</div>
      {d.slope != null && (
        <div style={{ color: slopeColor(d.slope) }}>
          📐 {d.slope > 0 ? '+' : ''}{d.slope}% — {slopeLabel(d.slope)}
        </div>
      )}
    </div>
  )
}

// ── IBP Table Legend ──────────────────────────────────────────────────────────
function IBPTableLegend({ ibp, fitness }: { ibp: number; fitness: number }) {
  const cat = ibpCategory(ibp, fitness)
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg-secondary, #253547)',
      borderRadius: 8,
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748b)', fontWeight: 700,
                    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
        Tabla IBP oficial ·{' '}
        <span style={{ color: cat.color }}>Preparación: {FITNESS_LABELS[fitness]}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary, #2d3f55)' }}>
              <th style={{ padding: '4px 8px', textAlign: 'left',
                           color: 'var(--text-tertiary, #64748b)', fontWeight: 600 }}>
                Dificultad
              </th>
              {FITNESS_LABELS.map((f, i) => (
                <th key={i} style={{
                  padding: '4px 8px', textAlign: 'center',
                  color:      fitness === i ? cat.color : 'var(--text-tertiary, #64748b)',
                  fontWeight: fitness === i ? 800 : 500,
                  background: fitness === i ? cat.color + '18' : 'transparent',
                }}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IBP_TABLE.map((row, ri) => {
              const isActive = cat.label === row.label
              return (
                <tr key={ri} style={{
                  background:   isActive ? row.color + '15' : 'transparent',
                  borderBottom: '1px solid var(--border-primary, #2d3f55)',
                }}>
                  <td style={{
                    padding: '5px 8px', fontWeight: isActive ? 800 : 500,
                    color: isActive ? row.color : 'var(--text-secondary, #94a3b8)',
                    whiteSpace: 'nowrap',
                  }}>
                    {isActive ? '▶ ' : ''}{row.label}
                  </td>
                  {row.max.map((mx, fi) => {
                    const prev  = ri > 0 ? IBP_TABLE[ri - 1].max[fi] + 1 : 0
                    const label = ri < IBP_TABLE.length - 1
                      ? `${prev}–${mx}`
                      : `>${IBP_TABLE[ri - 1].max[fi]}`
                    return (
                      <td key={fi} style={{
                        padding: '5px 8px', textAlign: 'center',
                        color:      isActive && fi === fitness ? row.color : 'var(--text-tertiary, #64748b)',
                        fontWeight: isActive && fi === fitness ? 800 : 400,
                        background: fi === fitness
                          ? (isActive ? row.color + '20' : 'var(--bg-tertiary, #1a2535)')
                          : 'transparent',
                      }}>
                        {label}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary, #64748b)', marginTop: 5 }}>
          Columna resaltada = tu nivel · Fila resaltada = categoría de este track
        </div>
      </div>
    </div>
  )
}

// ── Single Track Detail ───────────────────────────────────────────────────────
function TrackDetail({
  track,
  color,
  expanded,
  onToggle,
  fitness,
  tripId,
  onIbpUpdated,
}: {
  track: GpxTrack
  color: string
  expanded: boolean
  onToggle: () => void
  fitness: number
  tripId?: number | string
  onIbpUpdated?: (trackId: number, ibp: number) => void
}) {
  const profile = useMemo(() => buildProfile(track), [track.id])
  const [recalculating, setRecalculating] = useState(false)

  const handleRecalcIbp = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!tripId || recalculating) return
    setRecalculating(true)
    try {
      const r = await fetch(`/api/trips/${tripId}/gpx/${track.id}/recalculate-ibp`, {
        method: 'POST', credentials: 'include',
      })
      if (r.ok) {
        const { ibp } = await r.json()
        onIbpUpdated?.(track.id, ibp)
      }
    } catch { /* ignore */ }
    setRecalculating(false)
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const points = track.points
    if (!points || points.length === 0) return
    const ptLines = points.map(p =>
      `    <trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>`
    )
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <trk><name>${track.track_name}</name><trkseg>`,
      ...ptLines,
      '  </trkseg></trk>',
      '</gpx>',
    ].join('\n')
    const filename = `${track.track_name.replace(/[^a-z0-9]/gi, '_')}.gpx`
    const blob = new Blob([xml], { type: 'application/gpx+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  if (!profile) {
    const hasPoints = (track.points?.length || 0) > 0
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary, #64748b)', fontSize: 13 }}>
        {hasPoints
          ? 'Sin datos de altitud — este track fue importado desde OpenStreetMap, que no incluye perfil de elevación.'
          : 'Sin datos de elevación — carga el track con puntos'}
      </div>
    )
  }

  const { data, minEle, maxEle, totalDist, gain, loss, maxSlope } = profile
  const ibpOfficial = track.ibp != null
  const ibp = ibpOfficial ? track.ibp! : calcIBP(totalDist, gain, maxSlope)
  const cat = ibpCategory(ibp, fitness)

  const distStep = totalDist > 50 ? 10 : totalDist > 20 ? 5 : totalDist > 10 ? 2 : 1
  const distTicks: number[] = []
  for (let k = 0; k <= totalDist; k += distStep) distTicks.push(Math.round(k * 10) / 10)

  return (
    <div style={{
      border: '1px solid var(--border-primary, #2d3f55)',
      borderRadius: 10,
      marginBottom: 10,
      overflow: 'hidden',
      background: 'var(--bg-primary, #1e2a3a)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', cursor: 'pointer', userSelect: 'none',
      }} onClick={onToggle}>
        <div style={{ width: 14, height: 14, borderRadius: 4, background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 14, color: 'var(--text-primary, #e2e8f0)',
            marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {track.track_name}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-tertiary, #64748b)',
            display: 'flex', gap: 12, flexWrap: 'wrap',
          }}>
            <span>{totalDist} km</span>
            <span style={{ color: '#f97316' }}>↑ {gain} m</span>
            <span style={{ color: '#38bdf8' }}>↓ {loss} m</span>
            <span>Alt. {minEle}–{maxEle} m</span>
            <span style={{ color: '#f59e0b' }}>Pend. máx. {maxSlope}%</span>
          </div>
        </div>
        {/* IBP Badge */}
        <div style={{
          padding: '4px 10px', borderRadius: 20,
          background: cat.color + '20',
          border: `1px solid ${cat.color}`,
          textAlign: 'center', flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: cat.color }}>{ibp}</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: cat.color, letterSpacing: 1 }}>
            {ibpOfficial ? 'IBP ✓' : 'IBP ~'}
          </div>
        </div>
        {track.points && track.points.length > 0 && (
          <button
            onClick={handleDownload}
            title="Descargar GPX"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, color: 'var(--text-tertiary)', flexShrink: 0,
            }}
          >
            <Download size={14} />
          </button>
        )}
        {tripId && (
          <button
            onClick={handleRecalcIbp}
            title="Recalcular IBP"
            style={{
              background: 'none', border: 'none', cursor: recalculating ? 'wait' : 'pointer',
              padding: 4, color: 'var(--text-tertiary)', flexShrink: 0,
              opacity: recalculating ? 0.5 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: recalculating ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
        {expanded ? <ChevronUp size={16} color="var(--text-tertiary)" /> : <ChevronDown size={16} color="var(--text-tertiary)" />}
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Stats grid */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: 'Distancia',  value: `${totalDist} km`,      color: '#22d96e' },
              { label: 'Desnivel +', value: `${gain} m`,            color: '#f97316' },
              { label: 'Desnivel −', value: `${loss} m`,            color: '#38bdf8' },
              { label: 'Alt. máx.',  value: `${maxEle} m`,          color: '#f59e0b' },
              { label: 'Alt. mín.',  value: `${minEle} m`,          color: 'var(--text-tertiary)' },
              { label: 'Pend. máx.', value: `${maxSlope}%`,         color: '#ef4444' },
              { label: 'IBP',        value: `${ibp} — ${cat.label}`, color: cat.color },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'var(--bg-secondary, #253547)',
                borderRadius: 8, padding: '8px 12px', minWidth: 80,
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary, #64748b)',
                              letterSpacing: 0.5, marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Elevation + slope chart */}
          <div style={{ height: 220, marginBottom: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary, #2d3f55)" opacity={0.5} />
                <XAxis
                  dataKey="dist"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={distTicks}
                  tickFormatter={v => `${v}km`}
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary, #64748b)' }}
                />
                <YAxis
                  yAxisId="ele"
                  orientation="left"
                  domain={[Math.floor(minEle * 0.98), Math.ceil(maxEle * 1.02)]}
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary, #64748b)' }}
                  tickFormatter={v => `${v}m`}
                />
                <YAxis
                  yAxisId="slope"
                  orientation="right"
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary, #64748b)' }}
                  tickFormatter={v => `${v}%`}
                  domain={[-30, 30]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Brush
                  dataKey="dist"
                  height={20}
                  stroke="var(--border-primary, #2d3f55)"
                  fill="var(--bg-secondary, #253547)"
                  travellerWidth={6}
                />
                <Area
                  yAxisId="ele"
                  type="monotone"
                  dataKey="ele"
                  stroke={color}
                  fill={color + '30'}
                  strokeWidth={2}
                  dot={false}
                  name="Elevación"
                />
                <Bar
                  yAxisId="slope"
                  dataKey="slope"
                  name="Pendiente"
                  fill="#94a3b820"
                  stroke="none"
                  maxBarSize={4}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* IBP table */}
          <IBPTableLegend ibp={ibp} fitness={fitness} />
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ElevationDetail({ tracks, tripId, onIbpUpdated }: ElevationDetailProps) {
  const [fitness, setFitness]   = useState(2)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  const tracksWithPoints = tracks.filter(t => t.points && t.points.length > 0)

  if (!tracksWithPoints.length) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 32, gap: 12,
        color: 'var(--text-tertiary, #64748b)',
      }}>
        <Mountain size={32} />
        <div style={{ fontSize: 14 }}>
          Carga un GPX con datos de elevación para ver el perfil
        </div>
      </div>
    )
  }

  const toggle = (id: number) =>
    setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Fitness selector */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 16, padding: '10px 14px',
        background: 'var(--bg-secondary, #253547)',
        borderRadius: 8,
      }}>
        <Layers size={14} color="var(--text-tertiary)" />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary, #64748b)', fontWeight: 600 }}>
          Tu preparación:
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {FITNESS_LABELS.map((l, i) => (
            <button
              key={i}
              onClick={() => setFitness(i)}
              style={{
                padding: '3px 8px', borderRadius: 12, border: 'none',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: fitness === i
                  ? ibpCategory(50, i).color
                  : 'var(--bg-tertiary, #1a2535)',
                color: fitness === i ? '#fff' : 'var(--text-tertiary, #64748b)',
                transition: 'all .15s',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tracks */}
      {tracksWithPoints.map((track, i) => (
        <TrackDetail
          key={track.id}
          track={track}
          color={TRACK_COLORS[i % TRACK_COLORS.length]}
          expanded={!!expanded[track.id]}
          onToggle={() => toggle(track.id)}
          fitness={fitness}
          tripId={tripId}
          onIbpUpdated={onIbpUpdated}
        />
      ))}
    </div>
  )
}

const _spinStyle = document.createElement('style')
_spinStyle.textContent = '@keyframes spin { to { transform: rotate(360deg) } }'
if (typeof document !== 'undefined' && !document.querySelector('#elevation-spin')) {
  _spinStyle.id = 'elevation-spin'
  document.head.appendChild(_spinStyle)
}

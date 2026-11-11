/**
 * GpxSplitWizard.tsx
 * Wizard 3 pasos para dividir un GPX en etapas manualmente:
 *   1. Carga los puntos del track
 *   2. Usuario selecciona cortes en el perfil de elevación y/o el mapa (sincronizados)
 *   3. Confirma las etapas resultantes y ejecuta el split
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMapEvents } from 'react-leaflet'
import { Scissors, X, ChevronRight, ChevronLeft, Check, Trash2, MapPin, Mountain } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GpxPoint {
  lat: number
  lng: number
  ele: number | null
  time?: string | null
}

interface Day {
  id: number
  title: string | null
  date?: string | null
  day_number?: number | null
}

interface CutPoint {
  pointIndex: number   // index en el array de puntos del track
  dayId: number | null // día al que pertenece el tramo que EMPIEZA en este corte
  label: string
}

interface StageSummary {
  from: number
  to: number
  dayId: number | null
  dayLabel: string
  distKm: number
  gainM: number
  lossM: number
}

interface Props {
  tripId: number | string
  trackId: number
  trackName: string
  days: Day[]
  onClose: () => void
  onDone: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = '/api'

async function apiFetch(url: string, opts: RequestInit = {}) {
  const r = await fetch(url, { ...opts, credentials: 'include' })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(err.error || r.statusText)
  }
  return r.json()
}

function haversineM(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeDistances(pts: GpxPoint[]): number[] {
  const dists: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    dists.push(dists[i - 1] + haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000)
  }
  return dists
}

function smoothEle(pts: GpxPoint[], win = 7): (number | null)[] {
  const half = Math.floor(win / 2)
  return pts.map((_, i) => {
    const s = Math.max(0, i - half), e = Math.min(pts.length - 1, i + half)
    const vals = []
    for (let j = s; j <= e; j++) { if (pts[j].ele != null) vals.push(pts[j].ele as number) }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })
}

function computeGainLoss(pts: GpxPoint[]) {
  const smoothed = smoothEle(pts)
  let gain = 0, loss = 0
  let ref: number | null = null
  for (const ele of smoothed) {
    if (ele == null) continue
    if (ref === null) { ref = ele; continue }
    const diff = ele - ref
    if (diff > 5) { gain += diff; ref = ele }
    else if (diff < -5) { loss += Math.abs(diff); ref = ele }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) }
}

function nearestIdx(pts: GpxPoint[], lat: number, lng: number): number {
  let best = 0, bestDist = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = haversineM(pts[i].lat, pts[i].lng, lat, lng)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

function fmtKm(km: number) {
  return km >= 10 ? `${Math.round(km)} km` : `${(Math.round(km * 10) / 10)} km`
}

function dayLabel(day: Day) {
  return day.title || `Día ${day.day_number || day.id}`
}

const CUT_COLORS = ['#f59e0b', '#a78bfa', '#f87171', '#34d399', '#38bdf8', '#fb923c', '#e879f9']

// ── Map click handler (inner component needs useMapEvents hook) ───────────────

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onMapClick(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function GpxSplitWizard({ tripId, trackId, trackName, days, onClose, onDone }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [points, setPoints] = useState<GpxPoint[]>([])
  const [distances, setDistances] = useState<number[]>([])
  const [chartData, setChartData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Cortes: lista ordenada por pointIndex. NO incluye el inicio (0) ni el fin (n-1).
  const [cuts, setCuts] = useState<CutPoint[]>([])
  // Día seleccionado para el próximo corte
  const [selectedDayId, setSelectedDayId] = useState<number | null>(days[0]?.id ?? null)
  // Índice de punto hovereado en la gráfica
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // Stages derivadas de los cortes
  const stages = buildStages(points, distances, cuts, days)

  // ── Load points ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true); setError(null)
    apiFetch(`${API_BASE}/trips/${tripId}/gpx/${trackId}/points`)
      .then((data: any) => {
        const pts: GpxPoint[] = data.points || []
        setPoints(pts)
        const dists = computeDistances(pts)
        setDistances(dists)
        // Sample chart data (max 800 points for performance)
        const step = Math.max(1, Math.floor(pts.length / 800))
        setChartData(
          pts
            .filter((_, i) => i % step === 0 || i === pts.length - 1)
            .map((p, j) => ({
              dist: Math.round(dists[j * step] * 10) / 10,
              ele: p.ele != null ? Math.round(p.ele) : null,
              origIdx: Math.min(j * step, pts.length - 1),
            }))
        )
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false))
  }, [tripId, trackId])

  // ── Add cut at a point index ─────────────────────────────────────────────────
  const addCut = useCallback((ptIdx: number) => {
    // Clamp: no poner corte en el primer ni último punto
    const idx = Math.max(1, Math.min(ptIdx, points.length - 2))
    // No duplicar si ya hay un corte muy cerca (< 0.5% del total)
    const minSep = Math.max(5, Math.floor(points.length * 0.005))
    const tooClose = cuts.some(c => Math.abs(c.pointIndex - idx) < minSep)
    if (tooClose) return

    const newCut: CutPoint = {
      pointIndex: idx,
      dayId: selectedDayId,
      label: selectedDayId ? (days.find(d => d.id === selectedDayId) ? dayLabel(days.find(d => d.id === selectedDayId)!) : `Corte`) : 'Sin día',
    }
    setCuts(prev => [...prev, newCut].sort((a, b) => a.pointIndex - b.pointIndex))
  }, [points.length, cuts, selectedDayId, days])

  // ── Click en el mapa ────────────────────────────────────────────────────────
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (step !== 2) return
    const idx = nearestIdx(points, lat, lng)
    addCut(idx)
  }, [step, points, addCut])

  // ── Click en el perfil de elevación ─────────────────────────────────────────
  const handleChartClick = useCallback((data: any) => {
    if (!data?.activePayload?.[0]) return
    const origIdx: number = data.activePayload[0].payload.origIdx
    addCut(origIdx)
  }, [addCut])

  const removeCut = (i: number) => setCuts(prev => prev.filter((_, j) => j !== i))

  const updateCutDay = (i: number, dayId: number | null) => {
    setCuts(prev => prev.map((c, j) => {
      if (j !== i) return c
      const d = dayId ? days.find(d => d.id === dayId) : null
      return { ...c, dayId, label: d ? dayLabel(d) : 'Sin día' }
    }))
  }

  // ── Execute split ────────────────────────────────────────────────────────────
  const executeSplit = async () => {
    setSaving(true); setError(null)
    try {
      const payload = {
        cuts: cuts.map(c => ({ pointIndex: c.pointIndex, dayId: c.dayId })),
      }
      await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${trackId}/split-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Map bounds ───────────────────────────────────────────────────────────────
  const mapCenter: [number, number] = points.length
    ? [points[Math.floor(points.length / 2)].lat, points[Math.floor(points.length / 2)].lng]
    : [40, -3]

  const totalDist = distances.length ? distances[distances.length - 1] : 0

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="!fixed !inset-[0] !z-[9000] ![background:rgba(0,0,0,0.75)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center !p-[12px]">
      <div className="![background:var(--bg-primary,_#0f1923)] ![border:1px_solid_var(--border-primary,_#2d3f55)] !rounded-[16px] !w-[100%] !max-w-[920px] !max-h-[95vh] !flex !flex-col !overflow-hidden">
        {/* Header */}
        <div className="!flex !items-center !gap-[10px] !p-[14px_18px] ![border-bottom:1px_solid_var(--border-primary,_#2d3f55)] !shrink-[0]">
          <Scissors size={18} style={{ color: '#f59e0b' }} />
          <div className="!flex-[1]">
            <div className="!font-[700] !text-[length:14px] ![color:var(--text-primary,_#e2e8f0)]">
              Dividir GPX en etapas
            </div>
            <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)]">{trackName}</div>
          </div>
          {/* Steps */}
          <div className="!flex !items-center !gap-[6px] !text-[length:11px]">
            {([1, 2, 3] as const).map(s => (
              <div className="!w-[24px] !h-[24px] !rounded-[50%] !flex !items-center !justify-center !font-[700] !text-[length:11px] ![transition:all_.2s]" key={s} style={{ background: step === s ? '#f59e0b' : step > s ? '#22d96e' : 'var(--bg-secondary, #253547)', color: step >= s ? '#000' : 'var(--text-tertiary, #64748b)' }}>
                {step > s ? <Check size={12} /> : s}
              </div>
            ))}
          </div>
          <button className="![background:none] ![border:none] !cursor-pointer !p-[4px] ![color:var(--text-tertiary,_#64748b)]" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="!flex-[1] !overflow-auto !p-[16px_18px]">
          {loading ? (
            <div className="!text-center !p-[40px] ![color:var(--text-tertiary,_#64748b)]">
              <Mountain size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <div>Cargando track…</div>
            </div>
          ) : error ? (
            <div className="![color:#ef4444] !p-[20px] !text-center">⚠ {error}</div>
          ) : step === 1 ? (
            <Step1 trackName={trackName} totalDist={totalDist} pointCount={points.length} days={days} />
          ) : step === 2 ? (
            <Step2
              chartData={chartData}
              points={points}
              distances={distances}
              cuts={cuts}
              days={days}
              selectedDayId={selectedDayId}
              hoverIdx={hoverIdx}
              mapCenter={mapCenter}
              onChartClick={handleChartClick}
              onChartHover={setHoverIdx}
              onMapClick={handleMapClick}
              onSelectDay={setSelectedDayId}
              onRemoveCut={removeCut}
              onUpdateCutDay={updateCutDay}
            />
          ) : (
            <Step3 stages={stages} days={days} error={error} />
          )}
        </div>

        {/* Footer */}
        <div className="!flex !items-center !justify-between !p-[12px_18px] ![border-top:1px_solid_var(--border-primary,_#2d3f55)] !shrink-[0] !gap-[10px]">
          <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)]">
            {step === 2 && cuts.length === 0 && 'Haz clic en el perfil o el mapa para añadir cortes'}
            {step === 2 && cuts.length > 0 && `${cuts.length} corte${cuts.length > 1 ? 's' : ''} · ${cuts.length + 1} etapa${cuts.length + 1 > 1 ? 's' : ''}`}
            {step === 3 && `${stages.length} etapas listas para guardar`}
          </div>
          <div className="!flex !gap-[8px]">
            {step > 1 && (
              <button
                onClick={() => setStep(s => (s - 1) as any)}
                disabled={saving}
                style={btnStyle('ghost')}
              >
                <ChevronLeft size={15} /> Atrás
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep(s => (s + 1) as any)}
                disabled={loading || points.length === 0}
                style={btnStyle('primary')}
              >
                {step === 1 ? 'Empezar' : 'Revisar'} <ChevronRight size={15} />
              </button>
            ) : (
              <button onClick={executeSplit} disabled={saving || stages.length === 0} style={btnStyle('success')}>
                {saving ? 'Guardando…' : <><Check size={15} /> Guardar etapas</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Step 1: info ──────────────────────────────────────────────────────────────
function Step1({ trackName, totalDist, pointCount, days }: {
  trackName: string; totalDist: number; pointCount: number; days: Day[]
}) {
  return (
    <div className="!max-w-[540px] !m-[0_auto] !text-center !p-[20px_0]">
      <Scissors size={40} style={{ color: '#f59e0b', marginBottom: 16 }} />
      <div className="!text-[length:18px] !font-[700] ![color:var(--text-primary,_#e2e8f0)] !mb-[8px]">
        División manual de etapas
      </div>
      <div className="!text-[length:13px] ![color:var(--text-secondary,_#94a3b8)] !mb-[24px] !leading-[1.6]">
        En el siguiente paso verás el perfil de elevación y el mapa del track completo.
        Haz clic donde quieras cortar y asigna cada tramo a un día del viaje.
        Los días sin viaje simplemente no tendrán etapa asignada.
      </div>
      <div className="!flex !gap-[12px] !justify-center !flex-wrap !mb-[24px]">
        <StatChip label="Track" value={trackName} />
        <StatChip label="Distancia total" value={`${Math.round(totalDist * 10) / 10} km`} />
        <StatChip label="Puntos GPX" value={pointCount.toLocaleString()} />
        <StatChip label="Días en el viaje" value={String(days.length)} />
      </div>
      <div className="!text-[length:12px] ![color:var(--text-tertiary,_#64748b)] !leading-[1.5]">
        Las etapas anteriores vinculadas a este viaje se eliminarán al guardar.
      </div>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="![background:var(--bg-secondary,_#253547)] ![border:1px_solid_var(--border-primary,_#2d3f55)] !rounded-[8px] !p-[8px_14px] !text-center">
      <div className="!text-[length:10px] ![color:var(--text-tertiary,_#64748b)] !mb-[2px] !uppercase !tracking-[0.8px]">{label}</div>
      <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary,_#e2e8f0)]">{value}</div>
    </div>
  )
}

// ── Step 2: interactive editor ────────────────────────────────────────────────
function Step2({
  chartData, points, distances, cuts, days, selectedDayId, hoverIdx,
  mapCenter, onChartClick, onChartHover, onMapClick, onSelectDay,
  onRemoveCut, onUpdateCutDay,
}: {
  chartData: any[]
  points: GpxPoint[]
  distances: number[]
  cuts: CutPoint[]
  days: Day[]
  selectedDayId: number | null
  hoverIdx: number | null
  mapCenter: [number, number]
  onChartClick: (data: any) => void
  onChartHover: (idx: number | null) => void
  onMapClick: (lat: number, lng: number) => void
  onSelectDay: (id: number | null) => void
  onRemoveCut: (i: number) => void
  onUpdateCutDay: (i: number, dayId: number | null) => void
}) {
  const totalDist = distances.length ? distances[distances.length - 1] : 0

  // Cut positions as distances for reference lines
  const cutDists = cuts.map(c => {
    const d = distances[c.pointIndex]
    return Math.round((d ?? 0) * 10) / 10
  })

  // Polyline segments with colors
  const segments = buildPolylineSegments(points, cuts)

  return (
    <div className="!flex !flex-col !gap-[14px]">
      {/* Day selector */}
      <div className="![background:var(--bg-secondary,_#253547)] ![border:1px_solid_var(--border-primary,_#2d3f55)] !rounded-[10px] !p-[10px_14px]">
        <div className="!text-[length:11px] !font-[700] ![color:var(--text-tertiary,_#64748b)] !mb-[8px] !uppercase !tracking-[0.8px]">
          Día del próximo corte
        </div>
        <div className="!flex !flex-wrap !gap-[6px]">
          <DayChip label="Sin día" selected={selectedDayId === null} color="#64748b" onClick={() => onSelectDay(null)} />
          {days.map(d => (
            <DayChip key={d.id} label={dayLabel(d)} selected={selectedDayId === d.id}
              color={CUT_COLORS[days.indexOf(d) % CUT_COLORS.length]}
              onClick={() => onSelectDay(d.id)} />
          ))}
        </div>
      </div>

      {/* Elevation chart */}
      <div className="![background:var(--bg-secondary,_#253547)] ![border:1px_solid_var(--border-primary,_#2d3f55)] !rounded-[10px] !p-[10px_6px_4px]">
        <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !mb-[4px] !pl-[8px]">
          Perfil de elevación · haz clic para añadir un corte
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={chartData} onClick={onChartClick}
            onMouseMove={(s: any) => {
              const idx = s?.activePayload?.[0]?.payload?.origIdx
              onChartHover(idx ?? null)
            }}
            onMouseLeave={() => onChartHover(null)}
            style={{ cursor: 'crosshair' }}>
            <defs>
              <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22d96e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22d96e" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="dist" type="number" domain={[0, Math.ceil(totalDist)]}
              tickFormatter={v => `${v}km`} tick={{ fontSize: 9, fill: '#64748b' }}
              axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}m`} width={38} />
            <ReTooltip
              contentStyle={{ background: '#1a2535', border: '1px solid #2d3f55', borderRadius: 6, fontSize: 11 }}
              formatter={(v: any) => [`${v} m`, 'Altitud']}
              labelFormatter={(l: any) => `${l} km`}
            />
            <Area type="monotone" dataKey="ele" stroke="#22d96e" strokeWidth={1.5}
              fill="url(#eleGrad)" dot={false} isAnimationActive={false} connectNulls />
            {/* Cut reference lines */}
            {cutDists.map((d, i) => (
              <ReferenceLine key={i} x={d} stroke={CUT_COLORS[i % CUT_COLORS.length]}
                strokeWidth={2} strokeDasharray="4 2" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Map */}
      <div className="!rounded-[10px] !overflow-hidden ![border:1px_solid_var(--border-primary,_#2d3f55)] !h-[280px]">
        <MapContainer center={mapCenter} zoom={9} style={{ width: '100%', height: '100%' }}
          zoomControl={true}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap"
          />
          <MapClickHandler onMapClick={onMapClick} />
          {/* Track segments with colors */}
          {segments.map((seg, i) => (
            <Polyline key={i}
              positions={seg.points.map(p => [p.lat, p.lng] as [number, number])}
              color={seg.color} weight={3} opacity={0.85} />
          ))}
          {/* Cut markers */}
          {cuts.map((c, i) => (
            <CircleMarker key={i}
              center={[points[c.pointIndex].lat, points[c.pointIndex].lng]}
              radius={7}
              pathOptions={{ color: '#fff', fillColor: CUT_COLORS[i % CUT_COLORS.length], fillOpacity: 1, weight: 2 }}
            />
          ))}
          {/* Start/End markers */}
          {points.length > 0 && (
            <>
              <CircleMarker center={[points[0].lat, points[0].lng]} radius={6}
                pathOptions={{ color: '#fff', fillColor: '#22d96e', fillOpacity: 1, weight: 2 }} />
              <CircleMarker center={[points[points.length - 1].lat, points[points.length - 1].lng]} radius={6}
                pathOptions={{ color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }} />
            </>
          )}
        </MapContainer>
      </div>

      {/* Cut list */}
      {cuts.length > 0 && (
        <div className="![background:var(--bg-secondary,_#253547)] ![border:1px_solid_var(--border-primary,_#2d3f55)] !rounded-[10px] !p-[10px_14px]">
          <div className="!text-[length:11px] !font-[700] ![color:var(--text-tertiary,_#64748b)] !mb-[8px] !uppercase !tracking-[0.8px]">
            Cortes añadidos
          </div>
          <div className="!flex !flex-col !gap-[6px]">
            {cuts.map((c, i) => (
              <CutRow key={i} cut={c} index={i} color={CUT_COLORS[i % CUT_COLORS.length]}
                dist={distances[c.pointIndex] ?? 0}
                days={days} onRemove={() => onRemoveCut(i)} onChangeDay={d => onUpdateCutDay(i, d)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DayChip({ label, selected, color, onClick }: { key?: any; label: string; selected: boolean; color: string; onClick: () => void }) {
  return (
    <button className={['!p-[4px_10px] !rounded-[6px] !cursor-pointer ![transition:all_.15s]', (selected) ? '!font-[700]' : '!font-[400]', '!text-[length:11px]'].join(' ')} onClick={onClick} style={{ border: `1px solid ${selected ? color : 'transparent'}`, background: selected ? color + '25' : 'var(--bg-tertiary, #1a2535)', color: selected ? color : 'var(--text-secondary, #94a3b8)' }}>
      {label}
    </button>
  )
}

function CutRow({ cut, index, color, dist, days, onRemove, onChangeDay }: {
  key?: any; cut: CutPoint; index: number; color: string; dist: number
  days: Day[]; onRemove: () => void; onChangeDay: (id: number | null) => void
}) {
  return (
    <div className="!flex !items-center !gap-[8px]">
      <div className="!w-[10px] !h-[10px] !rounded-[3px] !shrink-[0]" style={{ background: color }} />
      <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !shrink-[0] !min-w-[50px]">
        km {Math.round(dist * 10) / 10}
      </div>
      <select className="!flex-[1] ![background:var(--bg-tertiary,_#1a2535)] ![border:1px_solid_var(--border-primary,_#2d3f55)] !rounded-[6px] ![color:var(--text-primary,_#e2e8f0)] !text-[length:11px] !p-[3px_6px] !cursor-pointer"
        value={cut.dayId ?? ''}
        onChange={e => onChangeDay(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Sin día</option>
        {days.map(d => <option key={d.id} value={d.id}>{dayLabel(d)}</option>)}
      </select>
      <button className="![background:none] ![border:none] !cursor-pointer !p-[2px] ![color:#ef4444] !shrink-[0]" onClick={onRemove}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// ── Step 3: summary ───────────────────────────────────────────────────────────
function Step3({ stages, days, error }: { stages: StageSummary[]; days: Day[]; error: string | null }) {
  return (
    <div className="!flex !flex-col !gap-[10px]">
      <div className="!text-[length:13px] ![color:var(--text-secondary,_#94a3b8)] !mb-[4px]">
        Revisa las etapas resultantes antes de guardar. Al confirmar se eliminarán las etapas anteriores vinculadas a este viaje.
      </div>
      {error && (
        <div className="!p-[8px_12px] !rounded-[8px] ![background:#ef444420] ![border:1px_solid_#ef4444] !text-[length:12px] ![color:#ef4444]">
          ⚠ {error}
        </div>
      )}
      {stages.map((s, i) => (
        <div className="![background:var(--bg-secondary,_#253547)] !rounded-[8px] !p-[10px_14px] !flex !items-center !gap-[14px]" key={i} style={{ border: `1px solid ${CUT_COLORS[i % CUT_COLORS.length]}40`, borderLeft: `3px solid ${CUT_COLORS[i % CUT_COLORS.length]}` }}>
          <div className="!flex-[1]">
            <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary,_#e2e8f0)] !mb-[2px]">
              {s.dayLabel}
            </div>
            <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !flex !gap-[10px]">
              <span><MapPin size={9} style={{ display: 'inline', marginRight: 2 }} />{fmtKm(s.distKm)}</span>
              {s.gainM > 0 && <span className="![color:#f97316]">↑ {s.gainM} m</span>}
              {s.lossM > 0 && <span className="![color:#38bdf8]">↓ {s.lossM} m</span>}
            </div>
          </div>
          <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !text-right !shrink-[0]">
            {s.from === 0 ? 'inicio' : `pt ${s.from}`} → {s.to === -1 ? 'fin' : `pt ${s.to}`}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Build stage summaries ────────────────────────────────────────────────────

function buildStages(points: GpxPoint[], distances: number[], cuts: CutPoint[], days: Day[]): StageSummary[] {
  if (points.length === 0) return []
  const sorted = [...cuts].sort((a, b) => a.pointIndex - b.pointIndex)
  const boundaries = [0, ...sorted.map(c => c.pointIndex), points.length - 1]
  const stages: StageSummary[] = []

  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i]
    const to   = boundaries[i + 1]
    const slice = points.slice(from, to + 1)
    const { gain, loss } = computeGainLoss(slice)
    const distKm = (distances[to] ?? 0) - (distances[from] ?? 0)

    // El dayId del corte en boundaries[i+1] define el día de ESTE segmento (el que llega a ese corte).
    // Ej: corte en Olot con Day2 → el tramo inicio→Olot es Day2.
    const cut = sorted[i] // corte que termina este segmento
    const dayId = cut?.dayId ?? null

    const day = dayId ? days.find(d => d.id === dayId) : null
    stages.push({
      from,
      to: i === boundaries.length - 2 ? -1 : to,
      dayId,
      dayLabel: day ? dayLabel(day) : `Etapa ${i + 1}`,
      distKm: Math.max(0, Math.round(distKm * 10) / 10),
      gainM: gain,
      lossM: loss,
    })
  }

  return stages
}

// ── Build polyline segments ──────────────────────────────────────────────────

function buildPolylineSegments(points: GpxPoint[], cuts: CutPoint[]) {
  if (points.length === 0) return []
  const sorted = [...cuts].sort((a, b) => a.pointIndex - b.pointIndex)
  const boundaries = [0, ...sorted.map(c => c.pointIndex), points.length - 1]
  return boundaries.slice(0, -1).map((from, i) => ({
    points: points.slice(from, boundaries[i + 1] + 1),
    color: CUT_COLORS[i % CUT_COLORS.length],
  }))
}

// ── Button styles ─────────────────────────────────────────────────────────────

function btnStyle(variant: 'primary' | 'ghost' | 'success') {
  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8, border: 'none',
    cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all .15s',
  }
  if (variant === 'primary') return { ...base, background: '#f59e0b', color: '#000' }
  if (variant === 'success') return { ...base, background: '#22d96e', color: '#000' }
  return { ...base, background: 'var(--bg-secondary, #253547)', color: 'var(--text-secondary, #94a3b8)', border: '1px solid var(--border-primary, #2d3f55)' }
}

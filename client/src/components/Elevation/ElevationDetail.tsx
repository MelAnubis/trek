/**
 * ElevationDetail.tsx
 * Módulo de elevación con IBPIndex para Trek
 * Portado desde Bikelog v22 — adaptado a TypeScript + estilo Trek
 */
import React, { useMemo, useState, useEffect, useRef } from 'react'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid, Brush, Bar,
} from 'recharts'
import { Mountain, ChevronDown, ChevronUp, Layers, RefreshCw, Download, ArrowDownToLine } from 'lucide-react'
import { mapsApi } from '../../api/client'
import { useTranslation } from '../../i18n'

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

interface WaypointMarker {
  name: string
  dist: number
  ele: number
}

interface Profile {
  data: ProfilePoint[]
  minEle: number
  maxEle: number
  totalDist: number
  gain: number
  loss: number
  maxSlope: number
  waypointMarkers: WaypointMarker[]
}

// Distancia máxima (km) para asociar un punto a otro del perfil.
// - Los waypoints grabados EN el propio GPX están literalmente sobre la
//   traza (los graba el mismo GPS que graba el track), así que un radio
//   estrecho evita enganchar POIs de otra etapa del mismo fichero.
// - Los lugares que el usuario añade al itinerario suelen marcar el centro
//   del pueblo/punto de interés, no el punto exacto de la carretera o
//   camino por el que pasa la ruta (que a menudo bordea la población) — un
//   radio más amplio es necesario para que sigan enganchando.
const WAYPOINT_MAX_DIST_KM = 0.3
const PLACE_MAX_DIST_KM = 2

// Para cada punto de una lista, busca el más cercano del perfil dentro del
// radio dado y devuelve el marcador candidato correspondiente.
function projectCandidates(
  data: ProfilePoint[],
  points: { lat: number; lng: number; name: string }[] | undefined,
  maxDistKm: number,
): WaypointMarker[] {
  if (!points || points.length === 0 || data.length === 0) return []
  const markers: WaypointMarker[] = []
  for (const wp of points) {
    if (!wp.name || wp.lat == null || wp.lng == null) continue
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < data.length; i++) {
      const d = haversineKm(wp.lat, wp.lng, data[i].lat, data[i].lng)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    if (bestDist <= maxDistKm) {
      markers.push({ name: wp.name, dist: data[bestIdx].dist, ele: data[bestIdx].ele })
    }
  }
  return markers
}

// Combina candidatos de varias fuentes y evita etiquetas duplicadas casi en
// el mismo km (p.ej. un waypoint del GPX y un lugar del itinerario con el
// mismo nombre, cerca uno de otro).
function dedupeMarkers(markers: WaypointMarker[]): WaypointMarker[] {
  const sorted = [...markers].sort((a, b) => a.dist - b.dist)
  const deduped: WaypointMarker[] = []
  for (const m of sorted) {
    const prev = deduped[deduped.length - 1]
    if (prev && Math.abs(prev.dist - m.dist) < 0.15 && prev.name === m.name) continue
    deduped.push(m)
  }
  return deduped
}

interface PeakCandidate { dist: number; ele: number; lat: number; lng: number }

// Detecta los picos/collados más significativos del perfil (prominencia
// mínima real, no un simple máximo local de ruido) para poder nombrarlos
// aunque no haya ningún waypoint ni lugar del itinerario cerca — p.ej. un
// puerto de montaña que el usuario no ha añadido a su plan.
function detectPeaks(data: ProfilePoint[], minProminenceM = 80, minSpacingKm = 2, maxPeaks = 3): PeakCandidate[] {
  if (data.length < 5) return []
  const candidates: { idx: number; prominence: number }[] = []
  for (let i = 2; i < data.length - 2; i++) {
    const e = data[i].ele
    if (e < data[i - 1].ele || e < data[i + 1].ele || e <= data[i - 2].ele || e <= data[i + 2].ele) continue
    let leftMin = e
    for (let j = i - 1; j >= 0; j--) {
      leftMin = Math.min(leftMin, data[j].ele)
      if (e - leftMin >= minProminenceM) break
    }
    let rightMin = e
    for (let j = i + 1; j < data.length; j++) {
      rightMin = Math.min(rightMin, data[j].ele)
      if (e - rightMin >= minProminenceM) break
    }
    const prominence = Math.min(e - leftMin, e - rightMin)
    if (prominence >= minProminenceM) candidates.push({ idx: i, prominence })
  }
  candidates.sort((a, b) => b.prominence - a.prominence)
  const picked: typeof candidates = []
  for (const c of candidates) {
    if (picked.some(p => Math.abs(data[p.idx].dist - data[c.idx].dist) < minSpacingKm)) continue
    picked.push(c)
    if (picked.length >= maxPeaks) break
  }
  return picked
    .sort((a, b) => data[a.idx].dist - data[b.idx].dist)
    .map(p => ({ dist: data[p.idx].dist, ele: data[p.idx].ele, lat: data[p.idx].lat, lng: data[p.idx].lng }))
}

function buildProfile(track: GpxTrack, tripPlaces?: { lat: number | null; lng: number | null; name: string }[]): Profile | null {
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

  // Max slope: true max of the already-smoothed (200 m window) slopes.
  // The distance-based smoothing above already removes GPS noise, so clipping
  // further to a percentile would make "Pend. máx." read lower than a slope
  // value shown for an individual point in the same chart.
  const absSlopes = data.map(d => Math.abs(d.slope))
  const maxSlope = absSlopes.length > 0 ? Math.round(Math.max(...absSlopes)) : 0

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

  const geoTripPlaces = (tripPlaces || [])
    .filter((p): p is { lat: number; lng: number; name: string } => p.lat != null && p.lng != null && !!p.name)
  const waypointMarkers = dedupeMarkers([
    ...projectCandidates(data, track.waypoints, WAYPOINT_MAX_DIST_KM),
    ...projectCandidates(data, geoTripPlaces, PLACE_MAX_DIST_KM),
  ])

  return {
    data,
    minEle:    Math.min(...eles),
    maxEle:    Math.max(...eles),
    totalDist: data[data.length - 1]?.dist || 0,
    gain,
    loss,
    maxSlope,
    waypointMarkers,
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
  waypoints?: { lat: number; lng: number; name: string }[]
}

interface ElevationDetailProps {
  tracks: GpxTrack[]
  tripId?: number | string
  onIbpUpdated?: (trackId: number, ibp: number) => void
  onTrackUpdated?: (track: GpxTrack) => void
  // Places already added to the trip's itinerary — used as an extra source of
  // markers on the elevation chart (town/viewpoint names) for GPX files that
  // don't carry their own named <wpt> waypoints, which is most of them.
  places?: { lat: number | null; lng: number | null; name: string }[]
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
  onTrackUpdated,
  places,
}: {
  track: GpxTrack
  color: string
  expanded: boolean
  onToggle: () => void
  fitness: number
  tripId?: number | string
  onIbpUpdated?: (trackId: number, ibp: number) => void
  onTrackUpdated?: (track: GpxTrack) => void
  places?: { lat: number | null; lng: number | null; name: string }[]
}) {
  const profile = useMemo(() => buildProfile(track, places), [track.id, track.total_elevation_gain, (track.points || []).length, (track.waypoints || []).length, places])
  const [recalculating, setRecalculating] = useState(false)
  const [fetchingEle, setFetchingEle] = useState(false)
  const [autoPeakMarkers, setAutoPeakMarkers] = useState<WaypointMarker[]>([])
  const { language } = useTranslation()
  const chartWrapRef = useRef<HTMLDivElement>(null)
  const [chartContainerWidth, setChartContainerWidth] = useState(600)

  // El ancho del contenedor real (para que el gráfico llene el espacio
  // disponible cuando no hace falta más, y solo se ensanche —con scroll
  // horizontal— cuando hay muchos hitos que necesitan más espacio para
  // leerse sin solaparse).
  useEffect(() => {
    const el = chartWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setChartContainerWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Nombra automáticamente los picos/puertos más prominentes del track,
  // aunque no estén añadidos como lugar del itinerario ni como waypoint del
  // GPX — vía geocoding inverso (OpenStreetMap/Nominatim, sin API key).
  // Secuencial con pausa entre peticiones para respetar el límite de uso
  // de Nominatim (máx. ~1 req/s).
  useEffect(() => {
    setAutoPeakMarkers([])
    if (!profile) return
    const existingDists = profile.waypointMarkers.map(w => w.dist)
    const peaks = detectPeaks(profile.data).filter(p => !existingDists.some(d => Math.abs(d - p.dist) < 1.5))
    if (peaks.length === 0) return
    let cancelled = false
    void (async () => {
      const found: WaypointMarker[] = []
      for (const peak of peaks) {
        if (cancelled) return
        try {
          const res = await mapsApi.reverse(peak.lat, peak.lng, language)
          if (res?.name) found.push({ name: res.name, dist: peak.dist, ele: peak.ele })
        } catch { /* ignore — sin nombre para este pico */ }
        if (!cancelled) setAutoPeakMarkers([...found])
        await new Promise(r => setTimeout(r, 1100))
      }
    })()
    return () => { cancelled = true }
  }, [track.id, profile?.data.length])

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

  const handleFetchElevation = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!tripId || fetchingEle) return
    setFetchingEle(true)
    try {
      const r = await fetch(`/api/trips/${tripId}/gpx/${track.id}/fetch-elevation`, {
        method: 'POST', credentials: 'include',
      })
      if (r.ok) {
        const updated = await r.json()
        onTrackUpdated?.({ ...updated, points: updated.points })
      }
    } catch { /* ignore */ }
    setFetchingEle(false)
  }

  if (!profile) {
    const hasPoints = (track.points?.length || 0) > 0
    return (
      <div style={{
        border: '1px solid var(--border-primary, #2d3f55)',
        borderRadius: 10, marginBottom: 10, overflow: 'hidden',
        background: 'var(--bg-primary, #1e2a3a)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary, #e2e8f0)', marginBottom: 2 }}>
              {track.track_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #64748b)' }}>
              {track.total_distance ? `${Math.round(track.total_distance * 10) / 10} km` : ''}
              {hasPoints
                ? ' · Sin datos de altitud'
                : ' · Sin puntos GPS cargados'}
            </div>
          </div>
          {hasPoints && tripId && (
            <button
              onClick={handleFetchElevation}
              disabled={fetchingEle}
              title="Obtener altitudes"
              style={{ background: 'none', border: 'none', cursor: fetchingEle ? 'wait' : 'pointer', padding: 4, color: 'var(--text-tertiary)', flexShrink: 0, opacity: fetchingEle ? 0.5 : 1 }}
            >
              <ArrowDownToLine size={14} style={fetchingEle ? { animation: 'spin 1s linear infinite' } : {}} />
            </button>
          )}
          {hasPoints && (
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
        </div>
      </div>
    )
  }

  const { data, minEle, maxEle, totalDist, gain, loss, maxSlope, waypointMarkers: baseWaypointMarkers } = profile
  const waypointMarkers = dedupeMarkers([...baseWaypointMarkers, ...autoPeakMarkers])
  const ibpOfficial = track.ibp != null
  const ibp = ibpOfficial ? track.ibp! : calcIBP(totalDist, gain, maxSlope)
  const cat = ibpCategory(ibp, fitness)

  const distStep = totalDist > 50 ? 10 : totalDist > 20 ? 5 : totalDist > 10 ? 2 : 1
  const distTicks: number[] = []
  for (let k = 0; k <= totalDist; k += distStep) distTicks.push(Math.round(k * 10) / 10)

  // Ancho del gráfico: llena el contenedor normalmente, pero se ensancha
  // (con scroll horizontal) cuando hay hitos que necesitan más separación
  // entre sí para leerse sin solaparse. Combinado con las filas alternas de
  // las etiquetas (más abajo), da margen incluso cuando dos hitos caen a
  // pocos km de distancia.
  const PX_PER_KM = waypointMarkers.length > 1 ? 30 : 14
  const chartWidth = Math.max(chartContainerWidth, Math.round(totalDist * PX_PER_KM))

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
        {track.points && track.points.length > 0 && tripId && (
          <button
            onClick={handleFetchElevation}
            disabled={fetchingEle}
            title="Volver a obtener altitudes"
            style={{ background: 'none', border: 'none', cursor: fetchingEle ? 'wait' : 'pointer', padding: 4, color: 'var(--text-tertiary)', flexShrink: 0, opacity: fetchingEle ? 0.5 : 1 }}
          >
            <ArrowDownToLine size={14} style={fetchingEle ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
        )}
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
          <div ref={chartWrapRef} style={{ height: 220, marginBottom: 12, overflowX: 'auto', overflowY: 'hidden' }}>
            <ComposedChart width={chartWidth} height={220} data={data} margin={{ top: waypointMarkers.length > 0 ? 36 : 5, right: 10, left: 0, bottom: 5 }}>
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
                {waypointMarkers.map((w, i) => (
                  <ReferenceLine
                    key={`${w.name}-${i}`}
                    yAxisId="ele"
                    x={w.dist}
                    stroke="#a78bfa"
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                    label={(props: any) => {
                      const { viewBox } = props
                      if (!viewBox) return <g />
                      // Filas alternas: dos hitos próximos entre sí no caen en la
                      // misma línea de texto, así no se solapan aunque el punto
                      // esté a pocos km de distancia.
                      const row = i % 2
                      const y = viewBox.y + (row === 0 ? 10 : 24)
                      const label = w.name.length > 22 ? w.name.slice(0, 21) + '…' : w.name
                      return (
                        <text x={viewBox.x} y={y} fontSize={9} fontWeight={600} fill="#a78bfa" textAnchor="middle">
                          {label}
                        </text>
                      )
                    }}
                  />
                ))}
              </ComposedChart>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary, #64748b)', textAlign: 'center', marginTop: -8, marginBottom: 4 }}>
            {waypointMarkers.length > 0 && chartWidth > chartContainerWidth ? '← desliza para ver todo el gráfico →' : null}
          </div>

          {/* IBP table */}
          <IBPTableLegend ibp={ibp} fitness={fitness} />
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ElevationDetail({ tracks, tripId, onIbpUpdated, onTrackUpdated, places }: ElevationDetailProps) {
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
          onTrackUpdated={onTrackUpdated}
          places={places}
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

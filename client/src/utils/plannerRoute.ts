/**
 * plannerRoute.ts — Lógica pura del planificador de rutas (/planner).
 *
 * Sin dependencias de React ni del DOM salvo `parseRouteFile` (DOMParser).
 * Cubre: lectura de GPX/KML, simplificación, estadísticas de desnivel,
 * división en etapas, búsqueda del punto más cercano de la ruta y
 * generación de GPX (ruta completa o por etapa) con waypoints.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface RoutePoint { lat: number; lng: number; ele: number | null }

/** Formato compacto guardado en el servidor: [lat, lng, ele]. */
export type CompactPoint = [number, number, number | null]

export interface PlannerWaypoint {
  id: string
  name: string
  lat: number
  lng: number
  ele: number | null
  /** Clave de PLANNER_CATEGORIES o 'generic'. */
  type: string
  note?: string
  osm_id?: string
}

export interface Cut {
  index: number
  name?: string
  /** true si el corte está en un sitio con alojamiento; false si no se encontró; sin definir si no se ha comprobado. */
  lodged?: boolean
  /** Km que se movió respecto al corte ideal al ajustarlo a un alojamiento (positivo = etapa más larga). */
  shiftKm?: number
}

export interface PlannerSettings {
  /** Km objetivo por etapa usados por última vez en la división automática. */
  stageKm?: number
  /** Radio de búsqueda de servicios, en metros. */
  poiRadiusM?: number
  /** Nombre personalizado de la primera etapa (las demás lo guardan en el corte que las abre). */
  firstStageName?: string
}

export interface PlannerRouteSummary {
  id: number
  name: string
  orig_name: string | null
  total_distance_km: number
  elevation_gain: number
  elevation_loss: number
  point_count: number
  stage_count: number
  folder: string | null
  favorite: boolean
  /** ~100 puntos [lat, lng] para la miniatura. */
  preview: [number, number][]
  created_at: string
  updated_at: string
}

export interface LibraryFolder { name: string; count: number }

export interface LibraryResponse {
  routes: PlannerRouteSummary[]
  total: number
  page: number
  pages: number
  limit: number
  folders: LibraryFolder[]
  totals: { all: number; favorites: number; unfiled: number }
}

export interface OverviewRoute {
  id: number
  name: string
  total_distance_km: number
  elevation_gain: number
  folder: string | null
  favorite: boolean
  preview: [number, number][]
}

export interface PlannerRouteFull extends PlannerRouteSummary {
  points: CompactPoint[]
  cuts: Cut[]
  waypoints: PlannerWaypoint[]
  settings: PlannerSettings
}

export interface Stage {
  /** Índice del primer punto (inclusive). */
  from: number
  /** Índice del último punto (inclusive; coincide con el primero de la etapa siguiente). */
  to: number
  startKm: number
  endKm: number
  distKm: number
  gain: number
  loss: number
  minEle: number | null
  maxEle: number | null
  name: string
  /** Información del corte con el que termina esta etapa (la última etapa no tiene). */
  endLodged?: boolean
  endShiftKm?: number
}

export interface ParsedRoute {
  name: string
  points: RoutePoint[]
  waypoints: PlannerWaypoint[]
}

// ── Categorías de servicios para cicloturistas ───────────────────────────────

export interface PlannerCategory { key: string; emoji: string; color: string }

/** `key` es el contrato con el servidor (CATEGORY_OSM_FILTERS en mapsService.ts). */
export const PLANNER_CATEGORIES: PlannerCategory[] = [
  { key: 'water', emoji: '💧', color: '#0ea5e9' },
  { key: 'hotel', emoji: '🛏️', color: '#2563eb' },
  { key: 'camping', emoji: '⛺', color: '#16a34a' },
  { key: 'supermarket', emoji: '🛒', color: '#f59e0b' },
  { key: 'restaurant', emoji: '🍴', color: '#ef4444' },
  { key: 'cafe', emoji: '☕', color: '#b45309' },
  { key: 'bike_shop', emoji: '🔧', color: '#7c3aed' },
  { key: 'bike_repair', emoji: '🛠️', color: '#8b5cf6' },
  { key: 'station', emoji: '🚉', color: '#475569' },
]

export const CATEGORY_BY_KEY: Record<string, PlannerCategory> =
  Object.fromEntries(PLANNER_CATEGORIES.map(c => [c.key, c]))

export const GENERIC_WAYPOINT = { emoji: '📍', color: '#e11d48' }

// ── Geometría básica ─────────────────────────────────────────────────────────

export function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Distancia acumulada en km para cada punto (cum[0] = 0). */
export function cumulativeKm(points: RoutePoint[]): number[] {
  const cum: number[] = new Array(points.length)
  if (points.length) cum[0] = 0
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng) / 1000
  }
  return cum
}

export function toCompact(points: RoutePoint[]): CompactPoint[] {
  return points.map(p => [p.lat, p.lng, p.ele])
}

export function fromCompact(points: CompactPoint[]): RoutePoint[] {
  return points.map(p => ({ lat: p[0], lng: p[1], ele: p[2] ?? null }))
}

/**
 * Reduce el número de puntos: descarta los que están a menos de `minDistM` del
 * último conservado (siempre se conserva el último punto) y, si aun así hay más
 * de `maxPoints`, hace un muestreo uniforme. Redondea coordenadas (5 decimales,
 * ~1 m) y altitud (0,1 m) para que el JSON guardado pese poco.
 */
export function simplifyPoints(points: RoutePoint[], minDistM = 5, maxPoints = 20000): RoutePoint[] {
  if (points.length <= 2) return points.map(roundPoint)
  const kept: RoutePoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const last = kept[kept.length - 1]
    if (haversineM(last.lat, last.lng, points[i].lat, points[i].lng) >= minDistM) kept.push(points[i])
  }
  kept.push(points[points.length - 1])
  let out = kept
  if (out.length > maxPoints) {
    const step = (out.length - 1) / (maxPoints - 1)
    const sampled: RoutePoint[] = []
    for (let k = 0; k < maxPoints - 1; k++) sampled.push(out[Math.round(k * step)])
    sampled.push(out[out.length - 1])
    out = sampled
  }
  return out.map(roundPoint)
}

function roundPoint(p: RoutePoint): RoutePoint {
  return {
    lat: Math.round(p.lat * 1e5) / 1e5,
    lng: Math.round(p.lng * 1e5) / 1e5,
    ele: p.ele == null ? null : Math.round(p.ele * 10) / 10,
  }
}

/**
 * Douglas-Peucker iterativo sobre una proyección plana local. Devuelve a lo sumo
 * `maxPts` puntos [lat, lng] que mantienen la forma de la ruta; sirve para
 * consultar servicios a lo largo de un tramo sin enviar miles de puntos.
 */
export function simplifyLine(points: RoutePoint[], maxPts = 300): [number, number][] {
  const n = points.length
  if (n <= maxPts) return points.map(p => [p.lat, p.lng] as [number, number])
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / n
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180)
  const ky = 110540
  const X = points.map(p => p.lng * kx)
  const Y = points.map(p => p.lat * ky)

  const segDist = (i: number, a: number, b: number): number => {
    const dx = X[b] - X[a], dy = Y[b] - Y[a]
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(X[i] - X[a], Y[i] - Y[a])
    const t = Math.max(0, Math.min(1, ((X[i] - X[a]) * dx + (Y[i] - Y[a]) * dy) / len2))
    return Math.hypot(X[i] - (X[a] + t * dx), Y[i] - (Y[a] + t * dy))
  }

  // Prioridad: siempre se subdivide primero el segmento con mayor desviación,
  // hasta alcanzar maxPts. Evita tener que adivinar una tolerancia.
  type Seg = { a: number; b: number; far: number; d: number }
  const farthest = (a: number, b: number): Seg => {
    let far = -1, d = -1
    for (let i = a + 1; i < b; i++) {
      const di = segDist(i, a, b)
      if (di > d) { d = di; far = i }
    }
    return { a, b, far, d }
  }
  const keep = new Set<number>([0, n - 1])
  const segs: Seg[] = [farthest(0, n - 1)]
  while (keep.size < maxPts) {
    let bi = -1, bd = 0
    for (let k = 0; k < segs.length; k++) if (segs[k].far >= 0 && segs[k].d > bd) { bd = segs[k].d; bi = k }
    if (bi < 0) break
    const s = segs.splice(bi, 1)[0]
    keep.add(s.far)
    segs.push(farthest(s.a, s.far), farthest(s.far, s.b))
  }
  return [...keep].sort((a, b) => a - b).map(i => [points[i].lat, points[i].lng] as [number, number])
}

// ── Elevación ────────────────────────────────────────────────────────────────

/** Rellena huecos de altitud por interpolación lineal. Todo null → todo null. */
function fillElevation(points: RoutePoint[]): (number | null)[] {
  const n = points.length
  const out: (number | null)[] = points.map(p => p.ele)
  let first = -1
  for (let i = 0; i < n; i++) if (out[i] != null) { first = i; break }
  if (first < 0) return out
  for (let i = 0; i < first; i++) out[i] = out[first]
  let prev = first
  for (let i = first + 1; i < n; i++) {
    if (out[i] == null) continue
    if (i - prev > 1) {
      const a = out[prev] as number, b = out[i] as number
      for (let j = prev + 1; j < i; j++) out[j] = a + (b - a) * (j - prev) / (i - prev)
    }
    prev = i
  }
  for (let i = prev + 1; i < n; i++) out[i] = out[prev]
  return out
}

/**
 * Altitud suavizada con media móvil por distancia (±`halfWindowM` metros).
 * El GPS/barómetro mete ruido que inflaría el desnivel acumulado.
 */
export function smoothElevation(points: RoutePoint[], cum: number[], halfWindowM = 75): (number | null)[] {
  const filled = fillElevation(points)
  if (filled.every(v => v == null)) return filled
  const n = points.length
  const prefix = new Array<number>(n + 1).fill(0)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (filled[i] as number)
  const half = halfWindowM / 1000
  const out: (number | null)[] = new Array(n)
  let lo = 0, hi = 0
  for (let i = 0; i < n; i++) {
    while (cum[i] - cum[lo] > half) lo++
    if (hi < i) hi = i
    while (hi + 1 < n && cum[hi + 1] - cum[i] <= half) hi++
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
  }
  return out
}

/** Desnivel positivo/negativo acumulado con histéresis (ignora oscilaciones < threshold). */
export function gainLoss(smoothed: (number | null)[], from: number, to: number, threshold = 3): { gain: number; loss: number } {
  let gain = 0, loss = 0
  let ref: number | null = null
  for (let i = from; i <= to; i++) {
    const e = smoothed[i]
    if (e == null) continue
    if (ref === null) { ref = e; continue }
    const d = e - ref
    if (d >= threshold) { gain += d; ref = e }
    else if (d <= -threshold) { loss += -d; ref = e }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) }
}

export function routeStats(smoothed: (number | null)[], cum: number[]) {
  const n = cum.length
  const { gain, loss } = n ? gainLoss(smoothed, 0, n - 1) : { gain: 0, loss: 0 }
  const vals = smoothed.filter((v): v is number => v != null)
  return {
    distKm: n ? cum[n - 1] : 0,
    gain, loss,
    minEle: vals.length ? Math.round(Math.min(...vals)) : null,
    maxEle: vals.length ? Math.round(Math.max(...vals)) : null,
  }
}

// ── Etapas ───────────────────────────────────────────────────────────────────

/** Normaliza cortes: ordenados, sin duplicados y dentro de (0, n-1). */
export function normalizeCuts(cuts: Cut[], pointCount: number): Cut[] {
  const seen = new Set<number>()
  return cuts
    .filter(c => Number.isInteger(c.index) && c.index > 0 && c.index < pointCount - 1)
    .sort((a, b) => a.index - b.index)
    .filter(c => (seen.has(c.index) ? false : (seen.add(c.index), true)))
}

export function buildStages(
  cum: number[], smoothed: (number | null)[], cuts: Cut[], defaultName: (i: number) => string,
): Stage[] {
  const n = cum.length
  if (n < 2) return []
  const norm = normalizeCuts(cuts, n)
  const bounds = [0, ...norm.map(c => c.index), n - 1]
  const stages: Stage[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i], to = bounds[i + 1]
    const { gain, loss } = gainLoss(smoothed, from, to)
    let min: number | null = null, max: number | null = null
    for (let k = from; k <= to; k++) {
      const e = smoothed[k]
      if (e == null) continue
      if (min == null || e < min) min = e
      if (max == null || e > max) max = e
    }
    // El nombre de la etapa i lo guarda el corte que la abre (la primera usa el nombre por defecto).
    const named = i > 0 ? norm[i - 1].name : undefined
    stages.push({
      from, to,
      startKm: cum[from], endKm: cum[to], distKm: cum[to] - cum[from],
      gain, loss,
      minEle: min == null ? null : Math.round(min), maxEle: max == null ? null : Math.round(max),
      name: named || defaultName(i),
      ...(i < norm.length ? { endLodged: norm[i].lodged, endShiftKm: norm[i].shiftKm } : {}),
    })
  }
  return stages
}

/** Índice del punto cuya distancia acumulada es la más cercana a `km` (búsqueda binaria). */
export function indexAtKm(cum: number[], km: number): number {
  let lo = 0, hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < km) lo = mid + 1; else hi = mid
  }
  if (lo > 0 && Math.abs(cum[lo - 1] - km) <= Math.abs(cum[lo] - km)) return lo - 1
  return lo
}

/**
 * División automática en etapas iguales: nº de etapas = round(total / stageKm),
 * así la última etapa no queda ridículamente corta.
 */
export function autoSplit(cum: number[], stageKm: number): Cut[] {
  const n = cum.length
  if (n < 3 || !(stageKm > 0)) return []
  const total = cum[n - 1]
  const count = Math.max(1, Math.round(total / stageKm))
  const cuts: Cut[] = []
  for (let k = 1; k < count; k++) cuts.push({ index: indexAtKm(cum, (total * k) / count) })
  return normalizeCuts(cuts, n)
}

// ── Punto más cercano de la ruta ─────────────────────────────────────────────

export interface NearestResult { index: number; distM: number; km: number }

/** Punto de la ruta más cercano a (lat, lng). Aproximación plana, O(n). */
export function nearestOnRoute(points: RoutePoint[], cum: number[], lat: number, lng: number): NearestResult {
  const kx = Math.cos(lat * Math.PI / 180)
  let best = 0, bestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const dy = points[i].lat - lat
    const dx = (points[i].lng - lng) * kx
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = i }
  }
  return {
    index: best,
    distM: haversineM(points[best].lat, points[best].lng, lat, lng),
    km: cum[best],
  }
}

/** Etapa (posición en el array) que contiene el índice de punto dado. */
export function stageIndexOfPoint(stages: Stage[], pointIndex: number): number {
  for (let i = 0; i < stages.length; i++) {
    const last = i === stages.length - 1
    if (pointIndex >= stages[i].from && (last ? pointIndex <= stages[i].to : pointIndex < stages[i].to)) return i
  }
  return Math.max(0, stages.length - 1)
}

// ── Lectura de GPX / KML ─────────────────────────────────────────────────────

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim()
}

function childrenByLocalName(parent: Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter(e => e.localName === name)
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function validCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

export function parseRouteFile(text: string, filename: string): ParsedRoute {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('invalid-xml')
  const root = doc.documentElement
  const baseName = filename.replace(/\.[^.]+$/, '')
  const lower = root.localName.toLowerCase()
  if (lower === 'gpx') return parseGpx(doc, baseName)
  if (lower === 'kml') return parseKml(doc, baseName)
  throw new Error('unsupported-format')
}

function parseGpx(doc: Document, baseName: string): ParsedRoute {
  const all = Array.from(doc.getElementsByTagName('*'))
  const pts: RoutePoint[] = []
  const pushPt = (el: Element) => {
    const lat = parseFloat(el.getAttribute('lat') ?? '')
    const lng = parseFloat(el.getAttribute('lon') ?? '')
    if (!validCoord(lat, lng)) return
    const eleStr = textOf(Array.from(el.children).find(c => c.localName === 'ele'))
    const ele = eleStr === '' ? NaN : parseFloat(eleStr)
    pts.push({ lat, lng, ele: Number.isFinite(ele) ? ele : null })
  }
  const trkpts = all.filter(e => e.localName === 'trkpt')
  if (trkpts.length) trkpts.forEach(pushPt)
  else all.filter(e => e.localName === 'rtept').forEach(pushPt)

  const waypoints: PlannerWaypoint[] = []
  for (const w of all.filter(e => e.localName === 'wpt')) {
    const lat = parseFloat(w.getAttribute('lat') ?? '')
    const lng = parseFloat(w.getAttribute('lon') ?? '')
    if (!validCoord(lat, lng)) continue
    const eleStr = textOf(Array.from(w.children).find(c => c.localName === 'ele'))
    const ele = eleStr === '' ? NaN : parseFloat(eleStr)
    waypoints.push({
      id: uid(),
      name: textOf(Array.from(w.children).find(c => c.localName === 'name')),
      lat, lng, ele: Number.isFinite(ele) ? ele : null,
      type: 'generic',
    })
  }

  const trkName = textOf(Array.from(doc.getElementsByTagName('*')).find(e => e.localName === 'trk')
    ?.getElementsByTagName('name')[0])
  const metaName = textOf(Array.from(doc.getElementsByTagName('*')).find(e => e.localName === 'metadata')
    ?.getElementsByTagName('name')[0])
  return { name: trkName || metaName || baseName, points: pts, waypoints }
}

function parseKml(doc: Document, baseName: string): ParsedRoute {
  const pts: RoutePoint[] = []
  const waypoints: PlannerWaypoint[] = []
  const parseCoords = (s: string): RoutePoint[] => {
    const out: RoutePoint[] = []
    for (const tuple of s.split(/\s+/)) {
      if (!tuple) continue
      const [lo, la, el] = tuple.split(',').map(parseFloat)
      if (!validCoord(la, lo)) continue
      out.push({ lat: la, lng: lo, ele: Number.isFinite(el) ? el : null })
    }
    return out
  }
  const placemarks = Array.from(doc.getElementsByTagName('*')).filter(e => e.localName === 'Placemark')
  let firstLineName = ''
  for (const pm of placemarks) {
    const name = textOf(Array.from(pm.children).find(c => c.localName === 'name'))
    const lines = childrenByLocalName(pm, 'LineString')
    if (lines.length) {
      if (!firstLineName) firstLineName = name
      for (const ls of lines) {
        const c = Array.from(ls.children).find(x => x.localName === 'coordinates')
        pts.push(...parseCoords(textOf(c)))
      }
      continue
    }
    const points = childrenByLocalName(pm, 'Point')
    for (const p of points) {
      const c = Array.from(p.children).find(x => x.localName === 'coordinates')
      const [wp] = parseCoords(textOf(c))
      if (wp) waypoints.push({ id: uid(), name, lat: wp.lat, lng: wp.lng, ele: wp.ele, type: 'generic' })
    }
  }
  const docName = textOf(Array.from(doc.getElementsByTagName('*')).find(e => e.localName === 'Document')
    ?.getElementsByTagName('name')[0])
  return { name: firstLineName || docName || baseName, points: pts, waypoints }
}

// ── Generación de GPX ────────────────────────────────────────────────────────

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** GPX 1.1 con un <trk> y los waypoints dados. */
export function buildGpx(opts: { name: string; points: RoutePoint[]; waypoints: PlannerWaypoint[] }): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trek Wanderer" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xmlEscape(opts.name)}</name></metadata>`,
  ]
  for (const w of opts.waypoints) {
    const ele = w.ele != null ? `<ele>${w.ele}</ele>` : ''
    const name = w.name || w.type
    const desc = w.note ? `<desc>${xmlEscape(w.note)}</desc>` : ''
    lines.push(`  <wpt lat="${w.lat}" lon="${w.lng}">${ele}<name>${xmlEscape(name)}</name>${desc}<type>${xmlEscape(w.type)}</type></wpt>`)
  }
  lines.push(`  <trk><name>${xmlEscape(opts.name)}</name><trkseg>`)
  for (const p of opts.points) {
    lines.push(`    <trkpt lat="${p.lat}" lon="${p.lng}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}</trkpt>`)
  }
  lines.push('  </trkseg></trk>', '</gpx>')
  return lines.join('\n')
}

/** Waypoints que caen dentro de la etapa dada (por su punto de ruta más cercano). */
export function waypointsForStage(
  points: RoutePoint[], cum: number[], stages: Stage[], stageIdx: number, waypoints: PlannerWaypoint[],
): PlannerWaypoint[] {
  return waypoints.filter(w => {
    const near = nearestOnRoute(points, cum, w.lat, w.lng)
    return stageIndexOfPoint(stages, near.index) === stageIdx
  })
}

export function buildStageGpx(
  routeName: string, points: RoutePoint[], cum: number[], stages: Stage[], stageIdx: number,
  waypoints: PlannerWaypoint[],
): string {
  const st = stages[stageIdx]
  return buildGpx({
    name: `${routeName} — ${st.name}`,
    points: points.slice(st.from, st.to + 1),
    waypoints: waypointsForStage(points, cum, stages, stageIdx, waypoints),
  })
}

export function safeFileName(s: string): string {
  const cleaned = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return (cleaned || 'ruta').slice(0, 80)
}

export function fmtKm(km: number): string {
  return km >= 100 ? `${Math.round(km)} km` : `${(Math.round(km * 10) / 10).toString().replace('.', ',')} km`
}

export function newWaypointId(): string { return uid() }

// Las etapas de una excursión de varios días (MDT-01/02 de liketrek/TREK v5, stages/tourStages.ts):
// leídas de los puntos en orden, medidas sobre la línea de la excursión entera.
import { computeTourMetrics, hikingTimeMinutes, runMinutesAtPace, type GeometryPoint } from './core'
import type { TourType } from './toursApi'

interface StagePoint { lat: number; lng: number; stage_end?: boolean; shaping?: boolean; name?: string | null }

export interface StageSpan { number: number; from: number; to: number }

export interface TourStage extends StageSpan {
  distanceKm: number | null
  gain: number | null
  loss: number | null
  /** Moving time, breaks left out. */
  minutes: number | null
  /** Where the stage starts and ends along the whole route, in metres. */
  fromM: number | null
  toM: number | null
  /** The vertices of the line the stage runs over, for its GPX. */
  fromVertex: number | null
  toVertex: number | null
}

/** The stages in route order; none before the tour has two points, one for a day tour. */
export function stageSpansOf(points: readonly Pick<StagePoint, 'stage_end'>[]): StageSpan[] {
  if (points.length < 2) return []
  const last = points.length - 1
  const spans: StageSpan[] = []
  let from = 0
  points.forEach((point, index) => {
    if (!point.stage_end || index === 0 || index === last) return
    spans.push({ number: spans.length + 1, from, to: index })
    from = index
  })
  spans.push({ number: spans.length + 1, from, to: last })
  return spans
}

const METRES_PER_DEGREE = 111_320
/** A route that comes by a point twice (out and back) places it where it gets there first. */
const PASS_TOLERANCE_M = 30

function metresFrom(vertex: readonly number[], lat: number, lng: number): number {
  const x = ((vertex[1] ?? 0) - lng) * Math.cos((lat * Math.PI) / 180)
  const y = (vertex[0] ?? 0) - lat
  return Math.hypot(x, y) * METRES_PER_DEGREE
}

/** The vertex of the line each point lies at, searching on from where the one before lay. */
export function vertexIndicesOf(points: ReadonlyArray<{ lat: number; lng: number }>, line: ReadonlyArray<readonly number[]>): number[] {
  const indices: number[] = []
  let from = 0
  for (const point of points) {
    let nearest = Infinity
    for (let i = from; i < line.length; i++) nearest = Math.min(nearest, metresFrom(line[i], point.lat, point.lng))
    let index = from
    for (let i = from; i < line.length; i++) {
      if (metresFrom(line[i], point.lat, point.lng) <= nearest + PASS_TOLERANCE_M) { index = i; break }
    }
    indices.push(index)
    from = index
  }
  return indices
}

export interface TourStageInputs {
  points: readonly StagePoint[]
  line: ReadonlyArray<readonly number[]> | null
  tourType: TourType
  /** The router's time for the whole tour, seconds. */
  routerSeconds: number | null
  runPaceSecondsPerKm: number | null
}

/**
 * The stages with what each measures, by the tour's own rule: a hike by DIN 33466
 * over its distance and heights, a run at the runner's pace, a bike tour the
 * router's time shared out by distance.
 */
export function tourStagesOf(input: TourStageInputs): TourStage[] {
  const spans = stageSpansOf(input.points)
  const blank = (s: StageSpan): TourStage => ({ ...s, distanceKm: null, gain: null, loss: null, minutes: null, fromM: null, toM: null, fromVertex: null, toVertex: null })
  const { line, points } = input
  if (!line || line.length < 2 || spans.length === 0) return spans.map(blank)
  const at = vertexIndicesOf(points, line)
  const heights = line.every(v => v.length >= 3 && Number.isFinite(v[2]))
  const stretches = spans.map(s => {
    const from = at[s.from], to = at[s.to]
    const m = to > from ? computeTourMetrics(line.slice(from, to + 1) as GeometryPoint[]) : null
    return { distanceKm: m?.distanceKm ?? 0, gain: heights ? (m?.elevationGainM ?? 0) : null, loss: heights ? (m?.elevationLossM ?? 0) : null, from, to }
  })
  const totalKm = stretches.reduce((a, s) => a + s.distanceKm, 0)
  let travelled = 0
  return spans.map((span, i) => {
    const s = stretches[i]
    let minutes: number | null = null
    if (input.tourType === 'run') minutes = input.runPaceSecondsPerKm ? runMinutesAtPace(s.distanceKm, input.runPaceSecondsPerKm) : null
    else if (input.tourType === 'hike' && s.gain !== null && s.loss !== null) minutes = hikingTimeMinutes(s.distanceKm, s.gain, s.loss)
    else if (input.routerSeconds !== null && totalKm > 0) minutes = Math.round((input.routerSeconds / 60) * (s.distanceKm / totalKm))
    const fromM = travelled
    travelled += s.distanceKm * 1000
    return { ...span, distanceKm: s.distanceKm, gain: s.gain, loss: s.loss, minutes, fromM, toM: travelled, fromVertex: s.from, toVertex: s.to }
  })
}

/** Where every stage but the last ends, in metres, for the marks across the elevation profile. */
export function stageBoundariesM(stages: readonly TourStage[]): number[] {
  return stages.slice(0, -1).flatMap(s => (s.toM === null ? [] : [s.toM]))
}

/** The name a stage's stop goes by: its own, else its number as the list numbers stops. */
export function stopNameOf(points: readonly StagePoint[], index: number, fallback: (n: number) => string): string {
  const n = points.slice(0, index + 1).filter(p => !p.shaping).length
  return points[index]?.name || fallback(n)
}

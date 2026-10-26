// Fase B: navegar una excursión. Turns a tour (or one stage of it) into the line the
// navigation screen follows, and works out which trip day the recording belongs to.
import { stageSpansOf, vertexIndicesOf } from './stages'
import type { TourDetail } from './toursApi'
import type { TrackPoint } from '../hooks/useNavigation'

export interface TourNavPlan {
  name: string
  points: TrackPoint[]
  /** 1-based stage followed, null for the whole tour. */
  stage: number | null
  stageCount: number
  /** The trip day the recording is saved on, when it can be told. */
  dayId: number | null
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * @param stage the stage asked for; when none is asked and the tour has one stage a day,
 *   the stage of today's day is taken.
 */
export function tourNavPlan(detail: TourDetail, opts: { stage?: number | null; today?: string; stageLabel?: (n: number, name: string) => string } = {}): TourNavPlan | null {
  const line = (detail.route_geometry?.length ?? 0) >= 2 ? detail.route_geometry! : detail.recorded_route_geometry
  if (!line || line.length < 2) return null
  const name = detail.tour.name
  const today = opts.today ?? localDate()
  const days = [...detail.days].sort((a, b) => a.day_number - b.day_number)
  const spans = stageSpansOf(detail.waypoints)
  const oneStageADay = spans.length > 1 && spans.length === days.length

  let stage = opts.stage != null && opts.stage >= 1 && opts.stage <= spans.length && spans.length > 1 ? opts.stage : null
  if (stage == null && oneStageADay) {
    const i = days.findIndex(d => d.date === today)
    if (i >= 0) stage = i + 1
  }

  const toPoints = (part: readonly (readonly number[])[]): TrackPoint[] =>
    part.map(v => ({ lat: v[0], lng: v[1], ele: v.length >= 3 && Number.isFinite(v[2]) ? v[2] : null }))

  if (stage != null) {
    const span = spans[stage - 1]
    const at = vertexIndicesOf(detail.waypoints, line)
    const part = line.slice(at[span.from], at[span.to] + 1)
    if (part.length >= 2) {
      const dayId = oneStageADay ? days[stage - 1].day_id : (days.find(d => d.date === today)?.day_id ?? null)
      return {
        name: opts.stageLabel ? opts.stageLabel(stage, name) : `${name} · ${stage}`,
        points: toPoints(part), stage, stageCount: spans.length, dayId,
      }
    }
  }

  const dayId = days.find(d => d.date === today)?.day_id ?? (days.length === 1 ? days[0].day_id : null)
  return { name, points: toPoints(line), stage: null, stageCount: Math.max(1, spans.length), dayId }
}

export function tourNavUrl(tripId: number | string, placeId: number, stage?: number | null): string {
  return `/navigate?tripId=${tripId}&tourId=${placeId}${stage ? `&stage=${stage}` : ''}`
}

// Journeys y Excursiones: la ruta planificada de cada día del diario, para los días sin track grabado,
// y el nombre de la excursión de la que es cada track. Una excursión de varios días puesta en tantos
// días como etapas tiene se reparte etapa a etapa.
import type { PdfGpxTrack } from '../PDF/gpxDrawing'
import { computeTourMetrics, type GeometryPoint } from '../../tours/core'
import { stageSpansOf, vertexIndicesOf } from '../../tours/stages'

interface TourRow { place_id: number; name: string; day_numbers?: number[]; stage_count: number | null }
interface TourDetailRow {
  route_geometry: number[][] | null
  waypoints: { lat: number; lng: number; stage_end?: boolean; name?: string | null }[]
  days: { day_id: number; day_number: number; date: string | null }[]
}

export interface JourneyTours {
  /** Planned lines by day, as tracks marked `planned`. */
  planned: PdfGpxTrack[]
  /** Tour names by place id, for the label of a linked recorded track. */
  names: Map<number, string>
}

function asTrack(id: number, label: string, line: number[][], date: string | null, dayNumber: number | null): PdfGpxTrack {
  const m = computeTourMetrics(line as GeometryPoint[])
  const heights = line.filter(p => p.length >= 3).map(p => p[2])
  return {
    id, track_name: label, label, planned: true, date, day_number: dayNumber,
    total_distance: m.distanceKm,
    total_elevation_gain: m.elevationGainM ?? 0,
    total_elevation_loss: m.elevationLossM ?? 0,
    max_elevation: heights.length ? Math.max(...heights) : null,
    min_elevation: heights.length ? Math.min(...heights) : null,
    points: line.map(p => ({ lat: p[0], lng: p[1], ele: p.length >= 3 ? p[2] : null })),
  }
}

export async function fetchJourneyTours(trips: { trip_id: number }[], stageLabel: (n: number, name: string) => string): Promise<JourneyTours> {
  const planned: PdfGpxTrack[] = []
  const names = new Map<number, string>()
  for (const trip of trips) {
    let tours: TourRow[] = []
    try {
      const res = await fetch(`/api/trips/${trip.trip_id}/tours`, { credentials: 'include' })
      tours = res.ok ? ((await res.json()).tours ?? []) : []
    } catch { tours = [] }
    for (const tour of tours) {
      names.set(tour.place_id, tour.name)
      if (!tour.day_numbers?.length) continue
      let d: TourDetailRow | null = null
      try {
        const res = await fetch(`/api/trips/${trip.trip_id}/tours/${tour.place_id}`, { credentials: 'include' })
        d = res.ok ? await res.json() : null
      } catch { d = null }
      const line = d?.route_geometry
      if (!d || !line || line.length < 2) continue
      const days = [...d.days].sort((a, b) => a.day_number - b.day_number)
      const spans = stageSpansOf(d.waypoints)
      if (spans.length > 1 && spans.length === days.length) {
        // One stage a day, in order.
        const at = vertexIndicesOf(d.waypoints, line)
        spans.forEach((span, i) => {
          const part = line.slice(at[span.from], at[span.to] + 1)
          if (part.length > 1) planned.push(asTrack(-(tour.place_id * 100 + i + 1), stageLabel(i + 1, tour.name), part, days[i].date, days[i].day_number))
        })
      } else {
        days.forEach((day, i) => planned.push(asTrack(-(tour.place_id * 100 + i), tour.name, line, day.date, day.day_number)))
      }
    }
  }
  return { planned, names }
}

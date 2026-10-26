// Entradas por etapa: the journal entry of a day's route — its title (the stage or the tour),
// the numbers of the day as the opening line, where it ended, when it started, and the
// photos taken along it.
import type { PdfGpxTrack } from '../PDF/gpxDrawing'
import { parseRouteTime } from '../PDF/gpxDrawing'

export interface StageEntryDraft {
  title: string
  story: string
  entry_time: string | null
  location_name: string | null
  location_lat: number | null
  location_lng: number | null
  /** The tour this day is a stage of, when known — its suggested entry is the one to fill. */
  tour_place_id: number | null
}

export function stageTitle(tracks: PdfGpxTrack[]): string {
  const labels = [...new Set(tracks.map(t => t.label || t.track_name).filter(Boolean))]
  return labels.join(' · ')
}

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60)
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}

/**
 * `statsLine` turns the day's numbers into the opening line of the story, in the UI language
 * (e.g. "38,0 km · +209 m / −167 m · 6 h 10 min").
 */
export function buildStageEntry(
  tracks: PdfGpxTrack[],
  statsLine: (v: { km: string; up: number; down: number; duration: string | null }) => string,
  locale?: string,
): StageEntryDraft | null {
  const withPoints = tracks.filter(t => t.points.length > 0)
  if (!withPoints.length) return null
  const km = tracks.reduce((s, t) => s + (t.total_distance || 0), 0)
  const up = Math.round(tracks.reduce((s, t) => s + (t.total_elevation_gain || 0), 0))
  const down = Math.round(tracks.reduce((s, t) => s + (t.total_elevation_loss || 0), 0))
  const times = withPoints.flatMap(t => t.points.map(p => parseRouteTime(p.time))).filter((v): v is number => v != null)
  const start = times.length ? Math.min(...times) : null
  const end = times.length ? Math.max(...times) : null
  const duration = start != null && end != null && end - start >= 60_000 ? formatDuration((end - start) / 60_000) : null
  const last = withPoints[withPoints.length - 1]
  const endPoint = last.points[last.points.length - 1]
  return {
    title: stageTitle(tracks),
    story: statsLine({ km: km.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), up, down, duration }),
    entry_time: start != null ? hhmm(start) : null,
    location_name: last.end_name ?? null,
    location_lat: endPoint.lat,
    location_lng: endPoint.lng,
    tour_place_id: tracks.find(t => t.tour_place_id != null)?.tour_place_id ?? null,
  }
}

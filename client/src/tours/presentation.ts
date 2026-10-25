// Presentación de Tours, como tourPresentation.ts de liketrek/TREK v5.0.0 (sin paseos urbanos ni wanderer).
import { tourTimeEstimate, type TourTimeEstimate } from './core'
import type { TourListItem, TourType } from './toursApi'

type Translate = (key: string, params?: Record<string, string | number>) => string

export const TOUR_TYPES: TourType[] = ['hike', 'bike', 'run']
export const TOUR_TYPE_COLOR: Record<TourType, string> = { hike: '#16a34a', bike: '#2563eb', run: '#dc2626' }

/** `2 h 47 min`, `45 min`, `3 h` como formatDurationShort de la v5. */
export function formatDurationShort(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function formatDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '—'
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km < 10 ? km.toFixed(1) : Math.round(km * 10) / 10} km`
}

export function formatElevation(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—'
  return `${Math.round(m)} m`
}

/** Paso `5:30` (min:s por km). */
export function formatPace(seconds: number | null | undefined): string {
  if (seconds == null) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function parsePace(text: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(text)
  if (!m) return null
  const sec = Number(m[1]) * 60 + Number(m[2] ?? 0)
  return sec >= 120 && sec <= 1200 ? sec : null
}

/** El grado que muestra la fila: T1–T6 para una excursión a pie, el perfil en una bici o carrera. */
export function gradeTile(tour: Pick<TourListItem, 'tour_type' | 'max_hiking_difficulty' | 'bike_profile' | 'run_profile' | 'origin'>): string | null {
  if (tour.origin === 'gpx') return null
  if (tour.tour_type === 'hike' && tour.max_hiking_difficulty) return `T${tour.max_hiking_difficulty}`
  return null
}

export interface TourPlannedTimes {
  walkingMinutes: number | null
  breakMinutes: number | null
  plannedTotalMinutes: number | null
  manuallyOverridden: boolean
  estimate: TourTimeEstimate | null
}

export function tourPlannedTimes(tour: Pick<TourListItem, 'tour_type' | 'duration' | 'planned_duration_minutes' | 'break_additional_minutes' | 'distance' | 'elevation_gain' | 'elevation_loss' | 'run_pace_seconds_per_km'>): TourPlannedTimes {
  const manual = tour.planned_duration_minutes ?? null
  const breaks = tour.break_additional_minutes ?? null
  const automatic = tour.duration == null ? null : tour.duration + (breaks ?? 0)
  return {
    walkingMinutes: tour.duration,
    breakMinutes: breaks,
    plannedTotalMinutes: manual ?? automatic,
    manuallyOverridden: manual !== null,
    estimate: tourTimeEstimate({
      tour_type: tour.tour_type,
      distance: tour.distance ?? null,
      elevation_gain: tour.elevation_gain ?? null,
      elevation_loss: tour.elevation_loss ?? null,
      duration: tour.duration,
      run_pace_seconds_per_km: tour.run_pace_seconds_per_km ?? null,
    }),
  }
}

/** Lo que dura una excursión en un día: el total planificado, o la estimación (≈). */
export function tourDayTimeText(tour: Parameters<typeof tourPlannedTimes>[0]): string | null {
  const times = tourPlannedTimes(tour)
  if (times.plannedTotalMinutes != null) return formatDurationShort(times.plannedTotalMinutes)
  const est = times.estimate?.minutes
  return est == null ? null : `≈ ${formatDurationShort(est)}`
}

export function tourTypeLabel(type: TourType, t: Translate): string {
  return t(`tourTypes.${type}`)
}

/** La etiqueta del tiempo calculado según el tipo. */
export function movingTimeLabel(type: TourType, t: Translate): string {
  if (type === 'bike') return t('tours.bike.timeEstimatedShort')
  if (type === 'run') return t('tours.run.timeEstimatedShort')
  return t('tours.planner.walkingEstimatedShort')
}

export function movingTimeInfo(type: TourType, t: Translate): string {
  if (type === 'bike') return t('tours.bike.timeEstimatedInfo')
  if (type === 'run') return t('tours.run.timeEstimatedInfo')
  return t('tours.planner.walkingEstimatedInfo')
}

export type TourFilter = 'all' | 'unplanned' | 'planned'

export function filterTours<T extends Pick<TourListItem, 'planned' | 'tour_type'>>(tours: T[], status: TourFilter, type: TourType | 'all'): T[] {
  return tours.filter(tr => {
    if (status === 'unplanned' && tr.planned) return false
    if (status === 'planned' && !tr.planned) return false
    if (type !== 'all' && tr.tour_type !== type) return false
    return true
  })
}

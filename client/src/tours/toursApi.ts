// API de Tours (rutas de liketrek/TREK v5.0.0 en /api/trips/:tripId/tours).
import { apiClient } from '../api/client'
import type { GeometryPoint, HikingPreferences, BikeProfile, RunProfile, TourTimeEstimate } from './core'
import type { TourFixedLeg } from './routing/types'

export type TourType = 'hike' | 'bike' | 'run'
export type TourOrigin = 'trek' | 'gpx' | 'wanderer'

export interface TourTypeRow {
  key: string
  label_key: string
  color: string
  icon: string
  is_sport: boolean
  enabled: boolean
  sort_order: number
}

export interface TourStageStop { key: string; lat: number; lng: number }

export interface TourListItem {
  place_id: number
  tour_type: TourType
  distance: number | null
  elevation_gain: number | null
  elevation_loss: number | null
  duration: number | null
  planned_duration_minutes: number | null
  break_additional_minutes: number | null
  difficulty: string | null
  match_confidence: number | null
  max_hiking_difficulty: number | null
  hiking_preferences: HikingPreferences | null
  derived_from_place_id: number | null
  bike_profile: BikeProfile | null
  run_profile: RunProfile | null
  run_pace_seconds_per_km: number | null
  name: string
  description: string | null
  website: string | null
  planned: boolean
  caution: boolean
  has_waypoints: boolean
  has_recorded_track: boolean
  origin: TourOrigin
  origin_file_name: string | null
  revision: number
  track_started_at: string | null
  track_ended_at: string | null
  time_estimate: TourTimeEstimate | null
  stage_count: number | null
  stage_stops: TourStageStop[] | null
  day_numbers?: number[]
  /** Plan frente a realidad: the recorded track (GPX tab) linked as what was done. */
  actual_track?: ActualTrack | null
}

export interface ActualTrack {
  id: number
  track_name: string
  total_distance: number | null
  total_elevation_gain: number | null
  total_elevation_loss: number | null
  duration_seconds: number | null
  ibp: number | null
  day_id: number | null
}

/** A track of the GPX tab, as its list gives it. */
export interface TripTrack extends ActualTrack {
  tour_place_id: number | null
  start_lat: number | null
  start_lng: number | null
  is_active: number
}

export interface TourWaypoint {
  lat: number
  lng: number
  role: 'start' | 'via' | 'end'
  sequence: number
  fixed_leg?: TourFixedLeg | null
  shaping?: boolean
  linked_place_id?: number | null
  key?: string
  name?: string | null
  poi_category?: string | null
  stage_end?: boolean
}

export interface TourDayRow { assignment_id: number; day_id: number; tour_stage_key: string | null; day_number: number; date: string | null }

export interface TourDetail {
  tour: TourListItem
  waypoints: TourWaypoint[]
  route_geometry: GeometryPoint[] | null
  recorded_route_geometry: GeometryPoint[] | null
  days: TourDayRow[]
  actual_points?: Array<[number, number, number | null]> | null
}

export interface TourWritePayload {
  name: string
  tour_type: TourType
  route_geometry: [number, number, number][]
  waypoints: TourWaypoint[]
  max_hiking_difficulty?: number | null
  hiking_preferences?: HikingPreferences | null
  bike_profile?: BikeProfile | null
  run_profile?: RunProfile | null
  run_pace_seconds_per_km?: number | null
  duration_seconds?: number | null
  planned_duration_minutes?: number | null
  break_additional_minutes?: number | null
  description?: string | null
  expected_revision?: number | null
  derived_from_place_id?: number | null
}

export interface GpxPreviewTrack {
  index: number
  name: string
  point_count: number
  distance_km: number
  elevation_gain: number | null
  elevation_loss: number | null
  has_heights: boolean
  started_at: string | null
  ended_at: string | null
  line: [number, number][]
}

export interface GpxImportChoice { index: number; tour_type: TourType; name: string }

const base = (tripId: number | string) => `/trips/${tripId}/tours`

export const toursApi = {
  list: (tripId: number | string) =>
    apiClient.get(base(tripId)).then(r => r.data as { tours: TourListItem[]; tourTypes: TourTypeRow[] }),
  get: (tripId: number | string, placeId: number) =>
    apiClient.get(`${base(tripId)}/${placeId}`).then(r => r.data as TourDetail),
  create: (tripId: number | string, body: TourWritePayload) =>
    apiClient.post(base(tripId), body, { timeout: 30000 }).then(r => r.data as { tour: TourListItem }),
  update: (tripId: number | string, placeId: number, body: TourWritePayload) =>
    apiClient.put(`${base(tripId)}/${placeId}`, body, { timeout: 30000 }).then(r => r.data as { tour: TourListItem }),
  copy: (tripId: number | string, placeId: number, name?: string) =>
    apiClient.post(`${base(tripId)}/${placeId}/copy`, name ? { name } : {}).then(r => r.data as { tour: TourListItem }),
  restoreRecorded: (tripId: number | string, placeId: number) =>
    apiClient.post(`${base(tripId)}/${placeId}/restore-recorded`, {}).then(r => r.data as { tour: TourListItem }),
  remove: (tripId: number | string, placeId: number) =>
    apiClient.delete(`${base(tripId)}/${placeId}`).then(r => r.data),
  fromTrack: (tripId: number | string, trackId: number) =>
    apiClient.post(`${base(tripId)}/from-track/${trackId}`, {}).then(r => r.data as { tour: TourListItem }),
  tracks: (tripId: number | string) => apiClient.get(`/trips/${tripId}/gpx`).then(r => r.data as TripTrack[]),
  linkTrack: (tripId: number | string, trackId: number, tourPlaceId: number | null) =>
    apiClient.patch(`/trips/${tripId}/gpx/${trackId}`, { tour_place_id: tourPlaceId }).then(r => r.data),
  setTrackDay: (tripId: number | string, trackId: number, dayId: number | null) =>
    apiClient.patch(`/trips/${tripId}/gpx/${trackId}`, { day_id: dayId }).then(r => r.data),
  uploadTrack: (tripId: number | string, file: File) => {
    const fd = new FormData()
    fd.append('gpx', file)
    return apiClient.post(`/trips/${tripId}/gpx/upload`, fd, { timeout: 60000, headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data as TripTrack)
  },
  exportUrl: (tripId: number | string, placeId: number) => `/api${base(tripId)}/${placeId}/export.gpx`,
  previewGpx: (tripId: number | string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post(`${base(tripId)}/import/gpx/preview`, fd, { timeout: 60000, headers: { 'Content-Type': 'multipart/form-data' } })
      .then(r => r.data as { file_name: string; tracks: GpxPreviewTrack[] })
  },
  importGpx: (tripId: number | string, file: File, choices: GpxImportChoice[]) => {
    const fd = new FormData()
    fd.append('choices', JSON.stringify(choices))
    fd.append('file', file)
    return apiClient.post(`${base(tripId)}/import/gpx`, fd, { timeout: 60000, headers: { 'Content-Type': 'multipart/form-data' } })
      .then(r => r.data as { tours: TourListItem[] })
  },
}

import type { Trip } from '../../types'

export type DashboardTrip = Trip

export interface Member { id: number; username: string; avatar_url?: string | null }
export interface Place {
  id: number; name: string; image_url: string | null; lat: number | null; lng: number | null
  google_place_id: string | null; osm_id: string | null
  category_color?: string | null; category_icon?: string | null
}
export interface HeroBundle { members: Member[]; places: Place[] }
export interface TravelStats { totalTrips?: number; totalDays?: number; totalPlaces?: number; totalDistanceKm?: number; countries?: string[] }
export interface UpcomingReservation {
  id: number; trip_id: number; title: string; type: string
  reservation_time?: string | null; day_date?: string | null
  location?: string | null; place_name?: string | null; trip_title?: string | null
}

export const MS_PER_DAY = 86400000

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
}

export function getTripStatus(trip: DashboardTrip): 'ongoing' | 'today' | 'tomorrow' | 'future' | 'past' | null {
  const today = new Date().toISOString().split('T')[0]
  if (trip.start_date && trip.end_date && trip.start_date <= today && trip.end_date >= today) return 'ongoing'
  const until = daysUntil(trip.start_date)
  if (until === null) return null
  if (until === 0) return 'today'
  if (until === 1) return 'tomorrow'
  if (until > 1) return 'future'
  return 'past'
}

/** How the filtered trip list is ordered. 'date' keeps sortTrips()'s own chronological order — everything else replaces it. */
export type TripSortOption = 'date' | 'name-asc' | 'name-desc' | 'days-desc' | 'days-asc'

export interface TripFilters {
  /** Matches against title + description. */
  search: string
  /** Matches against place_names (a comma-joined list of the trip's own place names, from the server). */
  place: string
  /** Both are raw input strings, not numbers — kept as typed so a half-entered "1" doesn't get coerced away mid-keystroke. */
  minDays: string
  maxDays: string
  sortBy: TripSortOption
}

export const EMPTY_TRIP_FILTERS: TripFilters = { search: '', place: '', minDays: '', maxDays: '', sortBy: 'date' }

export function countActiveTripFilters(filters: TripFilters): number {
  let n = 0
  if (filters.search.trim()) n++
  if (filters.place.trim()) n++
  if (filters.minDays.trim()) n++
  if (filters.maxDays.trim()) n++
  if (filters.sortBy !== 'date') n++
  return n
}

/** Applied after the planned/archive/completed segmented control — search, place, day-count range, then a sort override. */
export function filterAndSortTrips(trips: DashboardTrip[], filters: TripFilters): DashboardTrip[] {
  const search = filters.search.trim().toLowerCase()
  const place = filters.place.trim().toLowerCase()
  const min = filters.minDays.trim() ? Number(filters.minDays) : null
  const max = filters.maxDays.trim() ? Number(filters.maxDays) : null

  const filtered = trips.filter(trip => {
    if (search) {
      const haystack = `${trip.title || ''} ${trip.description || ''}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (place && !(trip.place_names || '').toLowerCase().includes(place)) return false
    const days = trip.day_count ?? 0
    if (min != null && !Number.isNaN(min) && days < min) return false
    if (max != null && !Number.isNaN(max) && days > max) return false
    return true
  })

  switch (filters.sortBy) {
    case 'name-asc': return [...filtered].sort((a, b) => a.title.localeCompare(b.title))
    case 'name-desc': return [...filtered].sort((a, b) => b.title.localeCompare(a.title))
    case 'days-desc': return [...filtered].sort((a, b) => (b.day_count ?? 0) - (a.day_count ?? 0))
    case 'days-asc': return [...filtered].sort((a, b) => (a.day_count ?? 0) - (b.day_count ?? 0))
    default: return filtered
  }
}

export function sortTrips(trips: DashboardTrip[]): DashboardTrip[] {
  const today = new Date().toISOString().split('T')[0]
  const rank = (t: DashboardTrip) => {
    if (t.start_date && t.end_date && t.start_date <= today && t.end_date >= today) return 0
    if (t.start_date && t.start_date >= today) return 1
    return 2
  }
  return [...trips].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    const ad = a.start_date || '', bd = b.start_date || ''
    if (ra <= 1) return ad.localeCompare(bd)
    return bd.localeCompare(ad)
  })
}

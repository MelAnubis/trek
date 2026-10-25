// FE-TOUR-001 … — presentación de Tours (v5)
import { describe, it, expect } from 'vitest'
import { filterTours, formatDistance, formatDurationShort, formatPace, gradeTile, parsePace, tourDayTimeText, tourPlannedTimes } from './presentation'
import type { TourListItem } from './toursApi'

const base = {
  tour_type: 'hike', duration: null, planned_duration_minutes: null, break_additional_minutes: null,
  distance: null, elevation_gain: null, elevation_loss: null, run_pace_seconds_per_km: null,
} as const

describe('tour presentation', () => {
  it('FE-TOUR-001: durations, distances and paces read the v5 way', () => {
    expect(formatDurationShort(167)).toBe('2 h 47 min')
    expect(formatDurationShort(45)).toBe('45 min')
    expect(formatDurationShort(180)).toBe('3 h')
    expect(formatDurationShort(null)).toBe('—')
    expect(formatDistance(5.53)).toBe('5.5 km')
    expect(formatDistance(0.25)).toBe('250 m')
    expect(formatDistance(22.84)).toBe('22.8 km')
    expect(formatPace(330)).toBe('5:30')
    expect(parsePace('5:30')).toBe(330)
    expect(parsePace('1:00')).toBeNull()
    expect(parsePace('abc')).toBeNull()
  })

  it('FE-TOUR-002: the planned total is the time plus breaks, a manual one wins, and without a time the estimate shows with ≈', () => {
    expect(tourPlannedTimes({ ...base, duration: 100, break_additional_minutes: 30 }).plannedTotalMinutes).toBe(130)
    expect(tourPlannedTimes({ ...base, duration: 100, planned_duration_minutes: 200 }).plannedTotalMinutes).toBe(200)
    // An import: 6 km, 300 m up, 300 m down, DIN 33466.
    const text = tourDayTimeText({ ...base, distance: 6, elevation_gain: 300, elevation_loss: 300 })
    expect(text?.startsWith('≈ ')).toBe(true)
    expect(tourDayTimeText(base)).toBeNull()
  })

  it('FE-TOUR-003: a planned hike shows its limit as the grade tile; an import and a bike tour show none', () => {
    expect(gradeTile({ tour_type: 'hike', max_hiking_difficulty: 3, bike_profile: null, run_profile: null, origin: 'trek' })).toBe('T3')
    expect(gradeTile({ tour_type: 'hike', max_hiking_difficulty: 3, bike_profile: null, run_profile: null, origin: 'gpx' })).toBeNull()
    expect(gradeTile({ tour_type: 'bike', max_hiking_difficulty: null, bike_profile: 'mtb', run_profile: null, origin: 'trek' })).toBeNull()
  })

  it('FE-TOUR-004: the list filters by day status and by type', () => {
    const tours = [
      { place_id: 1, planned: true, tour_type: 'hike' },
      { place_id: 2, planned: false, tour_type: 'bike' },
      { place_id: 3, planned: false, tour_type: 'hike' },
    ] as unknown as TourListItem[]
    expect(filterTours(tours, 'all', 'all').map(t => t.place_id)).toEqual([1, 2, 3])
    expect(filterTours(tours, 'planned', 'all').map(t => t.place_id)).toEqual([1])
    expect(filterTours(tours, 'unplanned', 'hike').map(t => t.place_id)).toEqual([3])
  })
})

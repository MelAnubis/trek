// FE-DASHMODEL-001 to FE-DASHMODEL-014
import { filterAndSortTrips, countActiveTripFilters, EMPTY_TRIP_FILTERS, type TripFilters, type DashboardTrip } from './dashboardModel'

function trip(overrides: Partial<DashboardTrip> = {}): DashboardTrip {
  return {
    id: 1, title: 'Trip', description: null, start_date: '2026-06-01', end_date: '2026-06-05',
    cover_image: null, is_archived: false, reminder_days: 3, trip_type: 'general',
    owner_id: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    day_count: 5, place_names: null,
    ...overrides,
  }
}

function filters(overrides: Partial<TripFilters> = {}): TripFilters {
  return { ...EMPTY_TRIP_FILTERS, ...overrides }
}

describe('countActiveTripFilters', () => {
  it('FE-DASHMODEL-001: an empty filter set counts zero', () => {
    expect(countActiveTripFilters(EMPTY_TRIP_FILTERS)).toBe(0)
  })

  it('FE-DASHMODEL-002: whitespace-only text fields do not count as active', () => {
    expect(countActiveTripFilters(filters({ search: '   ', place: '  ' }))).toBe(0)
  })

  it('FE-DASHMODEL-003: counts each non-empty dimension once, including a non-default sort', () => {
    expect(countActiveTripFilters(filters({ search: 'paris', place: 'france', minDays: '2', maxDays: '10', sortBy: 'name-asc' }))).toBe(5)
  })
})

describe('filterAndSortTrips — search', () => {
  it('FE-DASHMODEL-004: matches against the title, case-insensitively', () => {
    const trips = [trip({ id: 1, title: 'Paris Adventure' }), trip({ id: 2, title: 'Tokyo Trip' })]
    const result = filterAndSortTrips(trips, filters({ search: 'PARIS' }))
    expect(result.map(t => t.id)).toEqual([1])
  })

  it('FE-DASHMODEL-005: also matches against the description', () => {
    const trips = [trip({ id: 1, title: 'Summer', description: 'A week in Kyoto' }), trip({ id: 2, title: 'Winter', description: null })]
    const result = filterAndSortTrips(trips, filters({ search: 'kyoto' }))
    expect(result.map(t => t.id)).toEqual([1])
  })
})

describe('filterAndSortTrips — place', () => {
  it('FE-DASHMODEL-006: matches against place_names, case-insensitively', () => {
    const trips = [trip({ id: 1, place_names: 'Eiffel Tower,Louvre' }), trip({ id: 2, place_names: 'Colosseum' })]
    const result = filterAndSortTrips(trips, filters({ place: 'louvre' }))
    expect(result.map(t => t.id)).toEqual([1])
  })

  it('FE-DASHMODEL-007: a trip with no place_names never matches a place filter', () => {
    const trips = [trip({ id: 1, place_names: null })]
    expect(filterAndSortTrips(trips, filters({ place: 'paris' }))).toHaveLength(0)
  })
})

describe('filterAndSortTrips — day count range', () => {
  const trips = [trip({ id: 1, day_count: 3 }), trip({ id: 2, day_count: 7 }), trip({ id: 3, day_count: 14 })]

  it('FE-DASHMODEL-008: minDays excludes shorter trips', () => {
    expect(filterAndSortTrips(trips, filters({ minDays: '7' })).map(t => t.id)).toEqual([2, 3])
  })

  it('FE-DASHMODEL-009: maxDays excludes longer trips', () => {
    expect(filterAndSortTrips(trips, filters({ maxDays: '7' })).map(t => t.id)).toEqual([1, 2])
  })

  it('FE-DASHMODEL-010: min and max together narrow to a band', () => {
    expect(filterAndSortTrips(trips, filters({ minDays: '5', maxDays: '10' })).map(t => t.id)).toEqual([2])
  })

  it('FE-DASHMODEL-011: a trip with no day_count is treated as 0 days', () => {
    const withUnknown = [...trips, trip({ id: 4, day_count: undefined })]
    expect(filterAndSortTrips(withUnknown, filters({ minDays: '1' })).map(t => t.id)).toEqual([1, 2, 3])
  })
})

describe('filterAndSortTrips — sort', () => {
  const trips = [
    trip({ id: 1, title: 'Charlie', day_count: 5 }),
    trip({ id: 2, title: 'Alpha', day_count: 12 }),
    trip({ id: 3, title: 'Bravo', day_count: 2 }),
  ]

  it('FE-DASHMODEL-012: "date" leaves the given order untouched', () => {
    expect(filterAndSortTrips(trips, filters({ sortBy: 'date' })).map(t => t.id)).toEqual([1, 2, 3])
  })

  it('FE-DASHMODEL-013: "name-asc"/"name-desc" sort alphabetically by title', () => {
    expect(filterAndSortTrips(trips, filters({ sortBy: 'name-asc' })).map(t => t.title)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(filterAndSortTrips(trips, filters({ sortBy: 'name-desc' })).map(t => t.title)).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('FE-DASHMODEL-014: "days-desc"/"days-asc" sort by day_count', () => {
    expect(filterAndSortTrips(trips, filters({ sortBy: 'days-desc' })).map(t => t.id)).toEqual([2, 1, 3])
    expect(filterAndSortTrips(trips, filters({ sortBy: 'days-asc' })).map(t => t.id)).toEqual([3, 1, 2])
  })
})

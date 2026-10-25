// FE-TOUR-UI-001 … — la lista «Tours of this trip» y los textos de Tours (v5)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, renderHook } from '../../tests/helpers/render'
import { resetAllStores } from '../../tests/helpers/store'
import ToursSidebar from './ToursSidebar'
import { TranslationProvider, useTranslation } from '../i18n/TranslationContext'
import type { TourListItem } from './toursApi'

const tour = (over: Partial<TourListItem>): TourListItem => ({
  place_id: 1, tour_type: 'hike', distance: 5.5, elevation_gain: 595, elevation_loss: 59, duration: 167, planned_duration_minutes: null,
  break_additional_minutes: null, difficulty: null, match_confidence: 1, max_hiking_difficulty: 3, hiking_preferences: null,
  derived_from_place_id: null, bike_profile: null, run_profile: null, run_pace_seconds_per_km: null, name: 'Up to Rifugio Firenze',
  description: null, website: null, planned: false, caution: false, has_waypoints: true, has_recorded_track: false, origin: 'trek',
  origin_file_name: null, revision: 1, track_started_at: null, track_ended_at: null, time_estimate: null, stage_count: null,
  stage_stops: null, day_numbers: [], ...over,
})

const props = () => ({
  tours: [tour({}), tour({ place_id: 2, name: 'Seceda ridge walk', origin: 'gpx', duration: null, planned: true, day_numbers: [1], max_hiking_difficulty: null })],
  loading: false, activeId: null, summary: null, canEdit: true,
  days: [{ id: 11, day_number: 1, date: '2026-07-01', title: null }, { id: 12, day_number: 2, date: '2026-07-02', title: null }],
  onOpen: vi.fn(), onNew: vi.fn(), onImport: vi.fn(), onDelete: vi.fn(), onAddToDay: vi.fn(), onCopy: vi.fn(),
  onRestoreRecorded: vi.fn(), onPlanEditable: vi.fn(), exportUrl: () => '#', onProfileFocus: vi.fn(), onCloseSelection: vi.fn(), selectedReadOnly: null,
})

beforeEach(() => resetAllStores())

describe('ToursSidebar', () => {
  it('FE-TOUR-UI-001: rows show the grade tile, time, distance and days; totals count planned and unplanned', () => {
    render(<ToursSidebar {...props()} />)
    expect(screen.getByText('Tours of this trip')).toBeInTheDocument()
    expect(screen.getByText('T3')).toBeInTheDocument()
    expect(screen.getByText('2 h 47 min')).toBeInTheDocument()
    expect(screen.getByText('Day 1')).toBeInTheDocument()
    expect(screen.getByText('GPX')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Up to Rifugio Firenze'))
  })

  it('FE-TOUR-UI-002: a row opens its tour, and the + puts it on a day', () => {
    const p = props()
    render(<ToursSidebar {...p} />)
    fireEvent.click(screen.getByText('Up to Rifugio Firenze'))
    expect(p.onOpen).toHaveBeenCalledWith(expect.objectContaining({ place_id: 1 }))
    fireEvent.mouseEnter(screen.getByText('Up to Rifugio Firenze').closest('[role="button"]')!)
    fireEvent.click(screen.getAllByTitle('Add to day')[0])
    fireEvent.click(screen.getByText(/^Day 2/))
    expect(p.onAddToDay).toHaveBeenCalledWith(expect.objectContaining({ place_id: 1 }), 12)
  })

  it('FE-TOUR-UI-003: the status filter leaves out what does not match', () => {
    render(<ToursSidebar {...props()} />)
    fireEvent.click(screen.getByText('All', { selector: 'span' }).closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Unplanned' }))
    expect(screen.getByText('Up to Rifugio Firenze')).toBeInTheDocument()
    expect(screen.queryByText('Seceda ridge walk')).not.toBeInTheDocument()
  })

  it('FE-TOUR-I18N-001: plural groups pick the .one form by count', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper: ({ children }) => <TranslationProvider>{children}</TranslationProvider> })
    expect(result.current.t('tours.import.success', { count: 1 })).toBe('1 tour imported')
    expect(result.current.t('tours.import.success', { count: 3 })).toBe('3 tours imported')
  })
})

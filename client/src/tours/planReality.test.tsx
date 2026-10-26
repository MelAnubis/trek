// FE-TOUR-REAL-001 … — plan frente a realidad, y Journeys con la ruta planificada
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../../tests/helpers/render'
import ActualCard from './ActualCard'
import { fetchJourneyTours } from '../components/Journey/journeyTours'
import { DayRouteCard } from '../components/Journey/GpxRouteCards'
import type { TourListItem, TripTrack } from './toursApi'

const tour = { place_id: 5, name: 'Subida', actual_track: null } as unknown as TourListItem
const track = (id: number, extra: Partial<TripTrack> = {}): TripTrack => ({ id, track_name: `Track ${id}`, total_distance: 10, total_elevation_gain: 500, total_elevation_loss: 480, duration_seconds: 7200, ibp: 40, day_id: null, tour_place_id: null, start_lat: null, start_lng: null, is_active: 1, ...extra })
const planned = { distanceKm: 9.5, gain: 450, loss: 450, minutes: 150 }

afterEach(() => vi.restoreAllMocks())

describe('ActualCard', () => {
  it('FE-TOUR-REAL-001: without a track it offers the trip tracks, those of the tour days first, and links the one chosen', async () => {
    const onLink = vi.fn().mockResolvedValue(undefined)
    render(<ActualCard tour={tour} planned={planned} tracks={[track(1), track(2, { day_id: 7 }), track(3, { tour_place_id: 9 })]} dayIds={[7]} canEdit onLink={onLink} onUpload={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Plan vs. reality/ }))
    const options = Array.from((screen.getByTestId('actual-pick') as HTMLSelectElement).options).map(o => o.textContent)
    expect(options[1]).toMatch(/^Track 2.*same day/)
    expect(options.some(o => o?.startsWith('Track 3'))).toBe(false)
    fireEvent.change(screen.getByTestId('actual-pick'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Link/ }))
    await waitFor(() => expect(onLink).toHaveBeenCalledWith(2))
  })

  it('FE-TOUR-REAL-002: with a track it compares plan and reality, with the difference', () => {
    const linked = { ...tour, actual_track: track(1) } as TourListItem
    render(<ActualCard tour={linked} planned={planned} tracks={[]} dayIds={[]} canEdit onLink={vi.fn()} onUpload={vi.fn()} />)
    const table = screen.getByTestId('actual-compare')
    expect(table.textContent).toContain('9.5 km')
    expect(table.textContent).toContain('10 km')
    expect(table.textContent).toContain('+500 m')
    expect(table.textContent).toContain('2 h 30 min')
    expect(table.textContent).toContain('−30 min')
    expect(table.textContent).toContain('2 h')
  })
})

describe('Journeys and tours', () => {
  it('FE-TOUR-REAL-003: a multi-day tour on as many days as stages gives each day its own stage line', async () => {
    const line = Array.from({ length: 11 }, (_, i) => [41 + i * 0.01, -4, 800 + i * 10])
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.endsWith('/tours')) return new Response(JSON.stringify({ tours: [{ place_id: 5, name: 'Travesía', day_numbers: [1, 2], stage_count: 2 }] }))
      return new Response(JSON.stringify({
        route_geometry: line,
        waypoints: [{ lat: 41, lng: -4 }, { lat: 41.05, lng: -4, stage_end: true }, { lat: 41.1, lng: -4 }],
        days: [{ day_id: 1, day_number: 1, date: '2026-05-01' }, { day_id: 2, day_number: 2, date: '2026-05-02' }],
      }))
    })
    const res = await fetchJourneyTours([{ trip_id: 3 }], (n, name) => `Etapa ${n} · ${name}`)
    expect(res.names.get(5)).toBe('Travesía')
    expect(res.planned.map(p => [p.date, p.label, p.points.length])).toEqual([['2026-05-01', 'Etapa 1 · Travesía', 6], ['2026-05-02', 'Etapa 2 · Travesía', 6]])
    expect(res.planned[0].planned).toBe(true)
  })

  it('FE-TOUR-REAL-004: a day card says when its route is the plan, and names the tour', () => {
    render(<DayRouteCard tracks={[{ id: -1, track_name: 'x', label: 'Etapa 1 · Travesía', planned: true, total_distance: 5, total_elevation_gain: 100, total_elevation_loss: 0, max_elevation: null, min_elevation: null, points: [{ lat: 41, lng: -4, ele: 1 }, { lat: 41.01, lng: -4, ele: 2 }] }]} />)
    expect(screen.getByTestId('day-route-label').textContent).toContain('Planned')
    expect(screen.getByTestId('day-route-label').textContent).toContain('Etapa 1 · Travesía')
  })
})

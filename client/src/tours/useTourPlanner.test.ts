// FE-TOUR-PLAN-001 … — el planificador de Tours (v5): puntos, deshacer, ruta, alturas y guardar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTourPlanner } from './useTourPlanner'

const h = vi.hoisted(() => ({
  walk: vi.fn(), bike: vi.fn(), run: vi.fn(), heights: vi.fn(), create: vi.fn(), update: vi.fn(),
}))
vi.mock('./routing/tourRouting', () => ({
  routeWalkingTour: h.walk, routeBikeTour: h.bike, routeRun: h.run, enrichTourElevations: h.heights,
}))
vi.mock('./toursApi', () => ({ toursApi: { create: h.create, update: h.update } }))

const line = (pts: { lat: number; lng: number }[]) => pts.map(p => [p.lat, p.lng] as [number, number])
const routeOf = (pts: { lat: number; lng: number }[], seconds = 3600) => ({
  coordinates: line(pts), parts: [{ coordinates: line(pts), free: false }], distanceMeters: 5000, durationSeconds: seconds,
})

beforeEach(() => {
  Object.values(h).forEach(f => f.mockReset())
  h.walk.mockImplementation(async (pts: { lat: number; lng: number }[]) => routeOf(pts))
  h.bike.mockImplementation(async (pts: { lat: number; lng: number }[]) => routeOf(pts, 1200))
  h.run.mockImplementation(async (pts: { lat: number; lng: number }[]) => routeOf(pts))
  h.heights.mockImplementation(async (coords: [number, number][]) => coords.map(([a, b], i) => [a, b, 1000 + i * 200]))
  h.create.mockResolvedValue({ tour: { place_id: 9, revision: 1 } })
  h.update.mockResolvedValue({ tour: { place_id: 9, revision: 2 } })
})

describe('useTourPlanner', () => {
  it('FE-TOUR-PLAN-001: two points route as a hike at the chosen limit, take heights, and save with roles, DIN time and stages', async () => {
    const saved = vi.fn()
    const { result } = renderHook(() => useTourPlanner(5, saved))
    act(() => result.current.startNew('hike'))
    act(() => result.current.setFields({ name: 'Refugio', maxDifficulty: 3, multiDay: true }))
    act(() => result.current.addPoint(46.5, 11.7))
    act(() => result.current.addPoint(46.52, 11.72))
    act(() => result.current.addPoint(46.54, 11.74))
    await waitFor(() => expect(result.current.geometry).not.toBeNull(), { timeout: 3000 })
    expect(h.walk).toHaveBeenCalledTimes(1)
    expect(h.walk.mock.calls[0][2]).toBe(3)
    const mid = result.current.points[1].id
    act(() => result.current.toggleStageEnd(mid))
    await waitFor(() => expect(result.current.canSave).toBe(true))
    expect(result.current.stageCount).toBe(2)
    await act(async () => { await result.current.save() })
    const [tripId, body] = h.create.mock.calls[0]
    expect(tripId).toBe(5)
    expect(body.name).toBe('Refugio')
    expect(body.waypoints.map((w: { role: string }) => w.role)).toEqual(['start', 'via', 'end'])
    expect(body.waypoints[1].stage_end).toBe(true)
    expect(body.route_geometry.every((p: number[]) => p.length === 3)).toBe(true)
    expect(body.max_hiking_difficulty).toBe(3)
    // DIN 33466 from 5 km, 400 m up: not the router's 60 minutes.
    expect(body.duration_seconds).not.toBe(3600)
    expect(saved).toHaveBeenCalledWith(9, true)
    expect(result.current.open).toEqual({ placeId: 9, revision: 1 })
    expect(result.current.dirty).toBe(false)
  })

  it('FE-TOUR-PLAN-002: undo and redo walk the waypoint edits back and forth', () => {
    const { result } = renderHook(() => useTourPlanner(5, vi.fn()))
    act(() => result.current.startNew())
    act(() => result.current.addPoint(1, 1))
    act(() => result.current.addPoint(2, 2))
    expect(result.current.points).toHaveLength(2)
    act(() => result.current.undo())
    expect(result.current.points).toHaveLength(1)
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.points).toHaveLength(2)
    act(() => result.current.reverse())
    expect(result.current.points[0].lat).toBe(2)
  })

  it('FE-TOUR-PLAN-003: a bike tour is routed for its profile and timed by the router', async () => {
    const { result } = renderHook(() => useTourPlanner(5, vi.fn()))
    act(() => result.current.startNew('bike'))
    act(() => result.current.setFields({ bikeProfile: 'gravel' }))
    act(() => { result.current.addPoint(46.5, 11.7); result.current.addPoint(46.6, 11.8) })
    await waitFor(() => expect(result.current.geometry).not.toBeNull(), { timeout: 3000 })
    expect(h.bike.mock.calls[0][1]).toBe('gravel')
    expect(result.current.movingMinutes).toBe(20)
  })

  it('FE-TOUR-PLAN-004: a run without a pace cannot be saved', async () => {
    const { result } = renderHook(() => useTourPlanner(5, vi.fn()))
    act(() => result.current.startNew('run'))
    act(() => result.current.setFields({ runPace: null }))
    act(() => { result.current.addPoint(46.5, 11.7); result.current.addPoint(46.6, 11.8) })
    await waitFor(() => expect(result.current.geometry).not.toBeNull(), { timeout: 3000 })
    expect(result.current.canSave).toBe(false)
    act(() => result.current.setFields({ runPace: 300 }))
    expect(result.current.movingMinutes).toBe(25)
    expect(result.current.canSave).toBe(true)
  })

  it('FE-TOUR-PLAN-005: a point no path reaches is named, and a 409 keeps the draft as a conflict', async () => {
    h.walk.mockResolvedValueOnce({ unreachable: 1, snappedMeters: 850 })
    const { result } = renderHook(() => useTourPlanner(5, vi.fn()))
    act(() => result.current.startNew())
    act(() => { result.current.addPoint(46.5, 11.7); result.current.addPoint(46.6, 11.8) })
    await waitFor(() => expect(result.current.status).toEqual({ kind: 'unreachable', point: 2, meters: 850 }), { timeout: 3000 })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.geometry).not.toBeNull(), { timeout: 3000 })
    h.create.mockRejectedValueOnce({ response: { status: 409 } })
    await act(async () => { await result.current.save() })
    expect(result.current.status.kind).toBe('conflict')
    expect(result.current.points).toHaveLength(2)
  })
})

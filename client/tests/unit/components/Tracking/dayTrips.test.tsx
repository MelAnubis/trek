/**
 * Tracking en vivo 5.7.21 — a day's trips, apart, and saving them to the route planner.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../helpers/msw/server'
import { render, screen, fireEvent, waitFor, within } from '../../../helpers/render'
import TrackingPage from '../../../../src/pages/TrackingPage'
import { splitTrips, localToday, type TrackPoint, type TrackingDevice } from '../../../../src/components/Tracking/trackingModel'

const day = localToday()
const base = Date.parse(`${day}T08:00:00`)
const at = (min: number, lat: number, lng: number, motion = 'cycling'): TrackPoint =>
  ({ ts: new Date(base + min * 60_000).toISOString(), lat, lng, motion, accuracy: 8 })

/** A ride 08:00–08:40 north, lunch in one place 08:40–10:00, a drive 10:00–10:30 east. */
const ride = Array.from({ length: 41 }, (_, i) => at(i, 40.72 + i * 0.002, -3.92))
const lunch = Array.from({ length: 16 }, (_, i) => at(41 + i * 5, 40.8 + (i % 2) * 0.0003, -3.92, 'stationary'))
const drive = Array.from({ length: 31 }, (_, i) => at(120 + i, 40.8, -3.92 + i * 0.01, 'automotive'))
const dayPoints = [...ride, ...lunch, ...drive]

describe('splitTrips', () => {
  it('a long stop in one place ends one trip; the stop belongs to neither', () => {
    const trips = splitTrips(dayPoints)
    expect(trips.map(t => t.n)).toEqual([1, 2])
    expect(trips[0]).toMatchObject({ motion: 'cycling', from: ride[0].ts })
    expect(Date.parse(trips[0].to)).toBeLessThanOrEqual(Date.parse(lunch[0].ts))
    expect(trips[1]).toMatchObject({ motion: 'automotive', to: drive[drive.length - 1].ts })
    expect(trips[0].distanceM).toBeGreaterThan(8000)
  })

  it('a hole in the recording ends a trip too; a short stop does not, nor does a phone settling down', () => {
    const holed = [...ride.slice(0, 20), ...ride.slice(20).map(p => ({ ...p, ts: new Date(Date.parse(p.ts) + 30 * 60_000).toISOString() }))]
    expect(splitTrips(holed)).toHaveLength(2)
    const coffee = [...ride.slice(0, 20), ...Array.from({ length: 5 }, (_, i) => at(20 + i * 2, ride[19].lat, ride[19].lng, 'stationary')), ...ride.slice(20).map(p => ({ ...p, ts: new Date(Date.parse(p.ts) + 10 * 60_000).toISOString() }))]
    expect(splitTrips(coffee)).toHaveLength(1)
    expect(splitTrips(Array.from({ length: 30 }, (_, i) => at(i, 40.72 + (i % 3) * 0.0002, -3.92, 'stationary')))).toEqual([])
  })
})

describe('TrackingPage — the day\'s trips', () => {
  const device: TrackingDevice = {
    id: 1, name: 'Pixel', token_hint: 'Ab12', overland_device_id: 'x', created_at: '2026-10-29T10:00:00Z', last_seen_at: null,
    last_position: null, battery_level: 0.8, battery_state: 'unplugged', status: 'stopped', status_at: null, retention_days: null, share: null,
  }
  let saved: Record<string, unknown>[] = []
  beforeEach(() => {
    saved = []
    try { localStorage.setItem('trek-tracking-snap', '0') } catch { /* none */ }
    server.use(
      http.get('/api/tracking/devices', () => HttpResponse.json({ devices: [device] })),
      http.get('/api/tracking/devices/1/track', () => HttpResponse.json({ points: dayPoints, total: dayPoints.length, hidden: 0, stats: { distance_m: 30000, start: dayPoints[0].ts, end: dayPoints[dayPoints.length - 1].ts, duration_s: 9000, motion: 'cycling' } })),
      http.get('/api/tracking/devices/1/days', () => HttpResponse.json({ days: [{ day, points: dayPoints.length }] })),
      http.get('/api/tracking/devices/1/ingests', () => HttpResponse.json({ ingests: [] })),
      http.get('/api/trips', () => HttpResponse.json({ trips: [] })),
      http.post('/api/tracking/devices/1/save-planner', async ({ request }) => { saved.push(await request.json() as Record<string, unknown>); return HttpResponse.json({ routeId: saved.length, points: 10 }, { status: 201 }) }),
    )
  })

  it('lists the trips, shows one on its own with its own figures and saves each to the route planner', async () => {
    render(<TrackingPage />)
    const list = await screen.findByTestId('day-trips')
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    fireEvent.click(within(list).getByRole('button', { name: /^1/ }))
    expect(screen.getByTestId('day-stats').textContent).toMatch(/1/)
    // The GPX of the trip, not the day.
    const gpx = screen.getByText('GPX').closest('a')!.getAttribute('href')!
    expect(new URLSearchParams(gpx.split('?')[1]).get('to')).toBe(splitTrips(dayPoints)[0].to)

    fireEvent.click(within(list).getByRole('button', { name: /^(All trips|Todos)/ }))
    fireEvent.click(screen.getByText(/Save as route|Guardar como ruta/))
    const dest = await screen.findByTestId('save-dest')
    expect(within(dest).getByRole('radio', { checked: true }).getAttribute('data-value')).toBe('planner')
    fireEvent.click(screen.getByTestId('save-separate'))
    fireEvent.click(screen.getByTestId('save-go'))
    await waitFor(() => expect(saved).toHaveLength(2))
    const trips = splitTrips(dayPoints)
    expect(saved.map(s => [s.from, s.to])).toEqual(trips.map(t => [t.from, t.to]))
    expect(String(saved[1].name)).toMatch(/ · 2$/)
  })
})

describe('stops and holes (5.7.21)', () => {
  it('a long hole at walking pace is the end of a trip and nothing is guessed across it; one covered at riding speed is bridged', async () => {
    const { isStopBetween } = await import('../../../../src/components/Tracking/trackingModel')
    const { gapsOf } = await import('../../../../src/components/Tracking/mapMatch')
    const a = at(0, 40.72, -3.92)
    expect(isStopBetween(a, at(120, 40.745, -3.92))).toBe(true) // 2.8 km in 2 h
    expect(isStopBetween(a, at(25, 40.755, -3.92))).toBe(false) // 3.9 km in 25 min
    expect(isStopBetween(a, at(10, 40.7201, -3.92))).toBe(false) // too short to be a stop
    const twoTrips = [...ride.slice(0, 10), ...ride.slice(10).map(p => ({ ...p, ts: new Date(Date.parse(p.ts) + 3 * 3_600_000).toISOString(), lat: p.lat + 0.01 }))]
    expect(gapsOf(twoTrips)).toEqual([])
    expect(splitTrips(twoTrips)).toHaveLength(2)
    const dropped = [...ride.slice(0, 10), ...ride.slice(10).map(p => ({ ...p, ts: new Date(Date.parse(p.ts) + 25 * 60_000).toISOString(), lat: p.lat + 0.035 }))]
    expect(gapsOf(dropped)).toHaveLength(1)
    expect(splitTrips(dropped)).toHaveLength(1)
  })
})

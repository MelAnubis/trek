/**
 * Tracking en vivo 5.7.3 — drawing the track along streets and paths.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { cleanTrack, costingFor, linesNow, matchTrack, stretches } from '../../../../src/components/Tracking/mapMatch'
import { resetValhallaTurns } from '../../../../src/tours/routing/valhalla'
import type { TrackPoint } from '../../../../src/components/Tracking/trackingModel'

const t0 = Date.parse('2026-10-29T10:00:00Z')
const pt = (i: number, lat: number, lng: number, motion = 'walking', accuracy = 8): TrackPoint =>
  ({ ts: new Date(t0 + i * 30_000).toISOString(), lat, lng, motion, accuracy })

/** Google polyline, precision 6 — what Valhalla answers with. */
function encode(coords: [number, number][]): string {
  let out = ''; let pLat = 0; let pLng = 0
  const enc = (v: number) => { let s = v < 0 ? ~(v << 1) : v << 1; let r = ''; while (s >= 0x20) { r += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5 } return r + String.fromCharCode(s + 63) }
  for (const [lat, lng] of coords) { const a = Math.round(lat * 1e6); const b = Math.round(lng * 1e6); out += enc(a - pLat) + enc(b - pLng); pLat = a; pLng = b }
  return out
}

describe('cleanTrack', () => {
  it('drops a fix that jumps out and straight back', () => {
    const pts = [pt(0, 40.0, -3.0), pt(1, 40.0005, -3.0), pt(2, 40.003, -3.003), pt(3, 40.001, -3.0), pt(4, 40.0015, -3.0)]
    const cleaned = cleanTrack(pts)
    expect(cleaned.map(p => p.lat)).not.toContain(40.003)
    expect(cleaned[0]).toBe(pts[0])
    expect(cleaned[cleaned.length - 1]).toBe(pts[4])
  })

  it('drops stand-still jitter within the accuracy, but not while driving', () => {
    const still = [pt(0, 40, -3, 'stationary', 20), pt(1, 40.00005, -3.00005, 'stationary', 20), pt(2, 40.0001, -3, 'stationary', 20), pt(3, 40.002, -3)]
    expect(cleanTrack(still).length).toBe(2)
    const car = [pt(0, 40, -3, 'driving'), pt(1, 40.00005, -3, 'driving'), pt(2, 40.0001, -3, 'driving'), pt(3, 40.002, -3, 'driving')]
    expect(cleanTrack(car).length).toBe(4)
  })
})

describe('stretches', () => {
  it('cut where the way of travelling changes, sharing the cut point; coloured by most of it', () => {
    const pts = [pt(0, 40, -3), pt(1, 40.001, -3), pt(2, 40.002, -3, 'stationary'), pt(3, 40.003, -3),
      pt(4, 40.01, -3, 'cycling'), pt(5, 40.02, -3, 'cycling'), pt(6, 40.03, -3, 'cycling')]
    const s = stretches(pts)
    expect(s.map(x => x.costing)).toEqual(['pedestrian', 'bicycle'])
    expect(s[0].motion).toBe('walking')
    expect(s[1].points[0]).toBe(s[0].points[s[0].points.length - 1])
  })

  it('a long pause starts a new stretch with no shared point', () => {
    const late = { ...pt(3, 40.003, -3), ts: new Date(t0 + 60 * 60_000).toISOString() }
    const s = stretches([pt(0, 40, -3), pt(1, 40.001, -3), pt(2, 40.002, -3), late, { ...late, ts: new Date(t0 + 61 * 60_000).toISOString(), lat: 40.004 }])
    expect(s).toHaveLength(2)
    expect(s[1].points[0]).toBe(late)
  })

  it('costing from motion', () => {
    expect(costingFor('driving')).toBe('auto')
    expect(costingFor('cycling')).toBe('bicycle')
    expect(costingFor('running')).toBe('pedestrian')
    expect(costingFor(null)).toBe('pedestrian')
  })
})

describe('matchTrack', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { resetValhallaTurns(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  const walk = [pt(0, 40, -3), pt(1, 40.001, -3), pt(2, 40.002, -3.001), pt(3, 40.003, -3.001)]

  it('asks Valhalla trace_route with map_snap and the stretch costing, and draws its shape', async () => {
    const road: [number, number][] = [[40, -3], [40.0004, -3.0002], [40.001, -3], [40.002, -3.001], [40.003, -3.001]]
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ trip: { legs: [{ shape: encode(road) }] } }), { status: 200 }))
    const lines = await matchTrack(walk)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/trace_route$/)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ costing: 'pedestrian', shape_match: 'map_snap', use_timestamps: true })
    expect(body.shape[0]).toMatchObject({ lat: 40, lon: -3 })
    expect(lines).toHaveLength(1)
    expect(lines[0].matched).toBe(true)
    expect(lines[0].positions).toHaveLength(5)
  })

  it('a stretch the router cannot match is drawn from the cleaned points', async () => {
    fetchMock.mockResolvedValue(new Response('{"error_code":442}', { status: 400 }))
    const lines = await matchTrack(walk)
    expect(lines[0].matched).toBe(false)
    expect(lines[0].positions).toEqual(walk.map(p => [p.lat, p.lng]))
  })

  it('cached stretches are drawn at once and not asked again', async () => {
    const cache = new Map<string, [number, number][]>()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ trip: { legs: [{ shape: encode([[40, -3], [40.003, -3.001]]) }] } }), { status: 200 }))
    await matchTrack(walk, { cache })
    expect(linesNow(walk, cache)[0].matched).toBe(true)
    await matchTrack(walk, { cache })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

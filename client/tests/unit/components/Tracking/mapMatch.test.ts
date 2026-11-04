/**
 * Tracking en vivo 5.7.3 — drawing the track along streets and paths.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { cleanTrack, costingFor, gapsOf, linesNow, matchTrack, stretches } from '../../../../src/components/Tracking/mapMatch'
import { lineStyle } from '../../../../src/components/Tracking/useMatchedTrack'
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
    // A walk of six minutes, a stop in it, then a ride.
    const walkPart = Array.from({ length: 12 }, (_, i) => pt(i, 40 + i * 0.0003, -3, i === 5 ? 'stationary' : 'walking'))
    const pts = [...walkPart, pt(12, 40.01, -3, 'cycling'), pt(13, 40.02, -3, 'cycling'), pt(14, 40.03, -3, 'cycling')]
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

  // A walk: ~55 m every 30 s.
  const walk = [pt(0, 40, -3), pt(1, 40.0005, -3), pt(2, 40.001, -3.0005), pt(3, 40.0015, -3.0005)]

  it('asks Valhalla trace_route with map_snap and the stretch costing, and draws its shape', async () => {
    const road: [number, number][] = [[40, -3], [40.0002, -3.0001], [40.0005, -3], [40.001, -3.0005], [40.0015, -3.0005]]
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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ trip: { legs: [{ shape: encode([[40, -3], [40.0005, -3], [40.001, -3.0005], [40.0015, -3.0005]]) }] } }), { status: 200 }))
    await matchTrack(walk, { cache })
    expect(linesNow(walk, cache)[0].matched).toBe(true)
    await matchTrack(walk, { cache })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * 5.7.7 — a real round trip from a phone that stopped recording with the
 * screen off: a short walk, ~4 km with no fixes at all, and the walk on the
 * other side. Synthetic coordinates with the same shape as the report.
 */
describe('holes in the recording (5.7.7)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { resetValhallaTurns(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  const at = (min: number, lat: number, lng: number, motion = 'walking'): TrackPoint =>
    ({ ts: new Date(t0 + min * 60_000).toISOString(), lat, lng, motion, accuracy: 8 })
  const before = [at(0, 40.5200, -3.5000), at(1, 40.5195, -3.4995), at(2, 40.5190, -3.4990), at(3, 40.5185, -3.4985)]
  // ~3.9 km west-south-west, 8 minutes later: a drive the phone did not record.
  const after = [at(11, 40.5117, -3.5440), at(12, 40.5112, -3.5446), at(13, 40.5108, -3.5450), at(14, 40.5104, -3.5455)]
  const day = [...before, ...after]

  it('finds the hole, how long and how far, and guesses it was driven', () => {
    const gaps = gapsOf(day)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].distanceM).toBeGreaterThan(3500)
    expect(gaps[0].durationMs).toBe(8 * 60_000)
    expect(gaps[0].costing).toBe('auto')
    // A short pause on one spot, or an overnight, is no hole to draw.
    expect(gapsOf(before)).toHaveLength(0)
    expect(gapsOf([...before, { ...after[0], ts: new Date(t0 + 10 * 3_600_000).toISOString() }])).toHaveLength(0)
  })

  it('draws the hole straight and marked as a guess until it is routed', () => {
    const lines = linesNow(day)
    expect(lines.map(l => !!l.inferred)).toEqual([false, true, false])
    expect(lines[1].positions).toEqual([[before[3].lat, before[3].lng], [after[0].lat, after[0].lng]])
    expect(lineStyle(lines[1], true)).toMatchObject({ dashArray: '1 8', opacity: 0.5 })
  })

  it('routes the hole along the roads by car, and keeps the guess apart from the recording', async () => {
    const road: [number, number][] = [[before[3].lat, before[3].lng], [40.515, -3.52], [after[0].lat, after[0].lng]]
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/route')) return new Response(JSON.stringify({ trip: { legs: [{ shape: encode(road) }] } }), { status: 200 })
      return new Response(JSON.stringify({ trip: { legs: [{ shape: encode([[40.52, -3.5], [40.5185, -3.4985]]) }] } }), { status: 200 })
    })
    const lines = await matchTrack(day)
    const routeCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/route'))!
    const body = JSON.parse((routeCall[1] as RequestInit).body as string)
    expect(body.costing).toBe('auto')
    expect(body.locations).toHaveLength(2)
    expect(lines[1]).toMatchObject({ inferred: true, matched: true })
    expect(lines[1].positions).toHaveLength(3)
  })

  it('an unbelievable detour stays a straight guess', async () => {
    const detour: [number, number][] = [[before[3].lat, before[3].lng], [41.2, -3.0], [after[0].lat, after[0].lng]]
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith('/route')
      ? new Response(JSON.stringify({ trip: { legs: [{ shape: encode(detour) }] } }), { status: 200 })
      : new Response('{}', { status: 400 })))
    const lines = await matchTrack(day)
    expect(lines[1].matched).toBe(false)
    expect(lines[1].positions).toHaveLength(2)
  })

  it('a stretch too sparse to trace (a fix every km) is routed through its fixes when the trace fails (5.7.19: traced first)', async () => {
    const car = [at(0, 40.50, -3.50, 'driving'), at(1, 40.51, -3.50, 'driving'), at(2, 40.52, -3.50, 'driving'), at(3, 40.53, -3.50, 'driving')]
    const road: [number, number][] = [[40.50, -3.50], [40.505, -3.501], [40.51, -3.50], [40.52, -3.50], [40.53, -3.50]]
    fetchMock
      .mockResolvedValueOnce(new Response('{"error_code":442}', { status: 400 }))
      .mockResolvedValue(new Response(JSON.stringify({ trip: { legs: [{ shape: encode(road) }] } }), { status: 200 }))
    const lines = await matchTrack(car)
    expect(fetchMock.mock.calls.map(c => String(c[0]).split('/').pop())).toEqual(['trace_route', 'route'])
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(body.locations.map((l: { type: string }) => l.type)).toEqual(['break', 'through', 'through', 'break'])
    expect(lines[0]).toMatchObject({ matched: true })
    expect(lines[0].inferred).toBeUndefined()
  })
})


/**
 * 5.7.15 — a real ride (2 Nov 2026, El Boalo – Becerril – Mataelpino) the phone
 * called "in a vehicle" on every descent and "still" at every junction: one ride
 * cut into a dozen stretches, the fast ones matched as a car on dirt tracks.
 */
describe('the phone\'s motion, steadied (5.7.15)', () => {
  const at = (i: number, lat: number, lng: number, motion: string, sec = 10) =>
    ({ ts: new Date(t0 + i * sec * 1000).toISOString(), lat, lng, motion, accuracy: 8 }) as TrackPoint
  // ~55 m a fix every 10 s: 20 km/h.
  const ride = (from: number, n: number, motion: (i: number) => string) =>
    Array.from({ length: n }, (_, k) => at(from + k, 40.72 + (from + k) * 0.0005, -3.92, motion(from + k)))

  it('a stop at a junction and a short "car" burst stay part of the ride', async () => {
    const { effectiveMotions } = await import('../../../../src/components/Tracking/mapMatch')
    const pts = ride(0, 60, i => (i >= 20 && i < 24 ? 'stationary' : i >= 40 && i < 44 ? 'automotive' : 'cycling'))
    expect(new Set(effectiveMotions(pts))).toEqual(new Set(['cycling']))
    const s = stretches(pts)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ costing: 'bicycle', motion: 'cycling' })
  })

  it('a long fast descent read as a car between two rides is ridden; a real drive after the ride is not', async () => {
    const { effectiveMotions } = await import('../../../../src/components/Tracking/mapMatch')
    // 30 fixes (~1.6 km, 5 min) "in a vehicle" at riding speed, between two rides.
    const descent = ride(0, 100, i => (i >= 30 && i < 60 ? 'automotive' : 'cycling'))
    expect(effectiveMotions(descent).filter(m => m !== 'cycling')).toEqual([])
    // A drive home: 60 fixes 300 m apart every 10 s (108 km/h), after the ride.
    const drive = [...ride(0, 40, () => 'cycling'),
      ...Array.from({ length: 60 }, (_, k) => at(40 + k, 40.74 + k * 0.0027, -3.92, 'automotive'))]
    const m = effectiveMotions(drive)
    expect(m.slice(45)).toEqual(Array(55).fill('automotive'))
    expect(stretches(drive).map(s => s.costing)).toEqual(['bicycle', 'auto'])
  })

  it('a stretch the bike cannot be matched on is matched on foot before it is left as fixes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    resetValhallaTurns()
    const road = encode([[40.72, -3.92], [40.721, -3.92], [40.7225, -3.92]])
    fetchMock
      .mockResolvedValueOnce(new Response('{"error_code":442}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ trip: { legs: [{ shape: road }] } }), { status: 200 }))
    const pts = ride(0, 6, () => 'cycling')
    const lines = await matchTrack(pts)
    const costings = fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string).costing)
    expect(costings).toEqual(['bicycle', 'pedestrian'])
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).costing_options.bicycle).toMatchObject({ avoid_bad_surfaces: 0 })
    expect(lines[0].matched).toBe(true)
    vi.unstubAllGlobals()
  })
})

/**
 * 5.7.17 — the same ride on 2 Nov, matched: the public matcher answered "ok"
 * with only a few hundred metres of it, and an iPhone called the ride a walk.
 */
describe('a match is only taken when it covers the fixes (5.7.17)', () => {
  const at = (i: number, lat: number, lng: number, motion = 'cycling') =>
    ({ ts: new Date(t0 + i * 10_000).toISOString(), lat, lng, motion, accuracy: 8 }) as TrackPoint
  // North at ~55 m every 10 s (20 km/h).
  const ride = (n: number, motion = 'cycling') => Array.from({ length: n }, (_, i) => at(i, 40.72 + i * 0.0005, -3.92, motion))
  const along = (pts: TrackPoint[]) => pts.map(p => [p.lat, p.lng + 0.0001] as [number, number])
  const fetchMock = vi.fn()
  beforeEach(() => { resetValhallaTurns(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })
  const ok = (line: [number, number][]) => new Response(JSON.stringify({ trip: { legs: [{ shape: encode(line) }] } }), { status: 200 })

  it('a line that covers only the start of the fixes is refused, and the fixes are drawn', { timeout: 30_000 }, async () => {
    const { covers } = await import('../../../../src/components/Tracking/mapMatch')
    const pts = ride(40)
    expect(covers(along(pts), pts)).toBe(true)
    expect(covers(along(pts.slice(0, 5)), pts)).toBe(false)
    fetchMock.mockImplementation(async () => ok(along(pts.slice(0, 5))))
    const lines = await matchTrack(pts)
    expect(lines[0].matched).toBe(false)
    expect(lines[0].positions).toHaveLength(40)
  })

  it('matched in windows of about a hundred fixes; a window the matcher breaks in is traced on from where it stopped (5.7.23)', async () => {
    const { windows } = await import('../../../../src/components/Tracking/mapMatch')
    const pts = ride(250)
    const parts = windows(pts)
    expect(parts.length).toBe(3)
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { shape: { lat: number; lon: number }[] }
      const first = body.shape[0].lat
      // In the middle window the matcher breaks: it answers with its first piece only.
      if (Math.abs(first - parts[1][0].lat) < 1e-9) return ok(along(parts[1].slice(0, 30)))
      return ok(along(body.shape.map(p => ({ lat: p.lat, lng: p.lon }) as TrackPoint)))
    })
    const lines = await matchTrack(pts)
    expect(lines[0].matched).toBe(true)
    const drawn = lines[0].positions
    // The middle window is traced again from the fix after its first piece, and all of it lands on the "road".
    const starts = fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string).shape[0].lat as number)
    expect(starts.some(lat => Math.abs(lat - parts[1][30].lat) < 1e-9)).toBe(true)
    expect(drawn.some(([lat, lng]) => lat === parts[1][50].lat && lng === parts[1][50].lng)).toBe(false)
    expect(drawn.some(([lat, lng]) => Math.abs(lat - parts[1][50].lat) < 1e-6 && Math.abs(lng - parts[1][50].lng - 0.0001) < 1e-6)).toBe(true)
  })

  it('fixes the matcher leaves out (no mapped way under them) are drawn as recorded between its pieces (5.7.23)', async () => {
    const { traceThrough } = await import('../../../../src/components/Tracking/mapMatch')
    const pts = ride(30)
    // Fixes 10–14 are off the map: the matcher stops before them, and starts again after them.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { shape: { lat: number; lon: number }[] }
      const firstIdx = pts.findIndex(p => Math.abs(p.lat - body.shape[0].lat) < 1e-9)
      if (firstIdx < 10) return ok(along(pts.slice(firstIdx, 10)))
      return ok(along(pts.slice(Math.max(firstIdx, 15))))
    })
    const got = (await traceThrough(pts, 'bicycle'))!
    expect(got.requests).toBe(2)
    expect(got.placed).toBeCloseTo(25 / 30)
    for (const i of [10, 12, 14]) expect(got.line).toContainEqual([pts[i].lat, pts[i].lng])
    expect(got.line.some(([lat, lng]) => Math.abs(lat - pts[20].lat) < 1e-6 && Math.abs(lng - pts[20].lng - 0.0001) < 1e-6)).toBe(true)
  })

  it('"walking" at the speed of a bike is ridden, and so is a "car" at the start of a day ridden', async () => {
    const { effectiveMotions } = await import('../../../../src/components/Tracking/mapMatch')
    expect(new Set(effectiveMotions(ride(60, 'walking')))).toEqual(new Set(['cycling']))
    const slowWalk = Array.from({ length: 60 }, (_, i) => at(i, 40.72 + i * 0.0001, -3.92, 'walking'))
    expect(new Set(effectiveMotions(slowWalk))).toEqual(new Set(['walking']))
    const day = [...ride(40, 'automotive'), ...ride(200).map((p, i) => ({ ...p, ts: new Date(t0 + (40 + i) * 10_000).toISOString(), lat: 40.74 + i * 0.0005 }))]
    expect(new Set(effectiveMotions(day))).toEqual(new Set(['cycling']))
  })
})

/** 5.7.19 — the iPhone's ride: a fix every few hundred metres, 50–100 m off, stops counted in its "walk". */
describe('a sparse, rough recording (5.7.19)', () => {
  const at = (sec: number, lat: number, lng: number, motion: string, accuracy = 8) =>
    ({ ts: new Date(t0 + sec * 1000).toISOString(), lat, lng, motion, accuracy }) as TrackPoint

  it('a "walk" at riding speed with long stops in it is still ridden', async () => {
    const { effectiveMotions } = await import('../../../../src/components/Tracking/mapMatch')
    const pts: TrackPoint[] = []
    let sec = 0
    for (let i = 0; i < 40; i++) {
      pts.push(at(sec, 40.72 + i * 0.0005, -3.92, 'walking'))
      // 55 m in 10 s (20 km/h), and every tenth fix a three-minute stop.
      sec += i % 10 === 9 ? 180 : 10
    }
    expect(new Set(effectiveMotions(pts))).toEqual(new Set(['cycling']))
  })

  it('the matcher looks as far as the fixes are rough, and a sparse window is traced before it is routed', async () => {
    const { traceOptions } = await import('../../../../src/components/Tracking/mapMatch')
    expect(traceOptions([at(0, 40, -3, 'cycling', 8), at(10, 40.001, -3, 'cycling', 8)])).toMatchObject({ search_radius: 60, gps_accuracy: 10 })
    const rough = Array.from({ length: 10 }, (_, i) => at(i * 60, 40.72 + i * 0.005, -3.92, 'cycling', 80))
    // The public instance refuses a search radius over 100 m (5.7.23).
    expect(traceOptions(rough)).toMatchObject({ search_radius: 100, gps_accuracy: 80 })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    resetValhallaTurns()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ trip: { legs: [{ shape: encode(rough.map(p => [p.lat, p.lng + 0.0003] as [number, number])) }] } }), { status: 200 }))
    const lines = await matchTrack(rough)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/trace_route$/)
    expect(lines[0].matched).toBe(true)
    vi.unstubAllGlobals()
  })
})

/** 5.7.27 — a live ride grows every minute: only its last window is asked again. */
describe('a live ride, matched window by window (5.7.27)', () => {
  const at = (i: number) => ({ ts: new Date(t0 + i * 10_000).toISOString(), lat: 40.72 + i * 0.0005, lng: -3.92, motion: 'cycling', accuracy: 8 }) as TrackPoint
  const fetchMock = vi.fn()
  beforeEach(() => { resetValhallaTurns(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('the windows already matched come from the cache when the ride grows', { timeout: 30_000 }, async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { shape: { lat: number; lon: number }[] }
      return new Response(JSON.stringify({ trip: { legs: [{ shape: encode(body.shape.map(p => [p.lat, p.lon + 0.0001] as [number, number])) }] } }), { status: 200 })
    })
    const cache = new Map<string, [number, number][]>()
    const ride = Array.from({ length: 160 }, (_, i) => at(i))
    const first = await matchTrack(ride.slice(0, 150), { cache })
    expect(first[0].matched).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockClear()
    const grown = await matchTrack(ride, { cache })
    expect(grown[0].matched).toBe(true)
    // The first hundred fixes are the same window as before: only the last one is traced.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).shape[0].lat).toBeCloseTo(ride[99].lat, 9)
  })
})

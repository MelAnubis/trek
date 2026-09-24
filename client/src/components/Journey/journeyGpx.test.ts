// FE-JOURNEYGPX-001 to FE-JOURNEYGPX-007
import { fetchJourneyGpxTracks, buildTrailSegments, flattenWaypoints } from './journeyGpx'
import type { PdfGpxTrack } from '../PDF/gpxDrawing'

describe('fetchJourneyGpxTracks', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('FE-JOURNEYGPX-001: unwraps the days endpoint\'s { days: [...] } response so a track\'s day_id resolves to a real date/day_number, not null', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/days')) {
        // The real shape of GET /trips/:id/days (dayService.listDays) — a
        // bare array here was the bug: for...of on the wrapper object threw,
        // was swallowed by the caller's try/catch, and left every track's
        // date/day_number unset.
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ days: [{ id: 7, date: '2026-09-08', day_number: 1 }] }),
        })
      }
      if (url.includes('/gpx/') && url.includes('/points')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ points: [{ lat: 42.2, lng: 2.1, ele: 100 }] }),
        })
      }
      if (url.includes('/gpx')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 1, track_name: 'Etapa 1', is_active: true, day_id: 7, total_distance: 40 }]),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve([]) })
    }) as any

    const tracks = await fetchJourneyGpxTracks([{ trip_id: 5 }])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].date).toBe('2026-09-08')
    expect(tracks[0].day_number).toBe(1)
  })

  it('FE-JOURNEYGPX-002: captures the /points response\'s waypoints, not just its points', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/days')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ days: [] }) })
      if (url.includes('/gpx/') && url.includes('/points')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            points: [{ lat: 42.2, lng: 2.1, ele: 100 }],
            waypoints: [{ lat: 42.21, lng: 2.11, name: 'Refugio' }],
          }),
        })
      }
      if (url.includes('/gpx')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 1, track_name: 'Etapa 1', is_active: true, day_id: null }]) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve([]) })
    }) as any

    const tracks = await fetchJourneyGpxTracks([{ trip_id: 5 }])
    expect(tracks[0].waypoints).toEqual([{ lat: 42.21, lng: 2.11, name: 'Refugio' }])
  })
})

function track(points: PdfGpxTrack['points'], overrides: Partial<PdfGpxTrack> = {}): PdfGpxTrack {
  return {
    id: 1, track_name: 'Stage', total_distance: 0, total_elevation_gain: 0,
    total_elevation_loss: 0, max_elevation: null, min_elevation: null, points, ...overrides,
  }
}

describe('buildTrailSegments', () => {
  it('FE-JOURNEYGPX-003: merges consecutive tracks with no (or the same) transport mode into one segment, in order', () => {
    const tracks = [
      track([{ lat: 1, lng: 2, ele: null }, { lat: 3, lng: 4, ele: null }]),
      track([{ lat: 5, lng: 6, ele: null }]),
    ]
    const segments = buildTrailSegments(tracks)
    expect(segments).toHaveLength(1)
    expect(segments[0].points).toEqual([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }])
    expect(segments[0].color).toBeUndefined()
  })

  it('FE-JOURNEYGPX-004: splits into separate colored segments when transport_mode changes between tracks', () => {
    const tracks = [
      track([{ lat: 1, lng: 1, ele: null }, { lat: 2, lng: 2, ele: null }], { transport_mode: 'hiking' }),
      track([{ lat: 3, lng: 3, ele: null }, { lat: 4, lng: 4, ele: null }], { transport_mode: 'cycling' }),
    ]
    const segments = buildTrailSegments(tracks)
    expect(segments).toHaveLength(2)
    expect(segments[0].points).toEqual([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])
    expect(segments[1].points).toEqual([{ lat: 3, lng: 3 }, { lat: 4, lng: 4 }])
    expect(segments[0].color).not.toBe(segments[1].color)
    expect(segments[0].color).toBeTruthy()
    expect(segments[1].color).toBeTruthy()
  })

  it('FE-JOURNEYGPX-005: returns an empty list for no tracks or tracks with no points', () => {
    expect(buildTrailSegments([])).toEqual([])
    expect(buildTrailSegments([track([])])).toEqual([])
  })
})

describe('flattenWaypoints', () => {
  it('FE-JOURNEYGPX-006: flattens every track\'s named waypoints with stable, unique ids', () => {
    const tracks = [
      track([], { id: 10, waypoints: [{ lat: 1, lng: 1, name: 'Start' }, { lat: 2, lng: 2, name: 'Refugio' }] }),
      track([], { id: 11, waypoints: [{ lat: 3, lng: 3, name: 'Summit' }] }),
    ]
    const waypoints = flattenWaypoints(tracks)
    expect(waypoints).toEqual([
      { id: '10-0', lat: 1, lng: 1, name: 'Start' },
      { id: '10-1', lat: 2, lng: 2, name: 'Refugio' },
      { id: '11-0', lat: 3, lng: 3, name: 'Summit' },
    ])
  })

  it('FE-JOURNEYGPX-007: returns an empty list when no track has waypoints', () => {
    expect(flattenWaypoints([track([])])).toEqual([])
  })
})

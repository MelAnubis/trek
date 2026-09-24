// FE-JOURNEYGPX-001 to FE-JOURNEYGPX-003
import { fetchJourneyGpxTracks, flattenGpxTrail } from './journeyGpx'
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
})

function track(points: PdfGpxTrack['points']): PdfGpxTrack {
  return {
    id: 1, track_name: 'Stage', total_distance: 0, total_elevation_gain: 0,
    total_elevation_loss: 0, max_elevation: null, min_elevation: null, points,
  }
}

describe('flattenGpxTrail', () => {
  it('FE-JOURNEYGPX-002: flattens every track\'s points, in order, into a plain lat/lng list', () => {
    const tracks = [
      track([{ lat: 1, lng: 2, ele: null }, { lat: 3, lng: 4, ele: null }]),
      track([{ lat: 5, lng: 6, ele: null }]),
    ]
    expect(flattenGpxTrail(tracks)).toEqual([
      { lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 },
    ])
  })

  it('FE-JOURNEYGPX-003: returns an empty list for no tracks or tracks with no points', () => {
    expect(flattenGpxTrail([])).toEqual([])
    expect(flattenGpxTrail([track([])])).toEqual([])
  })
})

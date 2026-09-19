// FE-JOURNEYGPX-001
import { fetchJourneyGpxTracks } from './journeyGpx'

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

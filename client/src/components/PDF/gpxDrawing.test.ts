// FE-GPXDRAW-001 to FE-GPXDRAW-021
import { computeRouteStats, groupTracksByDate, resolveSafeTileUrl, runWithConcurrency, DEFAULT_TILE_URL, type PdfGpxTrack } from './gpxDrawing'

function track(overrides: Partial<PdfGpxTrack> = {}): PdfGpxTrack {
  return {
    id: 1, track_name: 'Stage', total_distance: 10, total_elevation_gain: 100,
    total_elevation_loss: 100, max_elevation: 500, min_elevation: 100,
    points: [{ lat: 41, lng: 2, ele: 100 }, { lat: 41.1, lng: 2.1, ele: 200 }],
    date: null, day_number: null,
    ...overrides,
  }
}

const DAYS = ['2026-04-01', '2026-04-02', '2026-04-03']

describe('groupTracksByDate', () => {
  it('FE-GPXDRAW-001: a track with a date matching a known day is grouped under that date', () => {
    const t = track({ id: 1, date: '2026-04-02' })
    const { byDate, unmatched } = groupTracksByDate([t], DAYS)
    expect(byDate.get('2026-04-02')).toEqual([t])
    expect(unmatched).toEqual([])
  })

  it('FE-GPXDRAW-002: a track whose date is not among the known days is unmatched', () => {
    const t = track({ id: 1, date: '2099-01-01' })
    const { byDate, unmatched } = groupTracksByDate([t], DAYS)
    expect(byDate.size).toBe(0)
    expect(unmatched).toEqual([t])
  })

  it('FE-GPXDRAW-003: an undated continuous track with real timestamps splits by day', () => {
    const t = track({
      id: 1, date: null,
      points: [
        { lat: 41, lng: 2, ele: 100, time: '2026-04-01T09:00:00Z' },
        { lat: 41.05, lng: 2.05, ele: 150, time: '2026-04-01T12:00:00Z' },
        { lat: 41.2, lng: 2.2, ele: 200, time: '2026-04-02T09:00:00Z' },
        { lat: 41.25, lng: 2.25, ele: 250, time: '2026-04-02T12:00:00Z' },
      ],
    })
    const { byDate, unmatched } = groupTracksByDate([t], DAYS)
    expect([...byDate.keys()].sort()).toEqual(['2026-04-01', '2026-04-02'])
    expect(unmatched).toEqual([]) // fully consumed by date fragments
  })

  it('FE-GPXDRAW-004: a day-linked track with only day_number pairs with the journal\'s Nth day by position', () => {
    const t = track({ id: 1, date: null, day_number: 2 })
    const { byDate, unmatched } = groupTracksByDate([t], DAYS)
    expect(byDate.get('2026-04-02')?.[0].id).toBe(1)
    expect(byDate.get('2026-04-02')?.[0].date).toBe('2026-04-02') // annotated with the resolved date
    expect(unmatched).toEqual([])
  })

  it('FE-GPXDRAW-005: a track with no date, no timestamps and no day_number is left unmatched', () => {
    const t = track({
      id: 1, date: null, day_number: null,
      points: [{ lat: 41, lng: 2, ele: 100 }, { lat: 41.1, lng: 2.1, ele: 200 }], // no `time`
    })
    const { byDate, unmatched } = groupTracksByDate([t], DAYS)
    expect(byDate.size).toBe(0)
    expect(unmatched).toEqual([t])
  })

  it('FE-GPXDRAW-006: day_number is only used as a last resort, after a date match is tried', () => {
    // date matches a *different* day than day_number would — date wins.
    const t = track({ id: 1, date: '2026-04-03', day_number: 1 })
    const { byDate } = groupTracksByDate([t], DAYS)
    expect(byDate.has('2026-04-03')).toBe(true)
    expect(byDate.has('2026-04-01')).toBe(false)
  })
})

describe('resolveSafeTileUrl', () => {
  it('FE-GPXDRAW-007: substitutes the CartoDB default for tile.openstreetmap.org — osm.org\'s usage policy refuses exactly this kind of bulk, programmatic request', () => {
    expect(resolveSafeTileUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(DEFAULT_TILE_URL)
  })

  it('FE-GPXDRAW-008: substitutes for tile.openstreetmap.de too', () => {
    expect(resolveSafeTileUrl('https://a.tile.openstreetmap.de/{z}/{x}/{y}.png')).toBe(DEFAULT_TILE_URL)
  })

  it('FE-GPXDRAW-009: leaves a self-hosted or third-party tile server untouched', () => {
    const custom = 'https://maps.example.com/{z}/{x}/{y}.png'
    expect(resolveSafeTileUrl(custom)).toBe(custom)
  })

  it('FE-GPXDRAW-010: leaves the CartoDB default itself untouched', () => {
    expect(resolveSafeTileUrl(DEFAULT_TILE_URL)).toBe(DEFAULT_TILE_URL)
  })
})

describe('runWithConcurrency', () => {
  it('FE-GPXDRAW-011: runs every job exactly once', async () => {
    const seen: number[] = []
    const jobs = Array.from({ length: 20 }, (_, i) => async () => { seen.push(i) })
    await runWithConcurrency(jobs, 6)
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('FE-GPXDRAW-012: never runs more than `limit` jobs at once — the whole point, vs. firing everything in one Promise.all burst', async () => {
    let active = 0
    let maxActive = 0
    const jobs = Array.from({ length: 30 }, () => async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(r => setTimeout(r, 1))
      active--
    })
    await runWithConcurrency(jobs, 6)
    expect(maxActive).toBeLessThanOrEqual(6)
  })

  it('FE-GPXDRAW-013: with fewer jobs than the limit, still runs them all', async () => {
    const seen: number[] = []
    const jobs = [0, 1, 2].map(i => async () => { seen.push(i) })
    await runWithConcurrency(jobs, 6)
    expect(seen.sort()).toEqual([0, 1, 2])
  })

  it('FE-GPXDRAW-014: an empty job list resolves immediately without error', async () => {
    await expect(runWithConcurrency([], 6)).resolves.toBeUndefined()
  })
})

// Points spaced ~222m apart (0.002° latitude), climbing 50m per step — a
// sustained ~22% grade, well past the 200m lookback window's minimum
// distance, so computeRouteStats' slope detection has a real climb to find.
function climbTrack(overrides: Partial<PdfGpxTrack> = {}): PdfGpxTrack {
  return track({
    points: [
      { lat: 41, lng: 2, ele: 100 },
      { lat: 41.002, lng: 2, ele: 150 },
      { lat: 41.004, lng: 2, ele: 200 },
      { lat: 41.006, lng: 2, ele: 250 },
      { lat: 41.008, lng: 2, ele: 300 },
      { lat: 41.010, lng: 2, ele: 350 },
    ],
    ...overrides,
  })
}

describe('computeRouteStats', () => {
  it('FE-GPXDRAW-015: distance and elevation gain/loss sum across every track', () => {
    const stats = computeRouteStats([
      track({ total_distance: 10, total_elevation_gain: 100, total_elevation_loss: 80 }),
      track({ total_distance: 15, total_elevation_gain: 200, total_elevation_loss: 120 }),
    ])
    expect(stats.totalDist).toBe(25)
    expect(stats.gain).toBe(300)
    expect(stats.loss).toBe(200)
  })

  it('FE-GPXDRAW-016: min/max elevation are the extremes across tracks, not a sum', () => {
    const stats = computeRouteStats([
      track({ max_elevation: 500, min_elevation: 100 }),
      track({ max_elevation: 900, min_elevation: 50 }),
    ])
    expect(stats.maxEle).toBe(900)
    expect(stats.minEle).toBe(50)
  })

  it('FE-GPXDRAW-017: IBP is the highest of any track that has one; tracks without one are ignored', () => {
    const stats = computeRouteStats([
      track({ ibp: 40 }),
      track({ ibp: null }),
      track({ ibp: 92 }),
    ])
    expect(stats.ibp).toBe(92)
  })

  it('FE-GPXDRAW-018: IBP is null when no track has one', () => {
    const stats = computeRouteStats([track({ ibp: null }), track({ ibp: undefined })])
    expect(stats.ibp).toBeNull()
  })

  it('FE-GPXDRAW-019: max slope is 0 for a track with fewer than two elevation points', () => {
    const stats = computeRouteStats([track({ points: [{ lat: 41, lng: 2, ele: 100 }] })])
    expect(stats.maxSlope).toBe(0)
  })

  it('FE-GPXDRAW-020: max slope is a real positive percentage for a track with a sustained climb', () => {
    const stats = computeRouteStats([climbTrack()])
    expect(stats.maxSlope).toBeGreaterThan(10)
    expect(stats.maxSlope).toBeLessThan(40)
  })

  it('FE-GPXDRAW-021: an empty tracks array returns all-zero/null stats without throwing', () => {
    expect(computeRouteStats([])).toEqual({
      totalDist: 0, gain: 0, loss: 0, minEle: null, maxEle: null, maxSlope: 0, ibp: null,
    })
  })
})

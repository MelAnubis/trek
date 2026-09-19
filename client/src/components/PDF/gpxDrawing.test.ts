// FE-GPXDRAW-001 to FE-GPXDRAW-010
import { groupTracksByDate, resolveSafeTileUrl, DEFAULT_TILE_URL, type PdfGpxTrack } from './gpxDrawing'

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

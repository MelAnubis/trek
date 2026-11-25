import { describe, it, expect, beforeEach } from 'vitest'
import { GpxRecorderService } from '../../../src/services/gpxRecorderService'
import { spokenDistance, spokenDuration, spokenManeuver } from '../../../src/services/navVoice'
import { routeTiles, canDownloadLayer, MAX_ROUTE_TILES } from '../../../src/services/navTiles'
import { saveNavDraft, loadNavDraft, clearNavDraft } from '../../../src/services/navDraftStore'

// ~111 m per 0.001° of latitude
const T0 = 1_700_000_000_000

describe('GpxRecorderService — pause and segments', () => {
  it('keeps no point while paused and cuts the track after resuming', () => {
    const r = new GpxRecorderService()
    r.start()
    r.addPoint(40.000, -3.0, 600, 3, T0)
    r.addPoint(40.001, -3.0, 602, 3, T0 + 40_000)
    r.pause()
    r.addPoint(40.002, -3.0, 604, 3, T0 + 80_000)
    expect(r.points).toHaveLength(2)
    r.resume()
    r.addPoint(40.010, -3.0, 610, 3, T0 + 600_000)
    r.addPoint(40.011, -3.0, 611, 3, T0 + 640_000)
    expect(r.points).toHaveLength(4)
    expect(r.points[2].newSegment).toBe(true)
    // Distance only inside each segment: two ~111 m stretches, not the 1 km gap.
    expect(r.totalDistanceM()).toBeGreaterThan(200)
    expect(r.totalDistanceM()).toBeLessThan(250)
    const gpx = r.exportGpx('x')
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2)
    expect(gpx.match(/<\/trkseg>/g)).toHaveLength(2)
  })

  it('carries on a restored recording, starting a new segment', () => {
    const r = new GpxRecorderService()
    const pts = [
      { lat: 40, lng: -3, alt: null, speed: null, timestamp: T0 },
      { lat: 40.001, lng: -3, alt: null, speed: null, timestamp: T0 + 30_000 },
    ]
    r.start({ points: pts, startTime: T0 })
    r.addPoint(40.005, -3, null, null, T0 + 900_000)
    expect(r.points).toHaveLength(3)
    expect(r.points[2].newSegment).toBe(true)
    expect(r.isRunning).toBe(true)
  })

  it('load() shows a recording without recording', () => {
    const r = new GpxRecorderService()
    r.load([{ lat: 40, lng: -3, alt: null, speed: null, timestamp: T0 }], T0)
    r.addPoint(40.001, -3, null, null, T0 + 10_000)
    expect(r.points).toHaveLength(1)
    expect(r.isRunning).toBe(false)
  })
})

describe('navVoice sentences', () => {
  it('reads distances as people say them', () => {
    expect(spokenDistance(42)).toBe('40 metros')
    expect(spokenDistance(480)).toBe('500 metros')
    expect(spokenDistance(1000)).toBe('1 kilómetro')
    expect(spokenDistance(3000)).toBe('3 kilómetros')
    expect(spokenDistance(3540)).toBe('3,5 kilómetros')
    expect(spokenDistance(12_400)).toBe('12 kilómetros')
  })
  it('reads durations', () => {
    expect(spokenDuration(60)).toBe('1 minuto')
    expect(spokenDuration(45 * 60)).toBe('45 minutos')
    expect(spokenDuration(3600)).toBe('1 hora')
    expect(spokenDuration(2 * 3600 + 5 * 60)).toBe('2 horas y 5 minutos')
  })
  it('reads maneuvers', () => {
    expect(spokenManeuver('turn', 'left')).toBe('gira a la izquierda')
    expect(spokenManeuver('turn', 'slight right')).toBe('ligeramente a la derecha')
    expect(spokenManeuver('roundabout')).toBe('entra en la rotonda')
  })
})

describe('navTiles — route corridor', () => {
  it('only Topo and Ciclismo can be downloaded', () => {
    expect(canDownloadLayer('topo')).toBe(true)
    expect(canDownloadLayer('cyclosm')).toBe(true)
    expect(canDownloadLayer('osm')).toBe(false)
    expect(canDownloadLayer('dark')).toBe(false)
  })

  it('a 20 km route is a corridor of a few hundred tiles, no duplicates', () => {
    const pts = Array.from({ length: 400 }, (_, i) => ({ lat: 40 + i * 0.00045, lng: -3.7 }))
    const tiles = routeTiles(pts)
    const keys = new Set(tiles.map(t => `${t.z}/${t.x}/${t.y}`))
    expect(keys.size).toBe(tiles.length)
    expect(tiles.length).toBeGreaterThan(50)
    expect(tiles.length).toBeLessThan(MAX_ROUTE_TILES)
    expect(new Set(tiles.map(t => t.z))).toEqual(new Set([12, 13, 14, 15, 16]))
  })
})

describe('navDraftStore', () => {
  beforeEach(async () => { await clearNavDraft() })

  const draft = {
    startedAt: T0,
    points: [
      { lat: 40, lng: -3, alt: null, speed: null, timestamp: T0 },
      { lat: 40.001, lng: -3, alt: null, speed: null, timestamp: T0 + 10_000 },
    ],
    pausedMs: 0,
    elevationGainM: 12,
    elevationLossM: 3,
    path: '/navigate?tripId=1',
    trackName: 'Ruta',
    tripId: 1,
    following: false,
  }

  it('saves, loads and clears the recording in progress', async () => {
    await saveNavDraft(draft)
    const d = await loadNavDraft()
    expect(d?.points).toHaveLength(2)
    expect(d?.path).toBe('/navigate?tripId=1')
    expect(d?.updatedAt).toBeGreaterThan(0)
    await clearNavDraft()
    expect(await loadNavDraft()).toBeNull()
  })

  it('ignores a draft with a single point', async () => {
    await saveNavDraft({ ...draft, points: draft.points.slice(0, 1) })
    expect(await loadNavDraft()).toBeNull()
  })
})

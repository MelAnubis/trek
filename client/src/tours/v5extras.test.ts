// FE-TOUR-STAGE-001 … / FE-TOUR-POI-001 … / FE-TOUR-WAYS-001 — etapas, a lo largo de la ruta y superficies (TREK v5)
import { describe, it, expect } from 'vitest'
import { stageSpansOf, tourStagesOf, stageBoundariesM, stopNameOf } from './stages'
import { overpassQuery, placeAgainstLine, poisFrom, thinned } from './poi/poiSearch'
import { routeWaysFrom, sharesBy, unpavedShareOf, stretchesOf } from './ways/routeWays'

// A line due north, 0.01° (≈1.1 km) a step, climbing 100 m a step.
const line = Array.from({ length: 11 }, (_, i) => [41 + i * 0.01, -4, 800 + i * 100])
const pts = [{ lat: 41, lng: -4 }, { lat: 41.05, lng: -4, stage_end: true, name: 'Refugio' }, { lat: 41.1, lng: -4 }]

describe('stages', () => {
  it('FE-TOUR-STAGE-001: stage ends between start and end cut the tour into stages', () => {
    expect(stageSpansOf(pts)).toEqual([{ number: 1, from: 0, to: 1 }, { number: 2, from: 1, to: 2 }])
    expect(stageSpansOf([{ stage_end: true }, {}])).toHaveLength(1)
  })

  it('FE-TOUR-STAGE-002: each stage is measured on the one line: distance, climb and DIN time apart', () => {
    const stages = tourStagesOf({ points: pts, line, tourType: 'hike', routerSeconds: null, runPaceSecondsPerKm: null })
    expect(stages).toHaveLength(2)
    expect(stages[0].distanceKm).toBeCloseTo(5.56, 1)
    expect(stages[0].gain).toBe(500)
    expect(stages[1].gain).toBe(500)
    expect(stages[0].minutes).toBeGreaterThan(60)
    expect(stageBoundariesM(stages)[0]).toBeCloseTo(5560, -2)
    expect(stopNameOf(pts, 1, n => `P${n}`)).toBe('Refugio')
    expect(stopNameOf(pts, 2, n => `P${n}`)).toBe('P3')
  })

  it('FE-TOUR-STAGE-003: a bike tour shares the router time out by distance', () => {
    const stages = tourStagesOf({ points: pts, line, tourType: 'bike', routerSeconds: 3600, runPaceSecondsPerKm: null })
    expect(stages[0].minutes! + stages[1].minutes!).toBe(60)
  })
})

describe('along the tour', () => {
  it('FE-TOUR-POI-001: the query asks every category around the line itself', () => {
    const q = overpassQuery([[41, -4], [41.1, -4]], ['drinking_water', 'viewpoint'], 500)
    expect(q).toContain('node["amenity"="drinking_water"](around:500,41.00000,-4.00000,41.10000,-4.00000);')
    expect(q).toContain('["tourism"="viewpoint"]')
    expect(thinned(Array.from({ length: 500 }, (_, i) => [i, i] as [number, number]), 10)).toHaveLength(10)
  })

  it('FE-TOUR-POI-002: places are placed against the line, kept within the corridor, and listed from the start', () => {
    const l: [number, number][] = [[41, -4], [41.1, -4]]
    expect(placeAgainstLine(41.05, -4, l).distance).toBeLessThan(1)
    expect(placeAgainstLine(41.05, -4, l).along).toBeCloseTo(5566, -2)
    const answer = poisFrom({ elements: [
      { type: 'node', id: 2, lat: 41.08, lon: -4.002, tags: { tourism: 'viewpoint', name: 'Mirador' } },
      { type: 'node', id: 1, lat: 41.02, lon: -4, tags: { amenity: 'drinking_water' } },
      { type: 'node', id: 3, lat: 41.05, lon: -3.9, tags: { amenity: 'drinking_water', name: 'Lejos' } },
    ] }, l, ['drinking_water', 'viewpoint'], 500, c => `(${c})`)
    expect(answer.pois.map(p => p.name)).toEqual(['(drinking_water)', 'Mirador'])
    expect(answer.pois[1].category).toBe('viewpoint')
    expect(answer.pois[1].distance_m).toBeGreaterThan(100)
  })
})

describe('surface and ways', () => {
  it('FE-TOUR-WAYS-001: the router answer reads as shares of surface and kind of way', () => {
    // polyline6 of (41,-4) (41.01,-4) (41.02,-4)
    const shape = '_c`|lA~ehbG_ia@?_ia@?'
    const ways = routeWaysFrom({ shape, edges: [
      { surface: 'paved_smooth', use: 'cycleway', length: 1, begin_shape_index: 0, end_shape_index: 1 },
      { surface: 'gravel', use: 'track', length: 3, begin_shape_index: 1, end_shape_index: 2 },
    ] })!
    expect(ways).not.toBeNull()
    const surfaces = sharesBy(ways, e => e.surface)
    expect(surfaces[0]).toMatchObject({ key: 'gravel', share: 0.75 })
    expect(unpavedShareOf(ways)).toBe(0.75)
    expect(stretchesOf(ways, e => e.way === 'track')).toHaveLength(1)
  })
})

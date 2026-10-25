// FE-PLAN5-001 … — mejoras del Plan (TREK v5)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../helpers/render'
import { resetAllStores, seedStore } from '../../helpers/store'
import { useTripStore } from '../../../src/store/tripStore'
import { assignmentsApi } from '../../../src/api/client'
import { routeLabelInner } from '../../../src/components/Map/routeLabel'
import { navUrl, navAppName } from '../../../src/utils/navApps'
import type { Assignment } from '../../../src/types'

beforeEach(() => { resetAllStores(); vi.restoreAllMocks() })

const a = (id: number, placeId: number): Assignment => ({ id, day_id: 1, order_index: id, notes: null, place: { id: placeId, name: `P${placeId}` } as never })

describe('Plan v5', () => {
  it('FE-PLAN5-001: clear day empties the day at once, hands back what it took, and restore puts it back', async () => {
    seedStore(useTripStore, { assignments: { '1': [a(1, 10), a(2, 11)] } })
    vi.spyOn(assignmentsApi, 'clearDay').mockResolvedValue({ removed: [{ place_id: 10 } as never, { place_id: 11 } as never] })
    const removed = await useTripStore.getState().clearDay(5, 1)
    expect(useTripStore.getState().assignments['1']).toEqual([])
    expect(removed).toHaveLength(2)
    vi.spyOn(assignmentsApi, 'restoreDay').mockResolvedValue({ assignments: [a(7, 10), a(8, 11)] })
    await useTripStore.getState().restoreDay(5, 1, removed)
    expect(useTripStore.getState().assignments['1'].map(x => x.id)).toEqual([7, 8])
  })

  it('FE-PLAN5-002: a failed clear puts the day back as it was', async () => {
    seedStore(useTripStore, { assignments: { '1': [a(1, 10)] } })
    vi.spyOn(assignmentsApi, 'clearDay').mockRejectedValue(new Error('boom'))
    await expect(useTripStore.getState().clearDay(5, 1)).rejects.toThrow()
    expect(useTripStore.getState().assignments['1']).toHaveLength(1)
  })

  it('FE-PLAN5-003: leave out of route flips at once and rolls back on failure', async () => {
    seedStore(useTripStore, { assignments: { '1': [a(1, 10)] } })
    vi.spyOn(assignmentsApi, 'setRouteExcluded').mockRejectedValue(new Error('no'))
    const p = useTripStore.getState().setRouteExcluded(5, 1, 1, true)
    expect(useTripStore.getState().assignments['1'][0].route_excluded).toBe(true)
    await expect(p).rejects.toThrow()
    expect(useTripStore.getState().assignments['1'][0].route_excluded).toBe(false)
  })

  it('FE-PLAN5-004: the route pill shows walking and driving, or the time by bike for a cycling day', () => {
    const seg = { walkingText: '20 min', drivingText: '5 min', cyclingText: '7 min' }
    expect(routeLabelInner(seg, 'default')).toContain('20 min')
    expect(routeLabelInner(seg, 'default')).toContain('5 min')
    const bike = routeLabelInner(seg, 'cycling')
    expect(bike).toContain('7 min')
    expect(bike).not.toContain('20 min')
  })

  it('FE-PLAN5-005: the preferred map app opens the place where it is', () => {
    const place = { lat: 41.1, lng: -4.7, name: 'Castillo' }
    expect(navUrl('waze', place)).toBe('https://waze.com/ul?ll=41.1,-4.7&navigate=yes')
    expect(navUrl('google', place)).toContain('query=41.1,-4.7')
    expect(navUrl('apple', place)).toContain('maps.apple.com')
    expect(navUrl('osm', { lat: null, lng: null })).toBeNull()
    expect(navAppName('comaps')).toBe('CoMaps')
    expect(navAppName('')).toBeNull()
  })

})

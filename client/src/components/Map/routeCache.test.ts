import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { routeDayLine, clearRouteCache } from './RouteCalculator'

const A = { lat: 41.06, lng: -4.72 }, B = { lat: 41.1, lng: -4.6 }, C = { lat: 41.2, lng: -4.5 }

function osrm(line: [number, number][]) {
  return { ok: true, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: line.map(([lat, lng]) => [lng, lat]) } }] }) }
}

describe('routeDayLine', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { clearRouteCache(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('routes leg by leg and joins them without repeating the shared stop', async () => {
    fetchMock
      .mockResolvedValueOnce(osrm([[41.06, -4.72], [41.08, -4.66], [41.1, -4.6]]))
      .mockResolvedValueOnce(osrm([[41.1, -4.6], [41.15, -4.55], [41.2, -4.5]]))
    const line = await routeDayLine([A, B, C], 'bike')
    expect(line).toEqual([[41.06, -4.72], [41.08, -4.66], [41.1, -4.6], [41.15, -4.55], [41.2, -4.5]])
    expect(fetchMock.mock.calls[0][0]).toContain('/routed-bike/')
  })

  it('takes known legs from the device and only routes the new one', async () => {
    fetchMock.mockResolvedValueOnce(osrm([[41.06, -4.72], [41.08, -4.66], [41.1, -4.6]]))
    await routeDayLine([A, B], 'foot')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('trek-route-cache-v1')).toContain('foot:')

    fetchMock.mockResolvedValueOnce(osrm([[41.1, -4.6], [41.2, -4.5]]))
    const line = await routeDayLine([A, B, C], 'foot')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(line?.[1]).toEqual([41.08, -4.66])
  })

  it('keeps a leg straight when nobody can route it, and is null when none could', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    expect(await routeDayLine([A, B], 'foot')).toBeNull()
    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(osrm([[41.06, -4.72], [41.08, -4.66], [41.1, -4.6]]))
      .mockResolvedValue({ ok: false, json: async () => ({}) })
    clearRouteCache()
    const line = await routeDayLine([A, B, C], 'foot')
    expect(line?.slice(-2)).toEqual([[41.1, -4.6], [41.2, -4.5]])
  })
})

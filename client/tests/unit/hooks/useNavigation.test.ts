import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { NativeGeoPosition } from '../../../src/services/nativeGeoService'

// The native GPS of the Android app, driven by the test.
const gps = vi.hoisted(() => ({
  cb: null as ((p: NativeGeoPosition) => void) | null,
  message: '' as string | undefined,
}))
vi.mock('../../../src/services/nativeGeoService', () => ({
  nativeGeoService: {
    isNative: () => true,
    start: vi.fn(async (cb: (p: NativeGeoPosition) => void, _err: unknown, opts?: { message?: string }) => {
      gps.cb = cb
      gps.message = opts?.message
    }),
    stop: vi.fn(async () => { gps.cb = null }),
  },
}))

const spoken = vi.hoisted(() => [] as string[])
vi.mock('../../../src/services/navVoice', async (orig) => {
  const real = await orig<typeof import('../../../src/services/navVoice')>()
  return {
    ...real,
    navVoice: {
      isMuted: () => false,
      setMuted: vi.fn(),
      speak: (t: string) => { spoken.push(t) },
      stop: vi.fn(),
    },
  }
})

import { useNavigation } from '../../../src/hooks/useNavigation'
import { loadNavDraft, clearNavDraft } from '../../../src/services/navDraftStore'

const LAT_PER_M = 1 / 111_195
let now = 1_700_000_000_000

function fix(lat: number, lng: number, speed = 4) {
  act(() => { gps.cb?.({ lat, lng, altitude: 600, speed, accuracy: 5, timestamp: now }) })
}

beforeEach(async () => {
  spoken.length = 0
  gps.cb = null
  now = 1_700_000_000_000
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(now)
  await clearNavDraft()
})
afterEach(() => { vi.useRealTimers() })

function advance(ms: number) {
  now += ms
  act(() => { vi.advanceTimersByTime(ms) })
}

describe('useNavigation — recording', () => {
  it('announces each km, pauses by itself when stopped and resumes when moving', async () => {
    const { result } = renderHook(() => useNavigation({ trackName: 'Salida', tripId: 7, path: '/navigate?tripId=7' }))
    act(() => { result.current.startRecording() })
    expect(spoken).toContain('Grabación iniciada.')
    expect(gps.cb).not.toBeNull()

    // 1.2 km northwards, a fix every 20 m every 5 s
    let lat = 40
    for (let i = 0; i < 60; i++) {
      advance(5000)
      lat += 20 * LAT_PER_M
      fix(lat, -3.7)
    }
    expect(result.current.recordedPoints.length).toBeGreaterThan(50)
    expect(spoken.some(s => s.startsWith('1 kilómetro. Media de'))).toBe(true)

    // Stopped: no fixes for over two minutes → automatic pause
    advance(125_000)
    expect(result.current.isPaused).toBe(true)
    expect(result.current.autoPaused).toBe(true)
    expect(spoken.some(s => s.includes('pausa automática'))).toBe(true)
    const pausedCount = result.current.recordedPoints.length

    // Moving again: resumes by itself and the next point opens a new segment
    advance(5000)
    lat += 30 * LAT_PER_M
    fix(lat, -3.7)
    expect(result.current.isPaused).toBe(false)
    expect(spoken).toContain('Grabación reanudada.')
    expect(result.current.recordedPoints.length).toBe(pausedCount + 1)
    expect(result.current.recordedPoints[pausedCount].newSegment).toBe(true)

    // Moving time leaves the stop out: 300 s riding + 5 s, not the 125 s standing
    advance(1000)
    expect(result.current.stats.elapsedSeconds).toBeGreaterThan(290)
    expect(result.current.stats.elapsedSeconds).toBeLessThan(320)

    // The recording is on the phone, for a crash
    await act(async () => { vi.useRealTimers() })
    const d = await loadNavDraft()
    expect(d).not.toBeNull()
    expect(d!.points.length).toBeGreaterThan(50)
    expect(d!.tripId).toBe(7)
  })

  it('stopRecording keeps the draft until it is saved or discarded', async () => {
    const { result } = renderHook(() => useNavigation({ trackName: 'Salida', tripId: null, path: '/navigate' }))
    act(() => { result.current.startRecording() })
    let lat = 40
    for (let i = 0; i < 5; i++) { advance(5000); lat += 20 * LAT_PER_M; fix(lat, -3.7) }
    act(() => { result.current.stopRecording() })
    expect(spoken.some(s => s.startsWith('Grabación detenida.'))).toBe(true)
    await act(async () => { vi.useRealTimers() })
    expect(await loadNavDraft()).not.toBeNull()
    act(() => { result.current.discardDraft() })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(await loadNavDraft()).toBeNull()
  })
})

describe('useNavigation — following a route on the app', () => {
  // A route north 600 m, then east 1.2 km (a right turn at the corner).
  const route = [
    ...Array.from({ length: 31 }, (_, i) => ({ lat: 40 + i * 20 * LAT_PER_M, lng: -3.7, ele: 600 })),
    ...Array.from({ length: 60 }, (_, i) => ({ lat: 40 + 600 * LAT_PER_M, lng: -3.7 + (i + 1) * 20 / 85_000, ele: 600 })),
  ]

  it('guides with the native GPS, announces the turn, going off route and coming back', () => {
    const { result } = renderHook(() => useNavigation({ trackName: 'Ruta', tripId: 1, path: '/navigate' }))
    act(() => { result.current.loadTrackAndFollow(route) })
    expect(gps.cb).not.toBeNull()
    expect(gps.message).toContain('guiando')
    expect(spoken[0]).toMatch(/^Navegación iniciada\. Ruta de 1,8 kilómetros\.$/)

    for (let i = 0; i <= 28; i++) { advance(4000); fix(route[i].lat, route[i].lng) }
    expect(spoken.some(s => /^En \d+ metros, gira a la derecha\.$/.test(s))).toBe(true)
    advance(4000); fix(route[30].lat, route[30].lng)
    expect(spoken).toContain('Gira a la derecha.')

    // 120 m off the route, twice
    const off = { lat: route[33].lat + 120 * LAT_PER_M, lng: route[33].lng }
    advance(4000); fix(off.lat, off.lng)
    advance(4000); fix(off.lat, off.lng)
    expect(result.current.isDeviated).toBe(true)
    expect(spoken.some(s => s.startsWith('Te has salido de la ruta.'))).toBe(true)
    advance(4000); fix(route[34].lat, route[34].lng)
    expect(spoken).toContain('De vuelta en la ruta.')

    for (let i = 35; i < route.length; i++) { advance(4000); fix(route[i].lat, route[i].lng) }
    expect(spoken).toContain('Quedan 500 metros para el final.')
    expect(spoken.some(s => s.startsWith('Has llegado al final de la ruta.'))).toBe(true)
    expect(spoken.some(s => s.startsWith('1 kilómetro recorrido. Quedan'))).toBe(true)
  })
})

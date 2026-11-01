/**
 * Tracking en vivo (5.7.1) — model rules, the Settings tab and the public viewer.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { Routes, Route } from 'react-router-dom'
import { server } from '../../../helpers/msw/server'
import { render, screen, fireEvent, waitFor } from '../../../helpers/render'
import TrackingTab from '../../../../src/components/Settings/TrackingTab'
import LiveLocationPage from '../../../../src/pages/LiveLocationPage'
import {
  formatDistance, formatDuration, isFresh, localDayRange, mainMotion, motionColor, motionSegments, overlandEndpoint, shareUrl,
  type TrackingDevice,
} from '../../../../src/components/Tracking/trackingModel'
import { resolveMobileNav } from '../../../../src/components/Layout/mobileNav'
import { bearing, headingOf } from '../../../../src/components/Tracking/LiveMap'

const device = (over: Partial<TrackingDevice> = {}): TrackingDevice => ({
  id: 1, name: 'Pixel', token_hint: 'Ab12', overland_device_id: 'android-pixel', created_at: '2026-10-29T10:00:00Z',
  last_seen_at: new Date().toISOString(),
  last_position: { lat: 43.36, lng: -5.84, accuracy: 5, speed: 5, altitude: 30, motion: 'cycling', recorded_at: new Date(Date.now() - 2 * 60000).toISOString() },
  battery_level: 0.81, battery_state: 'unplugged', status: 'tracking', status_at: null, retention_days: null, share: null,
  ...over,
})

describe('trackingModel', () => {
  it('endpoint and share URLs from the origin', () => {
    expect(overlandEndpoint('https://www.trekwanderer.info:446/')).toBe('https://www.trekwanderer.info:446/api/tracking/overland')
    expect(shareUrl('https://x.org', 'abc')).toBe('https://x.org/live/abc')
  })

  it('main motion skips "stationary" when something else is there', () => {
    expect(mainMotion('driving,stationary')).toBe('driving')
    expect(mainMotion('stationary')).toBe('stationary')
    expect(mainMotion(null)).toBeNull()
    expect(motionColor('cycling')).toBe('#16a34a')
  })

  it('segments split by motion and join without gaps', () => {
    const segs = motionSegments([
      { ts: '1', lat: 0, lng: 0, motion: 'walking' },
      { ts: '2', lat: 0, lng: 1, motion: 'walking' },
      { ts: '3', lat: 0, lng: 2, motion: 'driving' },
      { ts: '4', lat: 0, lng: 3, motion: 'driving,stationary' },
    ])
    expect(segs.map(s => s.motion)).toEqual(['walking', 'driving'])
    expect(segs[1].positions[0]).toEqual([0, 1])
    expect(segs[1].positions).toHaveLength(3)
  })

  it('freshness, local day range and formatting', () => {
    expect(isFresh(device())).toBe(true)
    expect(isFresh(device({ last_position: { ...device().last_position!, recorded_at: '2020-01-01T00:00:00Z' } }))).toBe(false)
    const r = localDayRange('2026-10-29')
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(24 * 3600 * 1000 - 1)
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(12345)).toBe('12.3 km')
    expect(formatDuration(3900)).toBe('1 h 05 min')
  })

  it('the phone bar can show Tracking', () => {
    expect(resolveMobileNav(['tracking', 'trips'], []).map(i => i.id)).toEqual(['tracking', 'trips'])
  })
})

describe('Settings → Tracking en vivo', () => {
  beforeEach(() => {
    let devices: TrackingDevice[] = []
    server.use(
      http.get('/api/tracking/devices', () => HttpResponse.json({ devices })),
      http.post('/api/tracking/devices', async ({ request }) => {
        const { name } = await request.json() as { name: string }
        const d = device({ id: 7, name, last_position: null, battery_level: null, status: null, token_hint: 'wXyZ' })
        devices = [d]
        return HttpResponse.json({ device: d, token: 'trk_secretTokenwXyZ' }, { status: 201 })
      }),
    )
  })

  it('shows the endpoint, adds a phone and shows its token once', async () => {
    render(<TrackingTab />)
    expect((screen.getByTestId('overland-endpoint') as HTMLInputElement).value).toBe(`${window.location.origin}/api/tracking/overland`)
    fireEvent.change(screen.getByLabelText('Phone name (e.g. My Pixel)'), { target: { value: 'Pixel de Juanma' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByTestId('device-token')).toBeInTheDocument())
    expect((screen.getByTestId('device-token') as HTMLInputElement).value).toBe('trk_secretTokenwXyZ')
    expect(screen.getByText('Waiting for the first point')).toBeInTheDocument()
  })
})

describe('Public live page', () => {
  it('shows the label, status and battery of a shared phone', async () => {
    server.use(http.get('/api/tracking/public/tok', () => HttpResponse.json({
      label: 'Juanma en ruta', expires_at: null, status: 'quiet', status_at: null, battery_level: 0.42,
      last_position: device().last_position, track: [{ lat: 43.3, lng: -5.8, ts: '2026-10-29T10:00:00Z', motion: 'cycling' }, { lat: 43.36, lng: -5.84, ts: '2026-10-29T10:05:00Z', motion: 'cycling' }],
      stats: { distance_m: 7400, start: null, end: null, duration_s: 300, motion: 'cycling' },
    })))
    render(<Routes><Route path="/live/:token" element={<LiveLocationPage />} /></Routes>, { initialEntries: ['/live/tok'] })
    await waitFor(() => expect(screen.getByText('Juanma en ruta')).toBeInTheDocument())
    expect(screen.getByText('In a quiet zone')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByTestId('live-header').textContent).toContain('7.4 km')
  })

  it('an expired link says so', async () => {
    server.use(http.get('/api/tracking/public/old', () => HttpResponse.json({ error: 'x' }, { status: 404 })))
    render(<Routes><Route path="/live/:token" element={<LiveLocationPage />} /></Routes>, { initialEntries: ['/live/old'] })
    await waitFor(() => expect(screen.getByText('This link is no longer active')).toBeInTheDocument())
  })

  const share = {
    label: 'Juanma', expires_at: null, status: 'tracking', status_at: null, battery_level: 0.5,
    last_position: device().last_position, track: [], stats: { distance_m: 0, start: null, end: null, duration_s: 0, motion: null },
  }

  it('a network error keeps the map and retries instead of calling the link gone', async () => {
    let calls = 0
    server.use(http.get('/api/tracking/public/blip', () => {
      calls++
      return calls === 1 ? HttpResponse.json(share) : HttpResponse.error()
    }))
    render(<Routes><Route path="/live/:token" element={<LiveLocationPage />} /></Routes>, { initialEntries: ['/live/blip'] })
    await waitFor(() => expect(screen.getByText('Juanma')).toBeInTheDocument())
    // The network back (or an installed PWA brought to the front): asks again at once.
    await new Promise(r => setTimeout(r, 1600))
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.getByTestId('live-badge').textContent).toContain('No connection'))
    expect(calls).toBe(2)
    expect(screen.queryByText('This link is no longer active')).not.toBeInTheDocument()
    expect(screen.getByText('Juanma')).toBeInTheDocument()
  })

  it('refreshes by itself when the page is shown again', async () => {
    let calls = 0
    server.use(http.get('/api/tracking/public/vis', () => { calls++; return HttpResponse.json(share) }))
    render(<Routes><Route path="/live/:token" element={<LiveLocationPage />} /></Routes>, { initialEntries: ['/live/vis'] })
    await waitFor(() => expect(screen.getByText('Juanma')).toBeInTheDocument())
    expect(calls).toBe(1)
    await new Promise(r => setTimeout(r, 1600))
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByTestId('live-recenter')).toBeInTheDocument()
  })
})

describe('live marker heading', () => {
  it('points where the phone went, and not while it is still', () => {
    expect(Math.round(bearing([0, 0], [1, 0]))).toBe(0)
    expect(Math.round(bearing([0, 0], [0, 1]))).toBe(90)
    const track = [{ ts: '1', lat: 43.0, lng: -5.0, motion: 'walking' }]
    expect(Math.round(headingOf(track, [43.0, -4.99], 1.4)!)).toBe(90)
    expect(headingOf(track, [43.0, -4.99], 0.1)).toBeNull()
    expect(headingOf(track, [43.00001, -5.0], 1.4)).toBeNull()
  })
})

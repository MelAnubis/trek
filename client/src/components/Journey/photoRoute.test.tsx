import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '../../../tests/helpers/render'
import { placePhotosOnRoute, photosPlacedByTime, uniquePhotos } from './photoRoute'
import { DayRouteCard } from './GpxRouteCards'
import { buildElevationSvg, type PdfGpxTrack } from '../PDF/gpxDrawing'

// A straight line north, ~1.11 km per 0.01°, from 1000 m up to 1100 m, one point a minute.
function track(over: Partial<PdfGpxTrack> = {}): PdfGpxTrack {
  const points = Array.from({ length: 11 }, (_, i) => ({
    lat: 40 + i * 0.01, lng: -4, ele: 1000 + i * 10,
    time: new Date(Date.UTC(2026, 4, 1, 9, i)).toISOString(),
  }))
  return { id: 1, track_name: 'Día 1', total_distance: 11.1, total_elevation_gain: 100, total_elevation_loss: 0, max_elevation: 1100, min_elevation: 1000, points, ...over }
}

const photo = (id: number, extra: Record<string, unknown>) => ({ id, photo_id: 100 + id, ...extra })

describe('placePhotosOnRoute', () => {
  it('places a GPS photo at the nearest point of the track', () => {
    const [p] = placePhotosOnRoute([track()], [photo(1, { lat: 40.05, lng: -4.0005, taken_at: '2026-05-01T09:05:00Z' })], '2026-05-01')
    expect(p.by).toBe('gps')
    expect(p.d).toBeCloseTo(5.56, 1)
    expect(p.e).toBe(1050)
  })

  it('leaves out a GPS photo far from the track', () => {
    expect(placePhotosOnRoute([track()], [photo(1, { lat: 41, lng: -4 })])).toEqual([])
  })

  it('places a photo without GPS by its time, interpolating between points', () => {
    const [p] = placePhotosOnRoute([track()], [photo(1, { taken_at: '2026-05-01T09:02:30Z' })], '2026-05-01')
    expect(p.by).toBe('time')
    expect(p.e).toBeCloseTo(1025, 5)
    expect(p.lat).toBeCloseTo(40.025, 5)
  })

  it('keeps photos a little before the start, drops those long after the end', () => {
    const res = placePhotosOnRoute([track()], [
      photo(1, { taken_at: '2026-05-01T08:50:00Z' }),
      photo(2, { taken_at: '2026-05-01T12:00:00Z' }),
    ])
    expect(res.map(r => r.photo.id)).toEqual([1])
    expect(res[0].d).toBe(0)
  })

  it('skips photos taken another day and sorts by km, counting a photo once', () => {
    const res = placePhotosOnRoute([track()], [
      photo(1, { lat: 40.08, lng: -4, taken_at: '2026-05-01T09:08:00Z' }),
      photo(2, { lat: 40.02, lng: -4, taken_at: '2026-05-01T09:02:00Z' }),
      photo(3, { lat: 40.04, lng: -4, taken_at: '2026-05-03T09:04:00Z' }),
      { id: 9, photo_id: 102, lat: 40.02, lng: -4 },
    ], '2026-05-01')
    expect(res.map(r => r.photo.id)).toEqual([2, 1])
  })

  it('photosPlacedByTime ignores planned tours and photos with GPS', () => {
    const photos = [photo(1, { taken_at: '2026-05-01T09:03:00Z' }), photo(2, { lat: 40.02, lng: -4, taken_at: '2026-05-01T09:02:00Z' })]
    expect(photosPlacedByTime([track({ planned: true })], photos)).toEqual([])
    const res = photosPlacedByTime([track()], photos)
    expect(res.map(r => r.photo.id)).toEqual([1])
    expect(res[0].lat).toBeCloseTo(40.03, 5)
  })

  it('uniquePhotos keeps the first of each picture', () => {
    expect(uniquePhotos([{ id: 1, photo_id: 5 }, { id: 2, photo_id: 5 }, { id: 3, photo_id: 6 }]).map(p => p.id)).toEqual([1, 3])
  })
})

describe('DayRouteCard with photos', () => {
  it('puts the photos on the profile and in a strip, and opens the one clicked', () => {
    const tr = [track()]
    expect(buildElevationSvg(tr)).toContain('<svg')
    const photos = placePhotosOnRoute(tr, [
      photo(1, { lat: 40.02, lng: -4 }),
      photo(2, { taken_at: '2026-05-01T09:07:00Z' }),
    ])
    const clicked: number[] = []
    render(<DayRouteCard tracks={tr} photos={photos} onPhotoClick={i => clicked.push(i)} />)
    expect(screen.getAllByTestId('route-photo-dot')).toHaveLength(2)
    const labels = screen.getAllByTestId('route-photo-label').map(l => l.textContent)
    expect(labels[0]).toMatch(/^km 2[.,]2 · 1[.,]?020 m$/)
    expect(labels[1]).toMatch(/^km 7[.,]8 · 1[.,]?070 m$/)
    fireEvent.click(screen.getAllByTestId('route-photo-dot')[1])
    expect(clicked).toEqual([1])
  })

  it('shows no photo strip when there are none', () => {
    render(<DayRouteCard tracks={[track()]} />)
    expect(screen.queryByTestId('route-photo-strip')).toBeNull()
  })
})

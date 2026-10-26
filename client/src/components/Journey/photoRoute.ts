// Fotos sobre la ruta: each journal photo is put at the point of the day's track where it
// was taken — by its own GPS when it has it, otherwise by its time against the track's
// times — so it can sit on the elevation profile ("km 12,4 · 1.340 m") and on the map.
import { parseRouteTime, routeSeries, type PdfGpxTrack, type RouteSeriesPoint } from '../PDF/gpxDrawing'

export interface RoutePhotoInput {
  id: number
  photo_id: number
  taken_at?: string | null
  lat?: number | null
  lng?: number | null
}

export interface PlacedPhoto<P extends RoutePhotoInput = RoutePhotoInput> {
  photo: P
  /** km from the start of the day's route. */
  d: number
  /** Elevation there (NaN when the track has none). */
  e: number
  lat: number
  lng: number
  by: 'gps' | 'time'
}

/** A GPS photo further than this from the track was not taken on it. */
export const MAX_GPS_KM = 0.3
/** A photo this long before the start or after the end still belongs to the route. */
export const TIME_SLACK_MS = 15 * 60 * 1000

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

function byGps<P extends RoutePhotoInput>(series: RouteSeriesPoint[], photo: P): PlacedPhoto<P> | null {
  if (photo.lat == null || photo.lng == null) return null
  const at = { lat: photo.lat, lng: photo.lng }
  let best = -1, bestKm = Infinity
  for (let i = 0; i < series.length; i++) {
    const k = distKm(at, series[i])
    if (k < bestKm) { bestKm = k; best = i }
  }
  if (best < 0 || bestKm > MAX_GPS_KM) return null
  const p = series[best]
  return { photo, d: p.d, e: p.e, lat: p.lat, lng: p.lng, by: 'gps' }
}

function byTime<P extends RoutePhotoInput>(series: RouteSeriesPoint[], photo: P): PlacedPhoto<P> | null {
  const t = parseRouteTime(photo.taken_at)
  if (t == null) return null
  const timed = series.filter(p => p.t != null)
  if (timed.length < 2) return null
  const first = timed[0], last = timed[timed.length - 1]
  if (t < first.t! - TIME_SLACK_MS || t > last.t! + TIME_SLACK_MS) return null
  if (t <= first.t!) return { photo, d: first.d, e: first.e, lat: first.lat, lng: first.lng, by: 'time' }
  if (t >= last.t!) return { photo, d: last.d, e: last.e, lat: last.lat, lng: last.lng, by: 'time' }
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i], b = timed[i + 1]
    if (t < a.t! || t > b.t!) continue
    const f = b.t! === a.t! ? 0 : (t - a.t!) / (b.t! - a.t!)
    const lerp = (x: number, y: number) => x + (y - x) * f
    return { photo, d: lerp(a.d, b.d), e: lerp(a.e, b.e), lat: lerp(a.lat, b.lat), lng: lerp(a.lng, b.lng), by: 'time' }
  }
  return null
}

/** Same picture added to several entries counts once. */
export function uniquePhotos<P extends RoutePhotoInput>(photos: P[]): P[] {
  const seen = new Set<number>()
  return photos.filter(p => (seen.has(p.photo_id) ? false : (seen.add(p.photo_id), true)))
}

/**
 * Places photos on a series (see routeSeries). GPS wins over time; a photo dated another
 * day than `date` is left out so a route walked twice doesn't collect the other day's photos.
 * Sorted by km.
 */
export function placePhotosOnSeries<P extends RoutePhotoInput>(series: RouteSeriesPoint[], photos: P[], date?: string | null): PlacedPhoto<P>[] {
  if (series.length < 2) return []
  const out: PlacedPhoto<P>[] = []
  for (const photo of uniquePhotos(photos)) {
    if (date && photo.taken_at && photo.taken_at.slice(0, 10) !== date) {
      const t = parseRouteTime(photo.taken_at)
      // a photo just past midnight in UTC terms may still be that local day
      const local = t != null ? new Date(t) : null
      const localDate = local ? `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}` : null
      if (localDate !== date) continue
    }
    const placed = byGps(series, photo) ?? byTime(series, photo)
    if (placed) out.push(placed)
  }
  return out.sort((a, b) => a.d - b.d)
}

/** Places photos on a day's tracks, on the same series the elevation profile is drawn from. */
export function placePhotosOnRoute<P extends RoutePhotoInput>(tracks: PdfGpxTrack[], photos: P[], date?: string | null): PlacedPhoto<P>[] {
  const withEle = routeSeries(tracks)
  return placePhotosOnSeries(withEle.length >= 2 ? withEle : routeSeries(tracks, false), photos, date)
}

/**
 * Photos without their own GPS that the recorded tracks place by time — so they get a pin on
 * the journey map too. Planned tours carry no times, so only real tracks are used.
 */
export function photosPlacedByTime<P extends RoutePhotoInput>(tracks: PdfGpxTrack[], photos: P[]): PlacedPhoto<P>[] {
  const out: PlacedPhoto<P>[] = []
  const left = uniquePhotos(photos).filter(p => (p.lat == null || p.lng == null) && p.taken_at)
  if (!left.length) return out
  const placedIds = new Set<number>()
  for (const track of tracks) {
    if (track.planned) continue
    const series = routeSeries([track], false)
    for (const p of placePhotosOnSeries(series, left.filter(ph => !placedIds.has(ph.photo_id)))) {
      placedIds.add(p.photo.photo_id)
      out.push(p)
    }
  }
  return out
}

export function formatKm(d: number, locale?: string): string {
  return d.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

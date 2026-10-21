import { saveTextFile } from './saveFile'

/** The server's own filename (Content-Disposition), else one made from the title the same way. */
export function gpxFilenameFrom(disposition: string | null, title: string): string {
  const m = disposition?.match(/filename="([^"]+)"/)
  if (m) return m[1]
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return `${base || 'trip'}.gpx`
}

/**
 * The whole trip as one GPX — places, each day's route, every track — for a
 * Garmin, OsmAnd, Komoot or Organic Maps. Fetched with the session cookie
 * and saved through saveTextFile, which on the Android app hands it to the
 * share sheet (a plain <a href> download does nothing in that WebView).
 */
export async function exportTripGpx(tripId: number | string, title: string): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/gpx/export`, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  await saveTextFile(gpxFilenameFrom(res.headers.get('content-disposition'), title), text, 'application/gpx+xml')
}

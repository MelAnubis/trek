// Fetches GPX tracks for a journey's linked trips — the same data
// JourneyBookPDF.tsx's route/elevation pages are built from, now also used
// live by the timeline's per-day route cards and route summary header.
import type { PdfGpxTrack } from '../PDF/gpxDrawing'

export async function fetchJourneyGpxTracks(trips: { trip_id: number }[]): Promise<PdfGpxTrack[]> {
  const tracks: PdfGpxTrack[] = []

  for (const trip of trips) {
    const dayDateById = new Map<number, string>()
    const dayNumberById = new Map<number, number>()
    try {
      // The days endpoint returns { days: [...] }, not a bare array (see
      // dayService.listDays / GpxManager.tsx's own fetch of the same
      // endpoint) — unwrapped, `days` below is the wrapper object, which
      // for...of throws on, silently caught by this try/catch and leaving
      // every track's date/day_number unset (so no track could ever match
      // a day, however plainly it was linked to one).
      const res: any = await fetch(
        `/api/trips/${trip.trip_id}/days`,
        { credentials: 'include' },
      ).then(r => r.ok ? r.json() : { days: [] })
      const days: any[] = res.days || res
      for (const d of days) {
        if (d.date) dayDateById.set(d.id, d.date)
        if (d.day_number != null) dayNumberById.set(d.id, d.day_number)
      }
    } catch { /* ignore per-trip errors */ }

    try {
      const list: any[] = await fetch(
        `/api/trips/${trip.trip_id}/gpx`,
        { credentials: 'include' },
      ).then(r => r.ok ? r.json() : [])
      const active = list.filter((t: any) => t.is_active)
      for (const track of active) {
        const full = await fetch(
          `/api/trips/${trip.trip_id}/gpx/${track.id}/points`,
          { credentials: 'include' },
        ).then(r => r.ok ? r.json() : null)
        if (full) tracks.push({
          ...track,
          points: full.points || [],
          waypoints: full.waypoints || [],
          date: track.day_id != null ? (dayDateById.get(track.day_id) || null) : null,
          // Trips can be planned without fixed calendar dates — when a
          // linked day has no date, its day_number still lets a caller pair
          // it up with the journal's Nth day by position.
          day_number: track.day_id != null ? (dayNumberById.get(track.day_id) ?? null) : null,
        })
      }
    } catch { /* ignore per-trip errors */ }
  }

  return tracks
}

export interface TrailSegment {
  points: { lat: number; lng: number }[]
  /** Undefined -> JourneyMap's own default trail color. Set when the track's GPX <type> matched a known transport mode. */
  color?: string
}

/** Mirrors the server's TRANSPORT_MODES (detectTransportMode) — kept as a plain lookup here rather than importing a server module into the client bundle. */
const TRANSPORT_MODE_COLORS: Record<string, string> = {
  hiking: '#16a34a',
  cycling: '#2563eb',
  driving: '#f97316',
  walking: '#a855f7',
  running: '#dc2626',
}

/**
 * The real path walked, as colored segments for JourneyMap's `trail` prop
 * — same tracks the route/elevation cards and PDF export already draw,
 * now also drawn live as an actual polyline instead of the map's straight
 * pin-to-pin fallback line, colored by how each stretch was traveled when
 * the GPX file says so. Order matters here (it's a line, not a bag of
 * points): tracks arrive from fetchJourneyGpxTracks already ordered by
 * trip start_date then by each trip's own sort_order, which is
 * chronological enough that walking through them in place needs no extra
 * sort. Consecutive tracks with the same mode (most journeys — either one
 * mode throughout, or none detected at all) merge into one segment rather
 * than one per track, so the line doesn't visibly break where two same-mode
 * stages just happen to join.
 */
export function buildTrailSegments(tracks: PdfGpxTrack[]): TrailSegment[] {
  const segments: TrailSegment[] = []
  let current: TrailSegment | null = null
  for (const track of tracks) {
    const color = track.transport_mode ? TRANSPORT_MODE_COLORS[track.transport_mode] : undefined
    if (!current || current.color !== color) {
      current = { points: [], color }
      segments.push(current)
    }
    for (const p of track.points) current.points.push({ lat: p.lat, lng: p.lng })
  }
  return segments.filter(s => s.points.length > 0)
}

export interface WaypointItem {
  id: string
  lat: number
  lng: number
  name: string
}

/** Named <wpt> points the GPX file(s) themselves carry — see JourneyMap's `waypointMarkers` prop. */
export function flattenWaypoints(tracks: PdfGpxTrack[]): WaypointItem[] {
  const items: WaypointItem[] = []
  tracks.forEach(track => {
    (track.waypoints || []).forEach((wp, i) => {
      items.push({ id: `${track.id}-${i}`, lat: wp.lat, lng: wp.lng, name: wp.name })
    })
  })
  return items
}

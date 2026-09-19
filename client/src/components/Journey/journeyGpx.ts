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

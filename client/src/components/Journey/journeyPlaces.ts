// Collects a journey's own places — from its linked trips' real place data,
// not every place in the app — for Studio's `places` travel element. Same
// per-trip fetch pattern as journeyGpx.ts's fetchJourneyGpxTracks.

export interface JourneyPlace {
  name: string
  note?: string
}

export async function fetchJourneyPlaces(trips: { trip_id: number }[]): Promise<JourneyPlace[]> {
  const places: JourneyPlace[] = []

  for (const trip of trips) {
    try {
      const res: any = await fetch(
        `/api/trips/${trip.trip_id}/places`,
        { credentials: 'include' },
      ).then(r => r.ok ? r.json() : { places: [] })
      const list: any[] = res.places || []
      for (const p of list) {
        const name = (p?.name || '').toString().trim()
        if (!name) continue
        const note = (p.notes || p.description || '').toString().trim()
        places.push({ name, note: note || undefined })
      }
    } catch { /* ignore per-trip errors */ }
  }

  return places
}

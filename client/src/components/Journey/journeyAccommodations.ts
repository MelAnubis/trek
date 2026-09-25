// Collects a journey's own stays — from its linked trips' real
// day_accommodations rows (joined to their place — see
// dayService.listAccommodations), not a fresh empty list — for Studio's
// `accommodation` travel element. Same per-trip fetch pattern as
// journeyPlaces.ts.

import { accommodationsApi } from '../../api/client'

export interface JourneyAccommodationItem {
  name: string
  address?: string
  checkIn?: string | null
  checkOut?: string | null
  confirmation?: string
}

export async function fetchJourneyAccommodations(trips: { trip_id: number }[]): Promise<JourneyAccommodationItem[]> {
  const stays: JourneyAccommodationItem[] = []

  for (const trip of trips) {
    try {
      const res: any = await accommodationsApi.list(trip.trip_id)
      const list: any[] = res.accommodations || []
      for (const a of list) {
        const name = (a?.place_name || a?.reservation_title || '').toString().trim()
        if (!name) continue
        stays.push({
          name,
          address: (a.place_address || '').toString().trim() || undefined,
          checkIn: a.check_in || null,
          checkOut: a.check_out || null,
          confirmation: (a.confirmation || '').toString().trim() || undefined,
        })
      }
    } catch { /* ignore per-trip errors */ }
  }

  return stays
}

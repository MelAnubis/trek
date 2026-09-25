// Collects a journey's own packing list — from its linked trips' real
// packing_items rows, not a fresh empty list — for Studio's `packing` travel
// element. Same per-trip fetch pattern as journeyPlaces.ts.

import { packingApi } from '../../api/client'

export interface JourneyPackingItem {
  name: string
  category?: string
  checked?: boolean
  quantity?: number
}

export async function fetchJourneyPacking(trips: { trip_id: number }[]): Promise<JourneyPackingItem[]> {
  const items: JourneyPackingItem[] = []

  for (const trip of trips) {
    try {
      const res: any = await packingApi.list(trip.trip_id)
      const list: any[] = res.items || []
      for (const it of list) {
        const name = (it?.name || '').toString().trim()
        if (!name) continue
        items.push({
          name,
          category: (it.category || '').toString().trim() || undefined,
          checked: !!it.checked,
          quantity: Number(it.quantity) || 1,
        })
      }
    } catch { /* ignore per-trip errors */ }
  }

  return items
}

import { journeyApi } from '../api/client'
import { offlineDb } from '../db/offlineDb'
import { mutationQueue, generateUUID } from '../sync/mutationQueue'
import type { JourneyEntry } from '../store/journeyStore'

/**
 * Journal entry CRUD, offline-queued the same way placeRepo.ts queues
 * places — the established pattern for this app's write-offline resources
 * (see mutationQueue.ts). The one structural difference: a journey entry's
 * update/delete URL is keyed by entryId alone (`/journeys/entries/:id`,
 * not `/journeys/:journeyId/entries/:id`), so journeyId here is only ever
 * the mutation's *scope* key (for pendingForJourney/eviction), never part
 * of the request URL beyond create.
 */
export const journeyEntryRepo = {
  async create(journeyId: number, data: Record<string, unknown>): Promise<JourneyEntry> {
    if (!navigator.onLine) {
      const tempId = -(Date.now())
      const tempEntry: JourneyEntry = {
        ...(data as Partial<JourneyEntry>),
        id: tempId,
        journey_id: journeyId,
        type: 'entry',
        author_id: 0,
        entry_date: (data.entry_date as string) ?? new Date().toISOString().split('T')[0],
        visibility: 'private',
        sort_order: 0,
        photos: [],
        created_at: Date.now(),
        updated_at: Date.now(),
      } as JourneyEntry
      await offlineDb.journeyEntries.put(tempEntry)
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'POST',
        url: `/journeys/${journeyId}/entries`,
        body: data,
        resource: 'journeyEntries',
        tempId,
      })
      return tempEntry
    }
    const entry = await journeyApi.createEntry(journeyId, data)
    entry.photos = entry.photos || []
    offlineDb.journeyEntries.put(entry)
    return entry
  },

  async update(journeyId: number, entryId: number, data: Record<string, unknown>): Promise<JourneyEntry> {
    if (!navigator.onLine) {
      const existing = await offlineDb.journeyEntries.get(entryId)
      const optimistic: JourneyEntry = { ...(existing ?? {} as JourneyEntry), ...(data as Partial<JourneyEntry>), id: entryId }
      await offlineDb.journeyEntries.put(optimistic)
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'PATCH',
        url: `/journeys/entries/${entryId}`,
        body: data,
        resource: 'journeyEntries',
      })
      return optimistic
    }
    const entry = await journeyApi.updateEntry(entryId, data)
    offlineDb.journeyEntries.put(entry)
    return entry
  },

  async delete(journeyId: number, entryId: number): Promise<void> {
    if (!navigator.onLine) {
      await offlineDb.journeyEntries.delete(entryId)
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'DELETE',
        url: `/journeys/entries/${entryId}`,
        body: undefined,
        resource: 'journeyEntries',
        entityId: entryId,
      })
      return
    }
    await journeyApi.deleteEntry(entryId)
    offlineDb.journeyEntries.delete(entryId)
  },
}

import { journeyApi } from '../api/client'
import { mutationQueue, generateUUID } from '../sync/mutationQueue'

/**
 * The JSON-only photo operations — linking an already-uploaded gallery
 * photo to an entry (called inline from JourneyDetailPage.tsx's
 * EntryEditor, not through the store), unlinking it, and deleting it
 * (through journeyStore) — offline-queued the same way journeyEntryRepo.ts
 * queues entries. (updatePhoto/PATCH exists on journeyApi too, but nothing
 * calls it today except an inline sort-order PATCH in JourneyDetailPage.tsx
 * that isn't in scope here.)
 *
 * Raw photo *upload* (uploadPhotos/uploadGalleryPhotos) is deliberately
 * NOT included here: it's a FormData/binary request, and this app's
 * mutationQueue is JSON-only end to end (`mutation.body` is replayed as
 * axios `data`) — no resource in this codebase, Trip Planner's own file
 * uploads included, persists a blob for offline replay. Making an upload
 * durable across a reload while offline would mean queueing the raw file
 * bytes in IndexedDB and reconstructing a multipart request from them on
 * reconnect — a real feature with no existing precedent to build on, not
 * a small addition to this queue. Uploads keep their current resilience
 * instead: uploadFilesResilient (utils/uploadQueue.ts) retries a failed
 * upload while the tab stays open, which is what they've always had.
 *
 * None of these operations write to a Dexie table of their own — there is
 * no offline read-cache for photos (a journey isn't readable offline at
 * all yet; only writes made during an already-loaded session are queued
 * here) — so `resource` is left unset and the caller's own optimistic
 * store update is what the UI shows until the queued mutation replays.
 */
export const journeyPhotoRepo = {
  async linkPhoto(entryId: number, journeyId: number, journeyPhotoId: number): Promise<unknown> {
    if (!navigator.onLine) {
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'POST',
        url: `/journeys/entries/${entryId}/link-photo`,
        body: { journey_photo_id: journeyPhotoId },
      })
      return null
    }
    return journeyApi.linkPhoto(entryId, journeyPhotoId)
  },

  async unlinkPhoto(entryId: number, journeyId: number, journeyPhotoId: number): Promise<void> {
    if (!navigator.onLine) {
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'DELETE',
        url: `/journeys/entries/${entryId}/photos/${journeyPhotoId}`,
        body: undefined,
      })
      return
    }
    await journeyApi.unlinkPhoto(entryId, journeyPhotoId)
  },

  async deleteGalleryPhoto(journeyId: number, journeyPhotoId: number): Promise<void> {
    if (!navigator.onLine) {
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'DELETE',
        url: `/journeys/${journeyId}/gallery/${journeyPhotoId}`,
        body: undefined,
      })
      return
    }
    await journeyApi.deleteGalleryPhoto(journeyId, journeyPhotoId)
  },

  async deletePhoto(journeyId: number, photoId: number): Promise<void> {
    if (!navigator.onLine) {
      await mutationQueue.enqueue({
        id: generateUUID(),
        journeyId,
        method: 'DELETE',
        url: `/journeys/photos/${photoId}`,
        body: undefined,
      })
      return
    }
    await journeyApi.deletePhoto(photoId)
  },
}

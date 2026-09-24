import Dexie, { type Table } from 'dexie';
import type { Trip, Day, Place, PackingItem, TodoItem, BudgetItem, Reservation, TripFile, Accommodation, TripMember, Tag, Category } from '../types';
import type { JourneyEntry } from '../store/journeyStore';
import type { BookDocument } from '../types/book';

/** TripMember enriched with tripId so we can index by trip. */
export interface CachedTripMember extends TripMember {
  tripId: number;
}

// ── Queue + sync types ────────────────────────────────────────────────────────

export type MutationStatus = 'pending' | 'syncing' | 'failed';

export interface QueuedMutation {
  /** UUID — also used as X-Idempotency-Key sent to the server */
  id: string;
  /** Trip-scoped mutations (places, packing, …). Exactly one of tripId/journeyId is set. */
  tripId?: number;
  /** Journey-scoped mutations (journal entries, photo links) — a journey has its own id
   *  namespace, separate from (and not necessarily linked 1:1 to) a trip. */
  journeyId?: number;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: unknown;
  createdAt: number;
  status: MutationStatus;
  attempts: number;
  lastError: string | null;
  /** Dexie table name to write the server response into after flush (e.g. 'places') */
  resource?: string;
  /** For CREATE mutations enqueued offline: the temporary negative id written to Dexie */
  tempId?: number;
  /** For DELETE mutations: the entity id to remove from Dexie on flush */
  entityId?: number;
}

export interface SyncMeta {
  tripId: number;
  lastSyncedAt: number | null;
  status: 'idle' | 'syncing' | 'error';
  /** Bounding box [minLng, minLat, maxLng, maxLat] of pre-downloaded map tiles */
  tilesBbox: [number, number, number, number] | null;
  filesCachedCount: number;
}

export interface BlobCacheEntry {
  /** Relative URL, e.g. "/api/files/42/download" */
  url: string;
  blob: Blob;
  mime: string;
  cachedAt: number;
}

/**
 * A Studio book edit that failed to reach the server because the client was
 * offline, kept so it survives a reload — one row per journey (a book is
 * edited by whoever has Studio open, not concurrently queued like a list
 * resource). Not part of the generic mutationQueue: a book save is a single
 * versioned PUT per journey with its own conflict-resolution flow
 * (useBookStore.ts's acceptTheirs/keepMine), not a FIFO-replayable list
 * mutation, so this is a narrower "don't lose local work" cache rather than
 * a queue entry.
 */
export interface PendingBookEdit {
  journeyId: number;
  document: BookDocument;
  title: string;
  /** The version this edit was made against, so a resume can still detect a conflict. */
  baseVersion: number | null;
  savedLocallyAt: number;
}

// ── Dexie class ────────────────────────────────────────────────────────────────

class TrekOfflineDb extends Dexie {
  trips!: Table<Trip, number>;
  days!: Table<Day, number>;
  places!: Table<Place, number>;
  packingItems!: Table<PackingItem, number>;
  todoItems!: Table<TodoItem, number>;
  budgetItems!: Table<BudgetItem, number>;
  reservations!: Table<Reservation, number>;
  tripFiles!: Table<TripFile, number>;
  accommodations!: Table<Accommodation, number>;
  tripMembers!: Table<CachedTripMember, [number, number]>;
  tags!: Table<Tag, number>;
  categories!: Table<Category, number>;
  mutationQueue!: Table<QueuedMutation, string>;
  syncMeta!: Table<SyncMeta, number>;
  blobCache!: Table<BlobCacheEntry, string>;
  journeyEntries!: Table<JourneyEntry, number>;
  journeyBookDrafts!: Table<PendingBookEdit, number>;

  constructor() {
    super('trek-offline');

    this.version(1).stores({
      trips:        'id',
      days:         'id, trip_id',
      places:       'id, trip_id',
      packingItems: 'id, trip_id',
      todoItems:    'id, trip_id',
      budgetItems:  'id, trip_id',
      reservations: 'id, trip_id',
      tripFiles:    'id, trip_id',
      mutationQueue:'id, tripId, status, createdAt',
      syncMeta:     'tripId',
      blobCache:    'url, cachedAt',
    });

    this.version(2).stores({
      accommodations: 'id, trip_id',
      tripMembers:    '[tripId+id], tripId',
      tags:           'id',
      categories:     'id',
    });

    this.version(3).stores({
      mutationQueue:     'id, tripId, journeyId, status, createdAt',
      journeyEntries:    'id, journey_id',
      journeyBookDrafts: 'journeyId',
    });
  }
}

export const offlineDb = new TrekOfflineDb();

// ── Bulk upsert helpers ────────────────────────────────────────────────────────

export async function upsertTrip(trip: Trip): Promise<void> {
  await offlineDb.trips.put(trip);
}

export async function upsertDays(days: Day[]): Promise<void> {
  await offlineDb.days.bulkPut(days);
}

export async function upsertPlaces(places: Place[]): Promise<void> {
  await offlineDb.places.bulkPut(places);
}

export async function upsertPackingItems(items: PackingItem[]): Promise<void> {
  await offlineDb.packingItems.bulkPut(items);
}

export async function upsertTodoItems(items: TodoItem[]): Promise<void> {
  await offlineDb.todoItems.bulkPut(items);
}

export async function upsertBudgetItems(items: BudgetItem[]): Promise<void> {
  await offlineDb.budgetItems.bulkPut(items);
}

export async function upsertReservations(items: Reservation[]): Promise<void> {
  await offlineDb.reservations.bulkPut(items);
}

export async function upsertTripFiles(files: TripFile[]): Promise<void> {
  await offlineDb.tripFiles.bulkPut(files);
}

export async function upsertAccommodations(items: Accommodation[]): Promise<void> {
  await offlineDb.accommodations.bulkPut(items);
}

export async function upsertTripMembers(tripId: number, members: TripMember[]): Promise<void> {
  const rows: CachedTripMember[] = members.map(m => ({ ...m, tripId }));
  await offlineDb.tripMembers.bulkPut(rows);
}

export async function upsertTags(tags: Tag[]): Promise<void> {
  await offlineDb.tags.bulkPut(tags);
}

export async function upsertCategories(categories: Category[]): Promise<void> {
  await offlineDb.categories.bulkPut(categories);
}

export async function upsertSyncMeta(meta: SyncMeta): Promise<void> {
  await offlineDb.syncMeta.put(meta);
}

export async function upsertJourneyEntries(entries: JourneyEntry[]): Promise<void> {
  await offlineDb.journeyEntries.bulkPut(entries);
}

/** Delete all cached entries for one journey (e.g. leaving the journey page, or logout). */
export async function clearJourneyData(journeyId: number): Promise<void> {
  await offlineDb.transaction('rw', [offlineDb.journeyEntries, offlineDb.mutationQueue, offlineDb.journeyBookDrafts], async () => {
    await offlineDb.journeyEntries.where('journey_id').equals(journeyId).delete();
    await offlineDb.mutationQueue.where('journeyId').equals(journeyId).delete();
    await offlineDb.journeyBookDrafts.delete(journeyId);
  });
}

// ── Eviction / cleanup ────────────────────────────────────────────────────────

/** Delete all cached data for one trip (eviction or explicit clear). */
export async function clearTripData(tripId: number): Promise<void> {
  await offlineDb.transaction(
    'rw',
    [
      offlineDb.days,
      offlineDb.places,
      offlineDb.packingItems,
      offlineDb.todoItems,
      offlineDb.budgetItems,
      offlineDb.reservations,
      offlineDb.tripFiles,
      offlineDb.accommodations,
      offlineDb.tripMembers,
      offlineDb.mutationQueue,
      offlineDb.syncMeta,
    ],
    async () => {
      await offlineDb.days.where('trip_id').equals(tripId).delete();
      await offlineDb.places.where('trip_id').equals(tripId).delete();
      await offlineDb.packingItems.where('trip_id').equals(tripId).delete();
      await offlineDb.todoItems.where('trip_id').equals(tripId).delete();
      await offlineDb.budgetItems.where('trip_id').equals(tripId).delete();
      await offlineDb.reservations.where('trip_id').equals(tripId).delete();
      await offlineDb.tripFiles.where('trip_id').equals(tripId).delete();
      await offlineDb.accommodations.where('trip_id').equals(tripId).delete();
      await offlineDb.tripMembers.where('tripId').equals(tripId).delete();
      await offlineDb.mutationQueue.where('tripId').equals(tripId).delete();
      await offlineDb.syncMeta.where('tripId').equals(tripId).delete();
    },
  );
  // Remove the trip row itself outside the transaction since it's a separate table
  await offlineDb.trips.delete(tripId);
}

/** Wipe the entire offline database (called on logout). */
export async function clearAll(): Promise<void> {
  await offlineDb.delete();
  // Re-open so subsequent operations don't fail
  await offlineDb.open();
}

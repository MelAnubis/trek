/**
 * journeyEntryRepo unit tests.
 *
 * Online path:  calls REST via MSW, writes result to Dexie.
 * Offline path: optimistic Dexie write + mutationQueue.enqueue, no REST call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { server } from '../../helpers/msw/server';
import { http, HttpResponse } from 'msw';
import { journeyEntryRepo } from '../../../src/repo/journeyEntryRepo';
import { offlineDb, clearAll } from '../../../src/db/offlineDb';
import { buildJourneyEntry } from '../../helpers/factories';

beforeEach(async () => {
  await clearAll();
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('journeyEntryRepo.create', () => {
  it('online — calls REST and caches the created entry in Dexie', async () => {
    const entry = buildJourneyEntry({ journey_id: 1, title: 'Arrived in Tokyo' });
    server.use(
      http.post('/api/journeys/1/entries', () => HttpResponse.json(entry)),
    );

    const result = await journeyEntryRepo.create(1, { title: 'Arrived in Tokyo', entry_date: '2026-01-15' });
    expect(result.title).toBe('Arrived in Tokyo');

    const cached = await offlineDb.journeyEntries.get(entry.id);
    expect(cached).toBeDefined();
    expect(cached!.title).toBe('Arrived in Tokyo');
  });

  it('offline — writes an optimistic temp entry to Dexie and enqueues a mutation, without calling REST', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    let restCalled = false;
    server.use(
      http.post('/api/journeys/1/entries', () => { restCalled = true; return HttpResponse.json({}); }),
    );

    const result = await journeyEntryRepo.create(1, { title: 'Arrived in Tokyo', entry_date: '2026-01-15' });

    expect(restCalled).toBe(false);
    expect(result.id).toBeLessThan(0);
    expect(result.title).toBe('Arrived in Tokyo');

    const cached = await offlineDb.journeyEntries.get(result.id);
    expect(cached).toBeDefined();

    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe('POST');
    expect(pending[0].url).toBe('/journeys/1/entries');
    expect(pending[0].journeyId).toBe(1);
    expect(pending[0].tempId).toBe(result.id);
    expect(pending[0].resource).toBe('journeyEntries');
  });
});

describe('journeyEntryRepo.update', () => {
  it('online — calls REST and updates Dexie cache', async () => {
    const original = buildJourneyEntry({ journey_id: 1, title: 'Old title' });
    await offlineDb.journeyEntries.put(original);
    const updated = { ...original, title: 'New title' };
    server.use(
      http.patch(`/api/journeys/entries/${original.id}`, () => HttpResponse.json(updated)),
    );

    const result = await journeyEntryRepo.update(1, original.id, { title: 'New title' });
    expect(result.title).toBe('New title');

    const cached = await offlineDb.journeyEntries.get(original.id);
    expect(cached!.title).toBe('New title');
  });

  it('offline — merges onto the existing Dexie row optimistically and enqueues a PATCH', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    const original = buildJourneyEntry({ journey_id: 1, title: 'Old title', mood: 'happy' });
    await offlineDb.journeyEntries.put(original);

    const result = await journeyEntryRepo.update(1, original.id, { title: 'New title' });

    expect(result.title).toBe('New title');
    expect(result.mood).toBe('happy'); // untouched field survives the merge

    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe('PATCH');
    expect(pending[0].url).toBe(`/journeys/entries/${original.id}`);
    expect(pending[0].journeyId).toBe(1);
  });
});

describe('journeyEntryRepo.delete', () => {
  it('online — calls REST and removes from Dexie', async () => {
    const entry = buildJourneyEntry({ journey_id: 1 });
    await offlineDb.journeyEntries.put(entry);
    server.use(
      http.delete(`/api/journeys/entries/${entry.id}`, () => HttpResponse.json({ success: true })),
    );

    await journeyEntryRepo.delete(1, entry.id);
    expect(await offlineDb.journeyEntries.get(entry.id)).toBeUndefined();
  });

  it('offline — removes from Dexie immediately and enqueues a DELETE, without calling REST', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    const entry = buildJourneyEntry({ journey_id: 1 });
    await offlineDb.journeyEntries.put(entry);
    let restCalled = false;
    server.use(
      http.delete(`/api/journeys/entries/${entry.id}`, () => { restCalled = true; return HttpResponse.json({ success: true }); }),
    );

    await journeyEntryRepo.delete(1, entry.id);

    expect(restCalled).toBe(false);
    expect(await offlineDb.journeyEntries.get(entry.id)).toBeUndefined();
    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe('DELETE');
    expect(pending[0].entityId).toBe(entry.id);
    expect(pending[0].resource).toBe('journeyEntries');
  });
});

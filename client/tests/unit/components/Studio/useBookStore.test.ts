/**
 * useBookStore unit tests — offline safety-net behavior added for task #23.
 * The existing autosave/conflict machinery (queueSave debounce, 409
 * conflict, 403 readonly) is untouched; these tests cover only the new
 * "don't lose a save that failed because the client was offline" path.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { http, HttpResponse } from 'msw';
import { server } from '../../../helpers/msw/server';
import { useBookStore } from '../../../../src/components/Studio/useBookStore';
import { offlineDb, clearAll } from '../../../../src/db/offlineDb';
import type { BookDocument } from '../../../../src/types/book';

const JOURNEY_ID = 1;

function makeDoc(title = 'Doc'): BookDocument {
  return {
    version: 1,
    title,
    page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
    spreads: [{ id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null }],
  };
}

beforeEach(async () => {
  await clearAll();
  server.use(http.get(`/api/journeys/${JOURNEY_ID}/book`, () => HttpResponse.json({ book: null })));
});

describe('useBookStore — offline safety net', () => {
  it('persists the edit to IndexedDB when a save fails with no server response (offline), and stays in error state', async () => {
    server.use(http.put(`/api/journeys/${JOURNEY_ID}/book`, () => HttpResponse.error()));

    const { result } = renderHook(() => useBookStore(JOURNEY_ID));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => { result.current.saveNow(makeDoc('My trip'), 'My trip'); });
    await waitFor(async () => expect(await offlineDb.journeyBookDrafts.get(JOURNEY_ID)).toBeDefined());

    const draft = await offlineDb.journeyBookDrafts.get(JOURNEY_ID);
    expect(draft!.title).toBe('My trip');
    expect(draft!.document.title).toBe('My trip');
    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  it('clears any persisted draft once a save reaches the server successfully', async () => {
    await offlineDb.journeyBookDrafts.put({
      journeyId: JOURNEY_ID, document: makeDoc('Stale'), title: 'Stale', baseVersion: null, savedLocallyAt: Date.now(),
    });
    server.use(http.put(`/api/journeys/${JOURNEY_ID}/book`, () =>
      HttpResponse.json({ book: { id: 1, journeyId: JOURNEY_ID, title: 'Saved', version: 2, updatedAt: null, updatedBy: null, document: makeDoc('Saved') } }),
    ));

    const { result } = renderHook(() => useBookStore(JOURNEY_ID));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => { result.current.saveNow(makeDoc('Saved'), 'Saved'); });
    await waitFor(() => expect(result.current.state.status).toBe('saved'));

    expect(await offlineDb.journeyBookDrafts.get(JOURNEY_ID)).toBeUndefined();
  });

  it('resumes a previously-persisted draft on load, checked against its own baseVersion rather than the freshly-fetched one', async () => {
    await offlineDb.journeyBookDrafts.put({
      journeyId: JOURNEY_ID, document: makeDoc('Resumed edit'), title: 'Resumed edit', baseVersion: 5, savedLocallyAt: Date.now(),
    });
    let capturedBaseVersion: number | undefined;
    server.use(
      // The server's current record is a newer version than the draft's baseVersion —
      // if the resume incorrectly used it as the base, this wouldn't reproduce the check.
      http.get(`/api/journeys/${JOURNEY_ID}/book`, () =>
        HttpResponse.json({ book: { id: 1, journeyId: JOURNEY_ID, title: 'Server title', version: 9, updatedAt: null, updatedBy: null, document: makeDoc('Server title') } }),
      ),
      http.put(`/api/journeys/${JOURNEY_ID}/book`, async ({ request }) => {
        const body = await request.json() as { baseVersion?: number };
        capturedBaseVersion = body.baseVersion;
        return HttpResponse.json({ book: { id: 1, journeyId: JOURNEY_ID, title: 'Resumed edit', version: 6, updatedAt: null, updatedBy: null, document: makeDoc('Resumed edit') } });
      }),
    );

    renderHook(() => useBookStore(JOURNEY_ID));

    await waitFor(() => expect(capturedBaseVersion).toBe(5));
  });

  it('acceptTheirs discards the persisted draft along with the local edit', async () => {
    await offlineDb.journeyBookDrafts.put({
      journeyId: JOURNEY_ID, document: makeDoc('Mine'), title: 'Mine', baseVersion: 1, savedLocallyAt: Date.now(),
    });
    server.use(http.put(`/api/journeys/${JOURNEY_ID}/book`, () =>
      new HttpResponse(JSON.stringify({
        current: { id: 1, journeyId: JOURNEY_ID, title: 'Theirs', version: 2, updatedAt: null, updatedBy: null, document: makeDoc('Theirs') },
      }), { status: 409 }),
    ));

    const { result } = renderHook(() => useBookStore(JOURNEY_ID));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => { result.current.saveNow(makeDoc('Mine'), 'Mine'); });
    await waitFor(() => expect(result.current.state.status).toBe('conflict'));

    act(() => {
      const conflictState = result.current.state as { status: 'conflict'; current: any };
      result.current.acceptTheirs(conflictState.current);
    });

    await waitFor(async () => expect(await offlineDb.journeyBookDrafts.get(JOURNEY_ID)).toBeUndefined());
  });

  it('retries a persisted draft when the browser comes back online', async () => {
    await offlineDb.journeyBookDrafts.put({
      journeyId: JOURNEY_ID, document: makeDoc('Reconnect me'), title: 'Reconnect me', baseVersion: 1, savedLocallyAt: Date.now(),
    });
    // The load-time resume attempt fails (still offline) — the draft must
    // survive that first attempt for there to be anything left to retry.
    server.use(http.put(`/api/journeys/${JOURNEY_ID}/book`, () => HttpResponse.error()));

    const { result } = renderHook(() => useBookStore(JOURNEY_ID));
    // Wait for the mount-time resume attempt to actually finish (not just
    // for the draft row to exist — it already existed from the put() above,
    // so that alone wouldn't prove the first write() attempt had settled,
    // and dispatching 'online' while it's still in flight would be a no-op
    // per the online handler's own inFlight guard).
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    let putCalled = false;
    server.use(http.put(`/api/journeys/${JOURNEY_ID}/book`, () => {
      putCalled = true;
      return HttpResponse.json({ book: { id: 1, journeyId: JOURNEY_ID, title: 'Reconnect me', version: 2, updatedAt: null, updatedBy: null, document: makeDoc('Reconnect me') } });
    }));

    act(() => { window.dispatchEvent(new Event('online')); });

    await waitFor(() => expect(putCalled).toBe(true));
    await waitFor(async () => expect(await offlineDb.journeyBookDrafts.get(JOURNEY_ID)).toBeUndefined());
  });
});

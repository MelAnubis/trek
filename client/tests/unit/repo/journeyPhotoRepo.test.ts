/**
 * journeyPhotoRepo unit tests — the JSON-only photo operations
 * (link/unlink/delete). No Dexie table backs these (see the repo's own
 * comment); offline just means "enqueue for replay, no REST call now."
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { server } from '../../helpers/msw/server';
import { http, HttpResponse } from 'msw';
import { journeyPhotoRepo } from '../../../src/repo/journeyPhotoRepo';
import { offlineDb, clearAll } from '../../../src/db/offlineDb';

beforeEach(async () => {
  await clearAll();
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('journeyPhotoRepo.linkPhoto', () => {
  it('online — calls REST', async () => {
    let called = false;
    server.use(
      http.post('/api/journeys/entries/10/link-photo', () => { called = true; return HttpResponse.json({ id: 5 }); }),
    );
    const result = await journeyPhotoRepo.linkPhoto(10, 1, 5);
    expect(called).toBe(true);
    expect(result).toEqual({ id: 5 });
  });

  it('offline — enqueues a POST with the right body, no REST call', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    let called = false;
    server.use(
      http.post('/api/journeys/entries/10/link-photo', () => { called = true; return HttpResponse.json({}); }),
    );

    const result = await journeyPhotoRepo.linkPhoto(10, 1, 5);

    expect(called).toBe(false);
    expect(result).toBeNull();
    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe('POST');
    expect(pending[0].url).toBe('/journeys/entries/10/link-photo');
    expect(pending[0].body).toEqual({ journey_photo_id: 5 });
    expect(pending[0].journeyId).toBe(1);
  });
});

describe('journeyPhotoRepo.unlinkPhoto', () => {
  it('offline — enqueues a DELETE, no REST call', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    let called = false;
    server.use(
      http.delete('/api/journeys/entries/10/photos/5', () => { called = true; return HttpResponse.json({}); }),
    );

    await journeyPhotoRepo.unlinkPhoto(10, 1, 5);

    expect(called).toBe(false);
    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe('DELETE');
    expect(pending[0].url).toBe('/journeys/entries/10/photos/5');
  });
});

describe('journeyPhotoRepo.deleteGalleryPhoto', () => {
  it('online — calls REST', async () => {
    let called = false;
    server.use(
      http.delete('/api/journeys/1/gallery/5', () => { called = true; return HttpResponse.json({ success: true }); }),
    );
    await journeyPhotoRepo.deleteGalleryPhoto(1, 5);
    expect(called).toBe(true);
  });

  it('offline — enqueues a DELETE, no REST call', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    let called = false;
    server.use(
      http.delete('/api/journeys/1/gallery/5', () => { called = true; return HttpResponse.json({}); }),
    );

    await journeyPhotoRepo.deleteGalleryPhoto(1, 5);

    expect(called).toBe(false);
    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending[0].url).toBe('/journeys/1/gallery/5');
    expect(pending[0].journeyId).toBe(1);
  });
});

describe('journeyPhotoRepo.deletePhoto', () => {
  it('offline — enqueues a DELETE, no REST call', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    let called = false;
    server.use(
      http.delete('/api/journeys/photos/5', () => { called = true; return HttpResponse.json({}); }),
    );

    await journeyPhotoRepo.deletePhoto(1, 5);

    expect(called).toBe(false);
    const pending = await offlineDb.mutationQueue.toArray();
    expect(pending[0].url).toBe('/journeys/photos/5');
  });
});

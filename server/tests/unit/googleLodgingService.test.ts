import { describe, it, expect, vi, beforeEach } from 'vitest';

const keyMock = vi.fn();
const fetchMock = vi.fn();
vi.mock('../../src/services/mapsService', () => ({
  getMapsKey: (...a: unknown[]) => keyMock(...a),
  googleFetch: (...a: unknown[]) => fetchMock(...a),
}));

import { searchGoogleLodgingNear, googleLodgingAvailable, resetGoogleLodgingCache } from '../../src/services/googleLodgingService';

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const place = (id: string, lat: number, lng: number, name = 'Hotel') => ({ id, displayName: { text: name }, location: { latitude: lat, longitude: lng } });

beforeEach(() => { keyMock.mockReset(); fetchMock.mockReset(); resetGoogleLodgingCache(); keyMock.mockReturnValue('KEY'); });

describe('googleLodgingService', () => {
  it('GL-001 — availability follows the Google Maps key', () => {
    keyMock.mockReturnValue(null);
    expect(googleLodgingAvailable(1)).toBe(false);
    keyMock.mockReturnValue('KEY');
    expect(googleLodgingAvailable(1)).toBe(true);
  });

  it('GL-002 — sends a Nearby Search (New) request: lodging types, distance ranking, a circle, basic fields only', async () => {
    fetchMock.mockResolvedValue(res(200, { places: [place('a', 40.1, -3.1, 'Hostal A'), place('b', 40.2, -3.2)] }));
    const r = await searchGoogleLodgingNear(7, 40.15, -3.15, 5000);
    expect(r).toEqual([{ id: 'a', name: 'Hostal A', lat: 40.1, lng: -3.1 }, { id: 'b', name: 'Hotel', lat: 40.2, lng: -3.2 }]);
    const [endpoint, , init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(init.headers['X-Goog-Api-Key']).toBe('KEY');
    expect(init.headers['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.location');
    const body = JSON.parse(init.body);
    expect(body.includedTypes).toEqual(expect.arrayContaining(['lodging', 'campground', 'guest_house', 'bed_and_breakfast']));
    expect(body.rankPreference).toBe('DISTANCE');
    expect(body.maxResultCount).toBe(20);
    expect(body.locationRestriction.circle).toEqual({ center: { latitude: 40.15, longitude: -3.15 }, radius: 5000 });
    expect(keyMock).toHaveBeenCalledWith(7);
  });

  it('GL-003 — clamps the radius to Google\'s 50 km limit', async () => {
    fetchMock.mockResolvedValue(res(200, { places: [] }));
    await searchGoogleLodgingNear(1, 40, -3, 999999);
    expect(JSON.parse(fetchMock.mock.calls[0][2].body).locationRestriction.circle.radius).toBe(50000);
  });

  it('GL-004 — no key: fails with NO_KEY without calling Google', async () => {
    keyMock.mockReturnValue(null);
    await expect(searchGoogleLodgingNear(1, 40, -3, 1000)).rejects.toMatchObject({ code: 'NO_KEY' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GL-005 — results are cached in memory (same area, same radius → one request)', async () => {
    fetchMock.mockResolvedValue(res(200, { places: [place('a', 40.1, -3.1)] }));
    await searchGoogleLodgingNear(1, 40.0001, -3.0001, 5000);
    await searchGoogleLodgingNear(1, 40.0002, -3.0002, 5000);          // mismo ~100 m
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await searchGoogleLodgingNear(1, 40.5, -3.5, 5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GL-006 — retries with just "lodging" if Google rejects one of the types', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { error: { message: 'Invalid type: extended_stay_hotel', status: 'INVALID_ARGUMENT' } }));
    fetchMock.mockResolvedValueOnce(res(200, { places: [place('a', 40.1, -3.1)] }));
    const r = await searchGoogleLodgingNear(1, 40, -3, 5000);
    expect(r).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[1][2].body).includedTypes).toEqual(['lodging']);
  });

  it('GL-007 — surfaces Google errors with status and code (API not enabled, quota…)', async () => {
    fetchMock.mockResolvedValue(res(403, { error: { message: 'Places API (New) has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED' } }));
    await expect(searchGoogleLodgingNear(1, 40, -3, 5000)).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
  });

  it('GL-008 — ignores places without usable coordinates', async () => {
    fetchMock.mockResolvedValue(res(200, { places: [place('a', 40.1, -3.1), { id: 'b' }, { id: 'c', location: { latitude: 'x', longitude: 1 } }] }));
    expect((await searchGoogleLodgingNear(1, 40, -3, 5000)).map(p => p.id)).toEqual(['a']);
  });
});

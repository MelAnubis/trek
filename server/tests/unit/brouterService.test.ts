import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeWithBrouter, isBrouterProfile } from '../../src/services/brouterService';

const geojson = (coords: number[][], props: Record<string, string> = {}) => ({
  ok: true, status: 200,
  json: async () => ({ features: [{ geometry: { coordinates: coords }, properties: { 'track-length': '12000', 'filtered ascend': '150', ...props } }] }),
  text: async () => '',
});

afterEach(() => { vi.unstubAllGlobals(); delete process.env.BROUTER_URL; });

describe('brouterService', () => {
  it('BR-001 — builds the lon,lat request, swaps to [lat,lng,ele] and reads length/ascent', async () => {
    const f = vi.fn().mockResolvedValue(geojson([[-3.7, 40.4, 650], [-3.8, 40.5, 700]]));
    vi.stubGlobal('fetch', f);
    const r = await routeWithBrouter([{ lat: 40.4, lng: -3.7 }, { lat: 40.5, lng: -3.8 }], 'trekking');
    expect(r.points).toEqual([[40.4, -3.7, 650], [40.5, -3.8, 700]]);
    expect(r.distanceKm).toBe(12);
    expect(r.ascentM).toBe(150);
    const url = decodeURIComponent(f.mock.calls[0][0] as string);
    expect(url).toContain('lonlats=-3.700000,40.400000|-3.800000,40.500000');
    expect(url).toContain('profile=trekking');
    expect(url.startsWith('https://brouter.de/brouter?')).toBe(true);
  });

  it('BR-002 — BROUTER_URL overrides the base URL', async () => {
    process.env.BROUTER_URL = 'http://brouter:17777/brouter/';
    const f = vi.fn().mockResolvedValue(geojson([[0, 0, 1], [1, 1, 2]]));
    vi.stubGlobal('fetch', f);
    await routeWithBrouter([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]);
    expect((f.mock.calls[0][0] as string).startsWith('http://brouter:17777/brouter?')).toBe(true);
  });

  it('BR-003 — splits long waypoint lists into overlapping requests and joins them without duplicating the seam', async () => {
    const wps = Array.from({ length: 30 }, (_, i) => ({ lat: 40 + i * 0.1, lng: -3 }));
    const f = vi.fn().mockImplementation(async (url: string) => {
      const pts = decodeURIComponent(url).match(/lonlats=([^&]+)/)![1].split('|').map(p => p.split(',').map(Number));
      return geojson(pts.map(([lo, la]) => [lo, la, 100]), { 'track-length': '1000', 'filtered ascend': '10' });
    });
    vi.stubGlobal('fetch', f);
    const r = await routeWithBrouter(wps);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.points).toHaveLength(30);
    expect(r.distanceKm).toBe(3);
    expect(r.ascentM).toBe(30);
  });

  it('BR-004 — maps BRouter 400 to 422 and network/5xx to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'datafile not found' }));
    await expect(routeWithBrouter([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).rejects.toMatchObject({ status: 422 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }));
    await expect(routeWithBrouter([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(routeWithBrouter([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).rejects.toMatchObject({ status: 502 });
  });

  it('BR-005 — validates input and profiles', async () => {
    await expect(routeWithBrouter([{ lat: 0, lng: 0 }])).rejects.toMatchObject({ status: 400 });
    await expect(routeWithBrouter([{ lat: 99, lng: 0 }, { lat: 1, lng: 1 }])).rejects.toMatchObject({ status: 400 });
    expect(isBrouterProfile('trekking')).toBe(true);
    expect(isBrouterProfile('car-fast')).toBe(false);
  });
});

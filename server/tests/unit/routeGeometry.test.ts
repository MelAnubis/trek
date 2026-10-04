import { describe, it, expect } from 'vitest';
import {
  haversineKm, dedupeNearby, dropOutliers, orderByShortestPath, trackQuality, cumulativeKm, nearestOnTrack,
  indexAtKm, simplifyLine, chooseStageCuts, type GeoPoint, type TrackPoint,
} from '../../src/services/routeGeometry';

const P = (lat: number, lng: number, name = ''): GeoPoint & { name: string } => ({ lat, lng, name });
const pathLen = (xs: GeoPoint[]) => xs.slice(1).reduce((s, p, i) => s + haversineKm(xs[i], p), 0);
/** Track recto de ~1 km por punto entre dos coordenadas. */
function straight(a: GeoPoint, b: GeoPoint): TrackPoint[] {
  const n = Math.max(2, Math.ceil(haversineKm(a, b)));
  return Array.from({ length: n + 1 }, (_, i) => [a.lat + (b.lat - a.lat) * i / n, a.lng + (b.lng - a.lng) * i / n, 700]);
}

describe('dedupeNearby / dropOutliers', () => {
  it('RG-001 — keeps the first of several places in the same town', () => {
    const r = dedupeNearby([P(40.9429, -4.1088, 'San Millán'), P(40.9440, -4.1100, 'San Esteban'), P(41.3, -3.74, 'Sepúlveda')]);
    expect(r.kept.map(p => p.name)).toEqual(['San Millán', 'Sepúlveda']);
    expect(r.merged.map(p => p.name)).toEqual(['San Esteban']);
  });

  it('RG-002 — drops a homonym far from the rest, but not a long linear route', () => {
    const province = [P(40.94, -4.11), P(41.3, -3.74), P(41.14, -3.8), P(41.42, -3.37), P(41.26, -3.48), P(4.7, -74.0, 'Segovia, Colombia')];
    const r = dropOutliers(province);
    expect(r.dropped.map(p => p.name)).toEqual(['Segovia, Colombia']);
    // Madrid → Santiago (≈ 500 km en línea): nadie es atípico
    const camino = [P(40.41, -3.7), P(41.65, -4.72), P(42.35, -3.7), P(42.6, -5.57), P(42.88, -8.54)];
    expect(dropOutliers(camino).dropped).toEqual([]);
  });

  it('RG-003 — needs 4+ places to judge, and never leaves fewer than 2', () => {
    expect(dropOutliers([P(40, -3), P(4, -74), P(41, -3)]).dropped).toEqual([]);
  });
});

describe('orderByShortestPath', () => {
  const zigzag = [P(40.94, -4.11, 'Segovia'), P(41.42, -3.37, 'Ayllón'), P(41.14, -3.8, 'Pedraza'), P(41.26, -3.48, 'Riaza'), P(41.16, -4.01, 'Turégano'), P(41.3, -3.74, 'Sepúlveda')];

  it('RG-004 — fixes a zig-zag order: the result is never longer, and strictly shorter here', () => {
    const out = orderByShortestPath(zigzag);
    expect(out).toHaveLength(zigzag.length);
    expect(new Set(out.map(p => p.name)).size).toBe(zigzag.length);
    expect(pathLen(out)).toBeLessThan(pathLen(zigzag) - 20);
  });

  it('RG-005 — is optimal (checked against brute force on 7 points)', () => {
    const pts = [P(40, -4, 'a'), P(41, -3, 'b'), P(40.5, -3.2, 'c'), P(41.4, -4.2, 'd'), P(40.2, -3.6, 'e'), P(41.1, -3.7, 'f'), P(40.8, -4.4, 'g')];
    const perms = (xs: GeoPoint[]): GeoPoint[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r]));
    const best = Math.min(...perms(pts).map(pathLen));
    expect(pathLen(orderByShortestPath(pts))).toBeCloseTo(best, 6);
  });

  it('RG-006 — respects a fixed start and a fixed end', () => {
    const pts = [P(40.94, -4.11, 'START'), P(41.14, -3.8, 'x'), P(41.3, -3.74, 'y'), P(41.42, -3.37, 'z'), P(40.95, -4.1, 'END')];
    const out = orderByShortestPath(pts, { startFixed: true, endFixed: true });
    expect(out[0].name).toBe('START');
    expect(out[out.length - 1].name).toBe('END');
    expect(out.slice(1, -1).map(p => p.name).sort()).toEqual(['x', 'y', 'z']);
    const onlyStart = orderByShortestPath(pts, { startFixed: true });
    expect(onlyStart[0].name).toBe('START');
  });

  it('RG-007 — with free ends keeps the requested direction (first listed place before the last)', () => {
    const a = P(40, -4, 'a'), b = P(40.5, -4, 'b'), c = P(41, -4, 'c');
    expect(orderByShortestPath([a, b, c]).map(p => p.name)).toEqual(['a', 'b', 'c']);
    expect(orderByShortestPath([c, b, a]).map(p => p.name)).toEqual(['c', 'b', 'a']);
  });

  it('RG-008 — trivial and oversized inputs come back untouched', () => {
    const two = [P(1, 1), P(2, 2)];
    expect(orderByShortestPath(two)).toEqual(two);
    const many = Array.from({ length: 16 }, (_, i) => P(40 + (i % 2) * 0.5, -4 + i * 0.1));
    expect(orderByShortestPath(many)).toEqual(many);
  });
});

describe('trackQuality', () => {
  const a = P(40, -4), b = P(40.5, -4);

  it('RG-009 — a clean straight track: no gap, ratio ≈ 1, waypoints on the track', () => {
    const q = trackQuality(straight(a, b), [a, b]);
    expect(q.maxGapKm).toBeLessThan(1.5);
    expect(q.detourRatio).toBeCloseTo(1, 1);
    expect(q.waypointOffM.every(m => m < 50)).toBe(true);
  });

  it('RG-010 — detects a broken track (a jump between consecutive points)', () => {
    const broken: TrackPoint[] = [...straight(a, P(40.2, -4)), ...straight(P(40.4, -4), b)];
    expect(trackQuality(broken, [a, b]).maxGapKm).toBeGreaterThan(20);
  });

  it('RG-011 — detects detours and waypoints the track does not pass through', () => {
    const detour: TrackPoint[] = [...straight(a, P(40.25, -3.5)), ...straight(P(40.25, -3.5), b)];
    const q = trackQuality(detour, [a, b]);
    expect(q.detourRatio).toBeGreaterThan(1.4);
    const q2 = trackQuality(straight(a, b), [a, P(40.25, -3.97), b]);   // ~2,5 km al este de la recta
    expect(q2.waypointOffM[1]).toBeGreaterThan(2000);
    expect(q2.waypointOffM[1]).toBeLessThan(3000);
  });
});

describe('track helpers', () => {
  const t = straight(P(40, -4), P(41, -4));
  const cum = cumulativeKm(t);

  it('RG-012 — nearestOnTrack and indexAtKm', () => {
    const n = nearestOnTrack(t, cum, P(40.5, -3.99));
    expect(n.km).toBeGreaterThan(54); expect(n.km).toBeLessThan(57);
    expect(n.offM).toBeGreaterThan(700); expect(n.offM).toBeLessThan(900);
    expect(indexAtKm(cum, 0)).toBe(0);
    expect(indexAtKm(cum, 1e9)).toBe(t.length - 1);
    expect(Math.abs(cum[indexAtKm(cum, 50)] - 50)).toBeLessThan(1);
  });

  it('RG-013 — simplifyLine caps points and keeps both ends', () => {
    const zig: TrackPoint[] = Array.from({ length: 3000 }, (_, i) => [40 + i * 0.001, -3 + (i % 2) * 0.002, null]);
    const s = simplifyLine(zig, 120);
    expect(s.length).toBeLessThanOrEqual(120);
    expect(s[0]).toEqual([zig[0][0], zig[0][1]]);
    expect(s[s.length - 1]).toEqual([zig[2999][0], zig[2999][1]]);
    expect(simplifyLine(zig.slice(0, 10), 120)).toHaveLength(10);
  });
});

describe('chooseStageCuts', () => {
  it('RG-014 — picks the lodging closest to each ideal mark, within ±30 % of the stage length', () => {
    const cuts = chooseStageCuts(300, 3, [40, 95, 104, 210, 240]);   // marcas ideales: 100 y 200; ventana ±30
    expect(cuts).toEqual([{ km: 104, lodged: true }, { km: 210, lodged: true }]);
  });

  it('RG-015 — without lodging near a mark, keeps the ideal cut and flags it', () => {
    const cuts = chooseStageCuts(300, 3, [10, 290]);
    expect(cuts).toEqual([{ km: 100, lodged: false }, { km: 200, lodged: false }]);
  });

  it('RG-016 — never picks a lodging too close to the previous cut or to the end; ignores bad input', () => {
    const cuts = chooseStageCuts(100, 2, [5, 95, NaN, 52]);   // L=50, ventana 15, 0,4·L=20
    expect(cuts).toEqual([{ km: 52, lodged: true }]);
    expect(chooseStageCuts(100, 1, [50])).toEqual([]);
    expect(chooseStageCuts(0, 3, [])).toEqual([]);
  });
});

import { detourCostKm, dropDetourStops, retraceKm } from '../../src/services/routeGeometry';

describe('closed tours', () => {
  it('RG-017 — closed: shortest circuit from a fixed start, never longer than any open order + the way back', () => {
    const pts = [P(40, -4, 'S'), P(41, -3, 'b'), P(40.5, -3.2, 'c'), P(41.4, -4.2, 'd'), P(40.2, -3.6, 'e')];
    const out = orderByShortestPath(pts, { closed: true });
    expect(out[0].name).toBe('S');
    expect(new Set(out.map(p => p.name)).size).toBe(5);
    const tour = (xs: GeoPoint[]) => pathLen(xs) + haversineKm(xs[xs.length - 1], xs[0]);
    const perms = (xs: GeoPoint[]): GeoPoint[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r]));
    const best = Math.min(...perms(pts.slice(1)).map(r => tour([pts[0], ...r])));
    expect(tour(out)).toBeCloseTo(best, 6);
  });
});

describe('detours', () => {
  const A = P(40.656, -4.7, 'Ávila'), SAL = P(40.97, -5.664, 'Salamanca'), PLA = P(40.03, -6.09, 'Plasencia'), CR = P(40.6, -6.533, 'Ciudad Rodrigo');

  it('RG-018 — detourCostKm: 0 on a straight line, positive off it, 0 at the ends', () => {
    const line = [P(40, -4), P(40.5, -4), P(41, -4)];
    expect(detourCostKm(line, 1)).toBeCloseTo(0, 3);
    expect(detourCostKm([P(40, -4), P(40.5, -3.5), P(41, -4)], 1)).toBeGreaterThan(10);
    expect(detourCostKm(line, 0)).toBe(0);
    expect(detourCostKm(line, 2)).toBe(0);
  });

  it('RG-019 — dropDetourStops removes the stop that forces a big spur, keeps the one on the way', () => {
    const r = dropDetourStops([A, SAL, PLA, CR]);   // Plasencia queda ~100 km al sur de la ruta Ávila→Ciudad Rodrigo
    expect(r.dropped.map(p => p.name)).toEqual(['Plasencia']);
    expect(r.kept.map(p => p.name)).toEqual(['Ávila', 'Salamanca', 'Ciudad Rodrigo']);
  });

  it('RG-020 — dropDetourStops leaves reasonable routes and short lists alone', () => {
    const line = [P(40, -4, 'a'), P(40.5, -4.01, 'b'), P(41, -4, 'c')];
    expect(dropDetourStops(line).dropped).toEqual([]);
    expect(dropDetourStops([A, CR]).kept).toHaveLength(2);
  });
});

describe('retraceKm', () => {
  it('RG-021 — a one-way track retraces nothing', () => {
    expect(retraceKm(straight(P(40, -4), P(41, -4)))).toBeLessThan(0.5);
  });

  it('RG-022 — an out-and-back spur counts (≈ the length of the way back)', () => {
    const out = straight(P(40, -4), P(40.5, -4));           // ≈ 55 km
    const back = out.slice(0, -1).reverse();
    const km = retraceKm([...out, ...back]);
    expect(km).toBeGreaterThan(45);
    expect(km).toBeLessThan(65);
  });

  it('RG-023 — a plain crossing of two roads does not count as retracing', () => {
    const ns = straight(P(40, -4), P(41, -4)), ew = straight(P(40.5, -4.6), P(40.5, -3.4));
    expect(retraceKm([...ns, ...ew])).toBeLessThan(2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  haversineKm, dedupeNearby, dropOutliers, orderByShortestPath, trackQuality, cumulativeKm, nearestOnTrack,
  indexAtKm, simplifyLine, chooseStageCuts, clusterLodging, legStats, type GeoPoint, type TrackPoint, type TownSpot,
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

describe('lodging clusters and stage cuts', () => {
  it('RG-014 — clusterLodging groups places within 1,5 km (a town) and counts them', () => {
    const c = clusterLodging([10, 10.4, 11.2, 30, 55, 55.3, 55.9, 56.4]);
    expect(c.map(x => x.weight)).toEqual([3, 1, 4]);
    expect(c[0].km).toBeGreaterThan(9.9); expect(c[0].km).toBeLessThan(11.3);
    expect(clusterLodging([])).toEqual([]);
    expect(clusterLodging([NaN, 5])).toEqual([{ km: 5, weight: 1 }]);
  });

  it('RG-015 — moves each cut to the closest lodging within ±7 km, shorter or longer', () => {
    // total 300, 3 etapas → marcas 100 y 200
    const cuts = chooseStageCuts(300, 3, [{ km: 94, weight: 1 }, { km: 205, weight: 1 }, { km: 140, weight: 5 }]);
    expect(cuts.map(c => c.lodged)).toEqual([true, true]);
    expect(cuts[0].km).toBe(94); expect(cuts[0].shiftKm).toBe(-6);
    expect(cuts[1].km).toBe(205); expect(cuts[1].shiftKm).toBe(5);
  });

  it('RG-016 — prefers a town (several lodgings) over a lone hotel when both are within reach', () => {
    const cuts = chooseStageCuts(200, 2, [{ km: 104, weight: 1 }, { km: 106, weight: 4 }]);   // marca 100
    expect(cuts[0].km).toBe(106);
  });

  it('RG-017 — never moves a cut more than 7 km while a lodging exists within 7 km, even a farther one is better placed', () => {
    const cuts = chooseStageCuts(200, 2, [{ km: 109, weight: 5 }, { km: 96, weight: 1 }]);    // 109 queda a 9 km: fuera
    expect(cuts[0].km).toBe(96);
  });

  it('RG-018 — widens the margin step by step when nothing is within 7 km, and reports the shift', () => {
    const cuts = chooseStageCuts(400, 2, [{ km: 212, weight: 2 }]);   // marca 200, a 12 km
    expect(cuts[0]).toEqual({ km: 212, lodged: true, shiftKm: 12 });
    const far = chooseStageCuts(400, 2, [{ km: 230, weight: 2 }]);   // a 30 km: fuera incluso del margen ampliado (21)
    expect(far[0]).toEqual({ km: 200, lodged: false, shiftKm: 0 });
  });

  it('RG-019 — respects custom marks (adjusting existing cuts) and never packs two cuts together', () => {
    const cuts = chooseStageCuts(300, 0, [{ km: 98, weight: 1 }, { km: 104, weight: 1 }, { km: 203, weight: 1 }], { marks: [100, 200] });
    expect(cuts.map(c => c.km)).toEqual([98, 203]);
    const crowded = chooseStageCuts(300, 3, [{ km: 100, weight: 1 }, { km: 102, weight: 3 }]);   // ambos caben en la 1ª marca; la 2ª no puede reutilizarlos
    expect(crowded[0].km).toBe(102);
    expect(crowded[1].lodged).toBe(false);
  });

  it('RG-020 — bad input gives no cuts', () => {
    expect(chooseStageCuts(100, 1, [{ km: 50, weight: 1 }])).toEqual([]);
    expect(chooseStageCuts(0, 3, [])).toEqual([]);
  });
});

describe('towns as the fallback when no lodging is mapped', () => {
  const town = (km: number, name: string, weight = 3): TownSpot => ({ km, name, weight });

  it('RG-040 — with no lodging, the cut goes to a town within ±7 km (shorter or longer) and is flagged as a town', () => {
    const cuts = chooseStageCuts(200, 2, [], { towns: [town(104, 'Béjar'), town(150, 'Lejos')] });   // marca 100
    expect(cuts[0]).toMatchObject({ km: 104, lodged: false, town: true, place: 'Béjar', shiftKm: 4 });
  });

  it('RG-041 — lodging within reach still wins over a town, and the cut gets the name of the town next to it', () => {
    const cuts = chooseStageCuts(200, 2, [{ km: 105, weight: 1 }], { towns: [town(100.5, 'Pueblo'), town(106.5, 'Salamanca', 4)] });
    expect(cuts[0].lodged).toBe(true);
    expect(cuts[0].town).toBeUndefined();
    expect(cuts[0].km).toBe(105);
    expect(cuts[0].place).toBe('Salamanca');                          // la población más cercana al alojamiento (≤ 3 km)
  });

  it('RG-042 — a nearby town beats a lodging that is far away (the margin widens one step at a time, town before lodging)', () => {
    const cuts = chooseStageCuts(400, 2, [{ km: 215, weight: 3 }], { towns: [town(204, 'Cerca')] });   // marca 200: pueblo a 4 km, alojamiento a 15 km
    expect(cuts[0]).toMatchObject({ km: 204, lodged: false, town: true, place: 'Cerca' });
  });

  it('RG-043 — the margin widens for towns too (7 → 12 → 21 km) and the shift is reported', () => {
    const cuts = chooseStageCuts(400, 2, [], { towns: [town(212, 'Algo lejos')] });
    expect(cuts[0]).toMatchObject({ km: 212, town: true, shiftKm: 12 });
    const none = chooseStageCuts(400, 2, [], { towns: [town(240, 'Demasiado')] });
    expect(none[0]).toEqual({ km: 200, lodged: false, shiftKm: 0 });
  });

  it('RG-044 — prefers a city over a hamlet when both are close; never packs two cuts into the same town', () => {
    const c1 = chooseStageCuts(200, 2, [], { towns: [town(103, 'Aldea', 2), town(104, 'Ciudad', 4)] });   // casi a la misma distancia: gana la ciudad
    expect(c1[0].place).toBe('Ciudad');
    const c1b = chooseStageCuts(200, 2, [], { towns: [town(101, 'Aldea', 2), town(106, 'Ciudad', 4)] });  // la aldea está mucho más cerca: gana la aldea
    expect(c1b[0].place).toBe('Aldea');
    const c2 = chooseStageCuts(300, 3, [], { towns: [town(100, 'Única', 3)] });
    expect(c2[0]).toMatchObject({ town: true, place: 'Única' });
    expect(c2[1].town).toBeUndefined();                               // la 2ª marca no puede reutilizarla
  });

  it('RG-045 — the name of the lodging cut ignores towns farther than 3 km', () => {
    const cuts = chooseStageCuts(200, 2, [{ km: 100, weight: 1 }], { towns: [town(104, 'Lejos')] });
    expect(cuts[0].place).toBeUndefined();
  });

  it('RG-046 — marks mode (adjust existing cuts) also uses towns', () => {
    const cuts = chooseStageCuts(300, 0, [{ km: 98, weight: 1 }], { marks: [100, 200], towns: [town(203, 'Pueblo')] });
    expect(cuts.map(c => c.km)).toEqual([98, 203]);
    expect(cuts[1].town).toBe(true);
  });
});

describe('legStats', () => {
  const A = P(40, -4, 'A'), B = P(40.5, -4, 'B'), C = P(41, -4, 'C');
  it('RG-021 — straight legs have ratio ≈ 1', () => {
    const legs = legStats(straight(A, C), cumulativeKm(straight(A, C)), [A, B, C]);
    expect(legs).toHaveLength(2);
    legs.forEach(l => expect(l.ratio).toBeCloseTo(1, 1));
  });
  it('RG-022 — a leg that goes round a mountain range shows a high ratio and the extra km', () => {
    const t: TrackPoint[] = [...straight(A, P(40.2, -3.2)), ...straight(P(40.2, -3.2), B), ...straight(B, C)];
    const legs = legStats(t, cumulativeKm(t), [A, B, C]);
    expect(legs[0].ratio).toBeGreaterThan(1.5);
    expect(legs[0].extraKm).toBeGreaterThan(30);
    expect(legs[1].ratio).toBeCloseTo(1, 1);
  });
  it('RG-023 — stops are located in order along the track (monotonic), even if the track passes near one twice', () => {
    const out = straight(A, C), back = out.slice(0, -1).reverse();
    const legs = legStats([...out, ...back], cumulativeKm([...out, ...back]), [A, C, A]);
    expect(legs[0].roadKm).toBeGreaterThan(100);        // A→C ida
    expect(legs[1].roadKm).toBeGreaterThan(100);        // C→A vuelta
  });
  it('RG-024 — fewer than 2 stops or points gives []', () => {
    expect(legStats(straight(A, C), cumulativeKm(straight(A, C)), [A])).toEqual([]);
  });
});

import { detourCostKm, dropDetourStops, retraceKm } from '../../src/services/routeGeometry';

describe('closed tours', () => {
  it('RG-030 — closed: shortest circuit from a fixed start, never longer than any open order + the way back', () => {
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

  it('RG-031 — detourCostKm: 0 on a straight line, positive off it, 0 at the ends', () => {
    const line = [P(40, -4), P(40.5, -4), P(41, -4)];
    expect(detourCostKm(line, 1)).toBeCloseTo(0, 3);
    expect(detourCostKm([P(40, -4), P(40.5, -3.5), P(41, -4)], 1)).toBeGreaterThan(10);
    expect(detourCostKm(line, 0)).toBe(0);
    expect(detourCostKm(line, 2)).toBe(0);
  });

  it('RG-032 — dropDetourStops removes the stop that forces a big spur, keeps the one on the way', () => {
    const r = dropDetourStops([A, SAL, PLA, CR]);   // Plasencia queda ~100 km al sur de la ruta Ávila→Ciudad Rodrigo
    expect(r.dropped.map(p => p.name)).toEqual(['Plasencia']);
    expect(r.kept.map(p => p.name)).toEqual(['Ávila', 'Salamanca', 'Ciudad Rodrigo']);
  });

  it('RG-033 — dropDetourStops leaves reasonable routes and short lists alone', () => {
    const line = [P(40, -4, 'a'), P(40.5, -4.01, 'b'), P(41, -4, 'c')];
    expect(dropDetourStops(line).dropped).toEqual([]);
    expect(dropDetourStops([A, CR]).kept).toHaveLength(2);
  });
});

describe('retraceKm', () => {
  it('RG-034 — a one-way track retraces nothing', () => {
    expect(retraceKm(straight(P(40, -4), P(41, -4)))).toBeLessThan(0.5);
  });

  it('RG-035 — an out-and-back spur counts (≈ the length of the way back)', () => {
    const out = straight(P(40, -4), P(40.5, -4));           // ≈ 55 km
    const back = out.slice(0, -1).reverse();
    const km = retraceKm([...out, ...back]);
    expect(km).toBeGreaterThan(45);
    expect(km).toBeLessThan(65);
  });

  it('RG-036 — a plain crossing of two roads does not count as retracing', () => {
    const ns = straight(P(40, -4), P(41, -4)), ew = straight(P(40.5, -4.6), P(40.5, -3.4));
    expect(retraceKm([...ns, ...ew])).toBeLessThan(2);
  });
});

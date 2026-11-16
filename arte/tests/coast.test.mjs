import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seaRings, mergeCoast } from '../app/js/coast.js';

const ext = { minLat: 0, maxLat: 10, minLon: 0, maxLon: 10 };
// área con signo (lon, lat) para comprobar qué parte queda como mar
const area = (ring) => { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][1] * ring[i + 1][0] - ring[i + 1][1] * ring[i][0]; return Math.abs(a) / 2; };
const pip = (lat, lon, rings) => { let n = 0; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [yi, xi] = r[i], [yj, xj] = r[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) n++; } return n % 2 === 1; };

test('costa recta oeste→este: el mar queda al sur (a la derecha)', () => {
  const { ok, rings } = seaRings([[[5, -2], [5, 3], [5, 7], [5, 12]]], ext);
  assert.ok(ok);
  assert.equal(rings.length, 1);
  assert.ok(Math.abs(area(rings[0]) - 50) < 1e-6);
  assert.ok(pip(2, 5, rings) && !pip(8, 5, rings));
});

test('península: mar alrededor, tierra dentro de la V', () => {
  const coast = [[[12, 3], [4, 5], [12, 7]]];          // baja por x=3, sube por x=7 (en lat, lon)
  const { ok, rings } = seaRings(coast, ext);
  assert.ok(ok);
  assert.ok(pip(1, 1, rings) && pip(9, 1, rings) && pip(9, 9, rings));
  assert.ok(!pip(9, 5, rings), 'la península es tierra');
});

test('tramos troceados y desordenados se unen; islas como huecos', () => {
  const merged = mergeCoast([[[5, 6], [5, 12]], [[5, -2], [5, 6]]]);
  assert.equal(merged.length, 1);
  // isla antihoraria en (lon, lat) = tierra dentro, en un mar sin costa continental en el recuadro
  const isla = [[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]];   // [lat, lon]
  const { ok, rings } = seaRings([isla], ext);
  assert.ok(ok);
  assert.ok(pip(8, 8, rings), 'todo es mar…');
  assert.ok(!pip(2.5, 2.5, rings), '…menos la isla');
});

test('costa incompleta (termina dentro del mapa): no se inventa el mar', () => {
  const { ok } = seaRings([[[5, -2], [5, 6]]], ext);
  assert.equal(ok, false);
});

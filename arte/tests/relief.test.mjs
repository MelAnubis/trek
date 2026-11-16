import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerrarium, paintRelief, tileRange, lon2x, lat2y, x2lon, y2lat } from '../app/js/relief.js';

test('relieve: decodificación Terrarium y teselas', () => {
  const px = new Uint8ClampedArray([128, 0, 0, 255, 131, 32, 128, 255]);
  const e = decodeTerrarium(px, 2);
  assert.equal(e[0], 0);
  assert.equal(e[1], 3 * 256 + 32 + 0.5);
  assert.ok(Math.abs(x2lon(lon2x(-4.7, 11), 11) + 4.7) < 1e-9);
  assert.ok(Math.abs(y2lat(lat2y(41.2, 11), 11) - 41.2) < 1e-9);
  const tr = tileRange({ minLat: 41.0, maxLat: 41.4, minLon: -5.05, maxLon: -4.45 }, 1400, 36);
  assert.ok((tr.x1 - tr.x0 + 1) * (tr.y1 - tr.y0 + 1) <= 36 && tr.z >= 9);
});

test('relieve: la ladera a sombra (sureste) sale más oscura que la soleada', () => {
  const w = 40, h = 40, el = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) el[y * w + x] = 1000 - Math.hypot(x - 20, y - 20) * 20; // cono
  const { rgba } = paintRelief(el, w, h, 30);
  const a = (x, y) => rgba[(y * w + x) * 4 + 3];
  assert.ok(a(28, 28) > a(12, 12), 'sureste en sombra con luz del noroeste');
  assert.ok(rgba.length === w * h * 4);
});

test('relieve: el fondo marino (cota < 0) se pinta azul y sin sombras de ladera', () => {
  const w = 20, h = 20, el = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) el[y * w + x] = y < 8 ? -30 - y : 20 + (y - 8) * 15;
  const { rgba, min } = paintRelief(el, w, h, 30);
  const px = (x, y) => [...rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
  const sea = px(10, 3), land = px(10, 15);
  assert.ok(sea[2] > sea[0] + 40, 'mar azul');
  assert.ok(land[0] >= land[2], 'tierra en tonos tierra');
  assert.equal(min, 20, 'la cota mínima de tierra ignora el fondo marino');
});

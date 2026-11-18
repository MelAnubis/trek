import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRoutes, shortNames, namePrefix, countKinds, filterRoutes } from '../app/js/trek.js';

const R = (tipo, id, nombre, viaje, fecha, km = 10) => ({ tipo, id, nombre, viaje, fecha, km, puntos: 100 });
const LIST = [
  R('track', 1, 'VV — 010Burgos', 'Vías Verdes Burgos', '2026-10-08 10:00:00', 20),
  R('track', 2, 'VV — 002Quintanar', 'Vías Verdes Burgos', '2026-10-08 09:00:00', 30),
  R('track', 3, 'R03 Valladolid Urueña', 'Tierra de Campos I', '2026-10-17 12:00:00'),
  R('planner', 4, 'Mi circular', null, '2026-11-01 08:00:00'),
  R('tour', 5, 'Subida al castillo', 'Tierra de Campos I', '2026-09-30 08:00:00'),
];

test('por viaje: un grupo por viaje, el planificador aparte, el más reciente primero', () => {
  const g = groupRoutes(LIST, 'viaje');
  assert.deepEqual(g.map((x) => x.titulo), ['Planificador (sin viaje)', 'Tierra de Campos I', 'Vías Verdes Burgos']);
  const vv = g[2];
  assert.equal(vv.km, 50);
  // orden natural: 002 antes que 010
  assert.deepEqual(vv.items.map((i) => i.id), [2, 1]);
});

test('por mes: grupos por mes, dentro de lo más reciente a lo más antiguo', () => {
  const g = groupRoutes(LIST, 'mes');
  assert.deepEqual(g.map((x) => x.titulo), ['noviembre 2026', 'octubre 2026', 'septiembre 2026']);
  assert.deepEqual(g[1].items.map((i) => i.id), [3, 1, 2]);
});

test('sin fecha va al final', () => {
  const g = groupRoutes([R('track', 9, 'x', 'A', null), ...LIST], 'mes');
  assert.equal(g.at(-1).titulo, 'Sin fecha');
});

test('nombres cortos: quita el principio común en un separador', () => {
  const items = [
    R('track', 1, 'Vía Verde Sierra de la Demanda y Santander / Mediterraneo - Etapas — 001Pineda-Monasterio'),
    R('track', 2, 'Vía Verde Sierra de la Demanda y Santander / Mediterraneo - Etapas — 002Quintanar'),
    R('track', 3, 'Vía Verde Sierra de la Demanda y Santander / Mediterraneo - Etapas — 005Burgos'),
  ];
  const s = shortNames(items);
  assert.deepEqual(items.map((i) => s.get(i)), ['… 001Pineda-Monasterio', '… 002Quintanar', '… 005Burgos']);
  assert.equal(namePrefix(items), 'Vía Verde Sierra de la Demanda y Santander / Mediterraneo - Etapas — ');
});

test('nombres cortos: no parte palabras ni deja nombres vacíos', () => {
  const a = [R('track', 1, 'Vuelta a la Tierra de Campos'), R('track', 2, 'Vuelta a la Tierra de Campos II')];
  assert.equal(shortNames(a).get(a[0]), 'Vuelta a la Tierra de Campos', 'si a uno no le queda nada, no se abrevia ninguno');
  const b = [R('track', 1, 'Valladolid Urueña'), R('track', 2, 'Valladolid Tordesillas')];
  assert.equal(shortNames(b).get(b[0]), 'Valladolid Urueña', 'un prefijo corto no se quita');
  const c = [R('track', 1, 'Ruta del Duero por Castilla Tordesillas'), R('track', 2, 'Ruta del Duero por Castilla Toro')];
  assert.deepEqual(c.map((i) => shortNames(c).get(i)), ['… Tordesillas', '… Toro'], 'corta en el espacio, no en «Tor»');
});

test('cuenta por tipo y filtra sin acentos', () => {
  assert.deepEqual(countKinds(LIST), { track: 3, planner: 1, tour: 1 });
  assert.deepEqual(filterRoutes(LIST, 'vias burgos').map((i) => i.id), [1, 2]);
});

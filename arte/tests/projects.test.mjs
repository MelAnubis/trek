import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshot, checkProject, applyTownState } from '../app/js/projects.js';

const gpx = readFileSync(new URL('../app/samples/Arevalo_circular.gpx', import.meta.url), 'utf8');

test('la composición guarda el GPX literal y sobrevive a JSON', () => {
  const towns = [{ id: 'n1', selected: true, choice: 'h1', manual: true, drawing: 'castillo-coca', stageEnd: false, heritage: [{ id: 'h1' }] }];
  const p = snapshot({ nombre: ' Mi ruta ', raw: gpx, fileName: 'a.gpx', opts: { style: 'acuarela' }, towns, osm: { places: [] }, appVersion: 'x' });
  const back = checkProject(JSON.parse(JSON.stringify(p)));
  assert.equal(back.gpx.texto, gpx, 'el texto del GPX debe ser idéntico byte a byte');
  assert.equal(back.nombre, 'Mi ruta');
  assert.deepEqual(back.pueblos.n1, { selected: true, choice: 'h1', manual: true, drawing: 'castillo-coca', stageEnd: false });
});

test('se rechaza lo que no es una composición', () => {
  assert.throws(() => checkProject({ a: 1 }));
  assert.throws(() => checkProject({ formato: 'estodobajada-arte/composicion', formato_version: 1, gpx: {} }));
});

test('las decisiones guardadas se aplican y las que ya no existen vuelven a automático', () => {
  const towns = [
    { id: 'a', heritage: [{ id: 'h1' }], catalog: null, choice: 'h1' },
    { id: 'b', heritage: [], catalog: null, choice: 'none' },
    { id: 'c', heritage: [], catalog: null, choice: 'none' },
  ];
  const n = applyTownState(towns, { a: { choice: 'h1', drawing: 'img:monumentos/x.png', selected: false }, b: { choice: 'h9', manual: true }, x: { selected: true } });
  assert.equal(n, 2);
  assert.equal(towns[0].drawing, 'img:monumentos/x.png');
  assert.equal(towns[0].selected, false);
  assert.equal(towns[1].choice, null);
  assert.equal(towns[1].manual, false);
  assert.equal(towns[2].choice, 'none');
});

import { pickerSections } from '../app/js/picker.js';
test('selector: las acuarelas de otros pueblos se encuentran y «oña» no encuentra «monasterio»', () => {
  const town = { name: 'Mérida', lat: 38.92, lon: -6.34, catalog: null };
  const images = [{ path: 'monumentos/ona.png', monumento: 'Monasterio de San Salvador de Oña', poblacion: 'Oña', tipo: 'monasterio', lat: 42.73, lon: -3.41, ia: true }];
  const r = pickerSections(town, { metas: [], typologies: ['monasterio', 'iglesia'], kindLabel: { monasterio: 'Monasterio', iglesia: 'Iglesia' }, kind: 'iglesia', query: 'oña', images });
  assert.deepEqual(r[0].items.map((i) => i.id), ['img:monumentos/ona.png']);
  const sinBuscar = pickerSections(town, { metas: [], typologies: ['iglesia'], kindLabel: {}, kind: 'iglesia', query: '', images });
  assert.ok(sinBuscar.some((s) => s.items.some((i) => i.id === 'img:monumentos/ona.png')));
  const acuarelas = pickerSections(town, { metas: [], typologies: [], kindLabel: {}, kind: 'iglesia', query: 'acuarela', images });
  assert.equal(acuarelas[0].items.length, 1);
});

import { filterProjects } from '../app/js/projects.js';
test('galería: buscar sin tildes y ordenar composiciones', () => {
  const l = [
    { id: 'a', nombre: 'Pedrosa a Espinosa', guardado: '2026-11-08T10:00:00Z', gpx: 'p.gpx' },
    { id: 'b', nombre: 'Arévalo circular', guardado: '2026-11-09T10:00:00Z', gpx: 'Arevalo.gpx' },
    { id: 'c', nombre: 'Etapa 10', guardado: '2026-11-07T10:00:00Z' },
    { id: 'd', nombre: 'Etapa 9', guardado: '2026-11-06T10:00:00Z' },
  ];
  assert.deepEqual(filterProjects(l).map((x) => x.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(filterProjects(l, '', 'antiguas').map((x) => x.id), ['d', 'c', 'a', 'b']);
  assert.deepEqual(filterProjects(l, '', 'nombre').map((x) => x.id), ['b', 'd', 'c', 'a']);
  assert.deepEqual(filterProjects(l, 'arevalo').map((x) => x.id), ['b']);
  assert.deepEqual(filterProjects(l, 'p.gpx').map((x) => x.id), ['a']);
  assert.equal(filterProjects(l, 'etapa nada').length, 0);
  const p = snapshot({ nombre: 'x', raw: gpx, miniatura: 'data:image/jpeg;base64,AA', appVersion: 'x' });
  assert.equal(checkProject(JSON.parse(JSON.stringify(p))).miniatura, 'data:image/jpeg;base64,AA');
});

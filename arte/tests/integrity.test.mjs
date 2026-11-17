// node --test tests/  — comprueba que el GPX se conserva íntegro en el SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGPX, countPoints, canonicalString, rawCanonicalString } from '../app/js/gpx.js';
import { renderMap } from '../app/js/render.js';
import { validate, extractRoutePaths, parsePathD } from '../app/js/integrity.js';
import { classify } from '../app/js/osm.js';
import { buildTowns, chosenMonument } from '../app/js/heritage.js';
import { profileOf } from '../app/js/geo.js';

const raw = fs.readFileSync(new URL('../app/samples/Arevalo_circular.gpx', import.meta.url), 'utf8');
const catalog = JSON.parse(fs.readFileSync(new URL('../app/data/catalogo-patrimonio.json', import.meta.url), 'utf8')).entradas;
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/overpass-arevalo.json', import.meta.url), 'utf8'));

test('lee todos los trkpt del ejemplo en orden', () => {
  const m = parseGPX(raw);
  assert.equal(countPoints(m), (raw.match(/<trkpt\b/g) || []).length);
  assert.equal(canonicalString(m), rawCanonicalString(raw));
});

test('el SVG contiene exactamente los puntos proyectados', async () => {
  const m = parseGPX(raw);
  const osm = classify(fixture.elements);
  const towns = buildTowns(osm, profileOf(m.lines.flatMap((l) => l.segments)), catalog);
  for (const fmt of ['a3v', 'a3h', 'cuadrado', 'panoramico']) {
    const r = renderMap(m, { osm, towns, opts: { format: fmt } });
    const rep = await validate(m, raw, r.svg, r.projection);
    assert.ok(rep.ok, fmt + ': ' + JSON.stringify(rep.checks.filter((c) => !c.ok)));
  }
});

const multi = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Dos tramos</name>
<trkseg><trkpt lat="41.0" lon="-4.0"><ele>800</ele></trkpt><trkpt lon="-4.01" lat="41.01"/><trkpt lat='41.02' lon='-4.0'/></trkseg>
<trkseg><trkpt lat="41.5" lon="-4.5"/><trkpt lat="41.51" lon="-4.49"/></trkseg></trk>
<trk><name>Variante</name><trkseg><trkpt lat="41.2" lon="-4.2"/><trkpt lat="41.21" lon="-4.2"/></trkseg></trk>
<rte><name>Ruta</name><rtept lat="41.3" lon="-4.3"/><rtept lat="41.31" lon="-4.31"/></rte></gpx>`;

test('segmentos, tracks y rutas independientes no se unen', async () => {
  const m = parseGPX(multi);
  assert.equal(countPoints(m), 9);
  const r = renderMap(m, { osm: null, towns: [], opts: {} });
  const paths = extractRoutePaths(r.svg);
  assert.equal(paths.length, 4);
  assert.deepEqual(paths.map((p) => parsePathD(p.d).pts.length), [3, 2, 2, 2]);
  paths.forEach((p) => assert.equal(parsePathD(p.d).moves, 1));
  const rep = await validate(m, multi, r.svg, r.projection);
  assert.ok(rep.ok, JSON.stringify(rep.checks));
});

test('detecta un SVG manipulado (punto movido o eliminado)', async () => {
  const m = parseGPX(raw);
  const r = renderMap(m, { osm: null, towns: [], opts: {} });
  const moved = r.svg.replace(/(data-ruta-seg="0" d="M[\d.]+ [\d.]+L)([\d.]+)/, (_, a, x) => a + (Number(x) + 2).toFixed(3));
  assert.equal((await validate(m, raw, moved, r.projection)).ok, false);
  const dropped = r.svg.replace(/(data-ruta-seg="0" d="M[\d.]+ [\d.]+)L[\d.]+ [\d.]+/, '$1');
  assert.equal((await validate(m, raw, dropped, r.projection)).ok, false);
});

test('monumentos: cada uno en su pueblo, sin asignaciones por cercanía', () => {
  const m = parseGPX(raw);
  const osm = classify(fixture.elements);
  const towns = buildTowns(osm, profileOf(m.lines.flatMap((l) => l.segments)), catalog);
  const get = (n) => chosenMonument(towns.find((t) => t.name === n));
  assert.equal(get('Arévalo').name, 'Castillo de Arévalo');
  assert.equal(get('Coca').name, 'Castillo de Coca');
  assert.equal(get('Medina del Campo').name, 'Castillo de la Mota');
  assert.equal(get('Madrigal de las Altas Torres').illustration, 'murallas-madrigal');
  assert.equal(get('Olmedo').name, 'Arco de San Miguel (murallas de Olmedo)');
  // la posición viene de OSM cuando el elemento existe
  assert.equal(towns.find((t) => t.name === 'Coca').catalog.positionSource, 'OSM');
  // la iglesia de Arévalo no se asigna a otro pueblo
  for (const t of towns) if (t.name !== 'Arévalo') assert.ok(!t.heritage.some((h) => h.name === 'Iglesia de San Martín'));
});

test('rechaza ficheros que no son GPX', () => {
  assert.throws(() => parseGPX('<kml></kml>'));
  assert.throws(() => parseGPX('<gpx><trk><trkseg><trkpt lat="x" lon="1"/></trkseg></trk></gpx>'));
});

test('guía ilustrada: las etapas son subsecuencias exactas del GPX', async () => {
  const { autoStageEnds } = await import('../app/js/guide.js');
  const m = parseGPX(raw);
  const osm = classify(fixture.elements);
  const prof = profileOf(m.lines.flatMap((l) => l.segments));
  const towns = buildTowns(osm, prof, catalog);
  const ends = autoStageEnds(towns, prof.total, 3);
  for (const t of towns) t.stageEnd = ends.has(t.id);
  for (const style of ['acuarela', 'tinta', 'sepia', 'cuaderno']) {
    const r = renderMap(m, { osm, towns, opts: { layout: 'guia', style, campina: true, format: 'cuadrado' } });
    assert.equal(r.stages.length, 3);
    const rep = await validate(m, raw, r.svg, r.projection);
    assert.ok(rep.checks.some((c) => c.id === 'stages'));
    assert.ok(rep.ok, style + ': ' + JSON.stringify(rep.checks.filter((c) => !c.ok)));
  }
});

test('agua: une multipolígonos en anillos y los dibuja sin tocar la ruta', async () => {
  const osm = classify(fixture.elements);
  const emb = osm.waters.find((w) => w.name === 'Embalse (prueba)');
  assert.equal(emb.rings.length, 2);                       // exterior unido + isla
  const o = emb.rings[0];
  assert.deepEqual(o[0], o[o.length - 1]);                 // anillo cerrado
  assert.equal(osm.wetlands.length, 1);
  assert.ok(osm.rivers.some((r) => r.kind === 'stream'));
  const m = parseGPX(raw);
  const towns = buildTowns(osm, profileOf(m.lines.flatMap((l) => l.segments)), catalog);
  const r = renderMap(m, { osm, towns, opts: {} });
  assert.match(r.svg, /id="capa-agua"/);
  assert.match(r.svg, /id="capa-humedales"/);
  assert.ok((await validate(m, raw, r.svg, r.projection)).ok);
});

test('imagen propia del catálogo y dibujo propio de Toledo', async () => {
  const { monumentDrawing, hasSpecific } = await import('../app/js/illustrations.js');
  assert.ok(hasSpecific('catedral-toledo'));
  const dT = monumentDrawing('catedral-toledo', 'catedral', 1);
  assert.ok(dT.h > 100 && dT.body.length > 1000);
  const m = parseGPX(raw);
  const osm = classify(fixture.elements);
  const cat = catalog.map((c) => (c.id === 'coca-castillo' ? { ...c, imagen: 'monumentos/coca.png' } : c));
  const towns = buildTowns(osm, profileOf(m.lines.flatMap((l) => l.segments)), cat);
  const images = { 'monumentos/coca.png': { href: 'data/monumentos/coca.png', w: 400, h: 300 } };
  const r = renderMap(m, { osm, towns, opts: {}, images });
  assert.match(r.svg, /<image href="data\/monumentos\/coca.png"/);
  assert.equal(r.monuments.find((x) => x.town === 'Coca').image, 'monumentos/coca.png');
  // sin la imagen cargada vuelve al dibujo
  const r2 = renderMap(m, { osm, towns, opts: {} });
  assert.doesNotMatch(r2.svg, /<image /);
  assert.ok((await validate(m, raw, r.svg, r.projection)).ok);
});

test('patrimonio en el campo junto a la ruta (villa romana de Almenara-Puras)', () => {
  const m = parseGPX(raw);
  const osm = classify(fixture.elements);
  const towns = buildTowns(osm, profileOf(m.lines.flatMap((l) => l.segments)), catalog);
  const loose = towns.filter((t) => t.place === 'poi');
  assert.equal(loose.length, 1, loose.map((t) => t.name).join(', '));   // museo + yacimiento = un solo sitio
  const v = loose[0];
  assert.equal(v.choice, 'cat');
  assert.equal(v.label, 'Villa romana de Almenara-Puras');
  assert.ok(v.selected && v.dist < 800);
  assert.equal(chosenMonument(v).illustration, 'villa-romana');
  // los pueblos cercanos no se quedan con la villa
  for (const n of ['Almenara de Adaja', 'Puras']) assert.ok(!towns.find((t) => t.name === n).heritage.some((h) => /villa/i.test(h.name)));
});

test('sin duplicados: pueblo repetido en OSM y monumento como nodo y polígono', async () => {
  const els = [
    { type: 'node', id: 1, lat: 42.33, lon: -3.66, tags: { place: 'village', name: 'Vivar del Cid' } },
    { type: 'node', id: 2, lat: 42.335, lon: -3.664, tags: { place: 'hamlet', name: 'Vivar del Cid' } },
    { type: 'node', id: 3, lat: 42.331, lon: -3.661, tags: { amenity: 'place_of_worship', name: 'Monasterio de Nuestra Señora del Espino', historic: 'monastery' } },
    { type: 'way', id: 4, center: { lat: 42.3312, lon: -3.6612 }, tags: { historic: 'monastery', name: 'Monasterio de Nuestra Señora del Espino', heritage: '2' } },
  ];
  const osm = classify(els);
  assert.equal(osm.places.length, 1);
  assert.equal(osm.places[0].place, 'village');
  assert.equal(osm.heritage.length, 1);
  assert.equal(osm.heritage[0].id, 'w4');
});

test('SHA-256 propio igual al nativo (http sin contexto seguro)', async () => {
  const { sha256js } = await import('../app/js/gpx.js');
  const { createHash } = await import('node:crypto');
  for (const t of ['', 'abc', 'x'.repeat(55), 'x'.repeat(64), raw]) assert.equal(sha256js(new TextEncoder().encode(t)), createHash('sha256').update(t).digest('hex'));
});

test('petición de dibujo: URL de issue con etiqueta y datos del monumento', async () => {
  const { requestUrl, osmUrl } = await import('../app/js/request.js');
  const m = parseGPX(raw);
  const osm = classify(fixture.elements);
  const towns = buildTowns(osm, profileOf(m.lines.flatMap((l) => l.segments)), catalog);
  const coca = towns.find((t) => t.name === 'Coca');
  const u = new URL(requestUrl(coca, 'Arévalo circular'));
  assert.equal(u.pathname, '/MelAnubis/estodobajada-arte/issues/new');
  assert.equal(u.searchParams.get('labels'), 'dibujo');
  assert.equal(u.searchParams.get('title'), 'Dibujo: Castillo de Coca (Coca)');
  const body = u.searchParams.get('body');
  assert.match(body, /openstreetmap\.org\/node\//);
  const data = JSON.parse(body.match(/<!-- datos-peticion (.*) -->/)[1]);
  assert.equal(data[0].poblacion, 'Coca');
  assert.equal(osmUrl('w12'), 'https://www.openstreetmap.org/way/12');
  const many = new URL(requestUrl(towns.filter((t) => t.selected), 'Arévalo circular'));
  assert.match(many.searchParams.get('title'), /^Dibujos: \d+ monumentos/);
  assert.ok(many.toString().length < 8000);
});

test('versión única: version.js, package.json, CHANGELOG y SVG', async () => {
  const { VERSION } = await import('../app/js/version.js');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, VERSION);
  assert.match(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), new RegExp(`## \\[?v?${VERSION.replace(/\./g, '\\.')}`));
  const r = renderMap(parseGPX(raw), { osm: null, towns: [], opts: {} });
  assert.match(r.svg, new RegExp(`data-version="${VERSION}"`));
});

test('perfil: los nombres no se pisan (horizontal si caben, vertical repartido si no)', async () => {
  const { layoutProfileLabels } = await import('../app/js/render.js');
  const few = layoutProfileLabels([{ text: 'Arévalo', x: 100, prio: 3 }, { text: 'Olmedo', x: 400, prio: 3 }], { x0: 80, x1: 900, fs: 13 });
  assert.equal(few.mode, 'horizontal');
  const names = ['Arévalo', 'Sinlabajos', 'Constanzana', 'Blasconuño', 'Fuente el Sauz', 'Rubí de Bracamonte', 'Medina del Campo', 'Moraleja', 'La Zarza', 'Pozal de Gallinas', 'Olmedo', 'Bocigas', 'Almenara', 'Villeguillo', 'Puras', 'Llano de Olmedo', 'Villagonzalo', 'Coca'];
  const xs = [85, 170, 305, 335, 400, 437, 530, 610, 650, 690, 730, 795, 806, 822, 845, 860, 912, 960];
  const many = layoutProfileLabels(names.map((t, i) => ({ text: t, x: xs[i], prio: i % 3 })), { x0: 80, x1: 1190, fs: 13 });
  assert.equal(many.mode, 'vertical');
  const lx = many.placed.map((p) => p.lx);
  for (let i = 1; i < lx.length; i++) assert.ok(lx[i] - lx[i - 1] >= 13 * 1.05 - 1e-6, `${many.placed[i].text} pisa a ${many.placed[i - 1].text}`);
  assert.ok(lx[0] >= 80 && lx[lx.length - 1] <= 1190);
  assert.equal(many.dropped, 0);
  // en un perfil estrecho se quedan los importantes
  const narrow = layoutProfileLabels(names.map((t, i) => ({ text: t, x: 80 + i * 6, prio: t === 'Medina del Campo' ? 9 : 1 })), { x0: 80, x1: 180, fs: 13 });
  assert.ok(narrow.dropped > 0 && narrow.placed.some((p) => p.text === 'Medina del Campo'));
});

test('dibujos propios: se cargan de data/dibujos y el índice cuadra con el catálogo', async () => {
  const { allDrawingMeta, hasSpecific, monumentDrawing, TYPOLOGICAL_IDS } = await import('../app/js/illustrations.js');
  const metas = allDrawingMeta();
  assert.ok(metas.length >= 13);
  for (const m of metas) {
    const d = monumentDrawing(m.id, m.tipo || 'castillo', 3);
    assert.ok(d.body.length > 200 && d.w > 0 && d.h > 0, m.id);
  }
  for (const e of catalog) if (e.ilustracion && !TYPOLOGICAL_IDS.includes(e.ilustracion)) assert.ok(hasSpecific(e.ilustracion), `falta el dibujo «${e.ilustracion}» de ${e.id}`);
});

test('selector de dibujo: sugiere primero los del pueblo, luego mismo tipo cercano, y busca', async () => {
  const { pickerSections } = await import('../app/js/picker.js');
  const { allDrawingMeta, TYPOLOGICAL_IDS } = await import('../app/js/illustrations.js');
  const { KIND_LABEL } = await import('../app/js/osm.js');
  const metas = allDrawingMeta();
  const arevalo = { name: 'Arévalo', lat: 41.0626, lon: -4.7206, catalog: { ilustracion: 'castillo-arevalo' }, heritage: [] };
  const secs = pickerSections(arevalo, { metas, typologies: TYPOLOGICAL_IDS, kindLabel: KIND_LABEL, kind: 'castillo' });
  assert.equal(secs[0].title, 'Para Arévalo');
  assert.ok(secs[0].items.some((i) => i.id === 'castillo-arevalo'));
  const same = secs.find((x) => /mismo tipo/.test(x.title));
  assert.equal(same.items[0].id, 'castillo-coca', 'el castillo más cercano primero');
  assert.ok(same.items.every((i, k, a) => k === 0 || a[k - 1].d <= i.d));
  const gen = secs.find((x) => x.title === 'Genéricos');
  assert.equal(gen.items[0].id, 'castillo');
  const found = pickerSections(arevalo, { metas, typologies: TYPOLOGICAL_IDS, kindLabel: KIND_LABEL, kind: 'castillo', query: 'toledo' });
  assert.deepEqual(found[0].items.map((i) => i.id), ['catedral-toledo']);
  const cat = pickerSections(arevalo, { metas, typologies: TYPOLOGICAL_IDS, kindLabel: KIND_LABEL, kind: 'castillo', query: 'catedral' });
  assert.ok(cat[0].items.some((i) => i.id === 'catedral') && cat[0].items.some((i) => i.id === 'catedral-toledo'));
});

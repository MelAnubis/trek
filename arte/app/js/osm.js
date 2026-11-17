// Datos reales de OpenStreetMap (Overpass API). Solo se leen; no se inventa nada.
import { haversine, normalizeName } from './geo.js';

const ENDPOINTS = [
  './api/overpass',                              // proxy nginx del contenedor (con caché)
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const cache = new Map();

export function buildQuery(b) {
  const bb = `${b.minLat.toFixed(5)},${b.minLon.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLon.toFixed(5)}`;
  // la costa se pide con mucho margen: para cerrar el mar hace falta que cruce el recuadro entero
  const dLat = 0.3, dLon = 0.4;
  const big = `${(b.minLat - dLat).toFixed(5)},${(b.minLon - dLon).toFixed(5)},${(b.maxLat + dLat).toFixed(5)},${(b.maxLon + dLon).toFixed(5)}`;
  return `[out:json][timeout:120];
way["natural"="coastline"](${big});
out geom;
node["place"~"^(sea|ocean)$"]["name"](${big});
out body;
node["natural"="bay"]["name"](${bb});
out body;
node["place"~"^(city|town|village|hamlet)$"](${bb});
out body;
(
  nwr["historic"~"^(castle|city_gate|citywalls|monastery|church|tower|fort|palace|manor|ruins|monument|archaeological_site|bridge|aqueduct|chapel)$"]["name"](${bb});
  nwr["heritage"]["name"](${bb});
  nwr["building"~"^(cathedral|church|chapel)$"]["name"](${bb});
  nwr["amenity"="place_of_worship"]["name"](${bb});
  nwr["man_made"="bridge"]["historic"](${bb});
  nwr["tourism"="museum"]["name"](${bb});
);
out tags center;
way["waterway"~"^(river|canal|stream)$"](${bb});
out geom;
(
  nwr["natural"="water"](${bb});
  nwr["landuse"~"^(reservoir|basin)$"](${bb});
  nwr["natural"="wetland"](${bb});
);
out geom;
way["landuse"="residential"](${bb});
out geom;
(
  way["natural"="wood"](${bb});
  way["landuse"="forest"](${bb});
);
out geom;
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});
out geom;
way["railway"="rail"](${bb});
out geom;
(
  node["natural"="peak"](${bb});
  node["mountain_pass"="yes"](${bb});
  node["natural"="saddle"]["name"](${bb});
);
out body;`;
}

export async function fetchOSM(bbox, { signal, onStatus } = {}) {
  const query = buildQuery(bbox);
  if (cache.has(query)) return cache.get(query);
  let lastErr = null;
  for (const url of ENDPOINTS) {
    try {
      onStatus && onStatus(`Consultando OpenStreetMap (${url.startsWith('.') ? 'servidor local' : new URL(url).host})…`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: 'data=' + encodeURIComponent(query),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.elements)) throw new Error('Respuesta no válida');
      const data = classify(json.elements);
      data.source = url;
      data.timestamp = json.osm3s && json.osm3s.timestamp_osm_base;
      cache.set(query, data);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw new Error('No se pudo consultar OpenStreetMap: ' + (lastErr ? lastErr.message : 'sin respuesta'));
}

function centerOf(el) {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  if (el.geometry && el.geometry.length) {
    const g = el.geometry;
    return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
  }
  return null;
}

export const KIND_LABEL = {
  castillo: 'Castillo', muralla: 'Murallas', puerta: 'Puerta / arco', acueducto: 'Acueducto',
  catedral: 'Catedral', monasterio: 'Monasterio', palacio: 'Palacio', iglesia: 'Iglesia',
  torre: 'Torre', puente: 'Puente', ermita: 'Ermita', ruinas: 'Ruinas', monumento: 'Monumento',
  yacimiento: 'Yacimiento', museo: 'Museo',
};

export function heritageKind(t) {
  const h = t.historic, b = t.building, name = (t.name || '').toLowerCase();
  if (h === 'aqueduct' || /acueducto/.test(name)) return 'acueducto';
  if (h === 'castle' || h === 'fort') {
    if (t.castle_type === 'palace' || t.castle_type === 'manor' || t.castle_type === 'stately') return 'palacio';
    return 'castillo';
  }
  if (h === 'citywalls' || /^muralla/.test(name)) return 'muralla';
  if (h === 'city_gate' || /^(arco|puerta) /.test(name)) return 'puerta';
  if (b === 'cathedral' || /catedral/.test(name)) return 'catedral';
  if (h === 'monastery' || /monasterio|convento/.test(name)) return 'monasterio';
  if (/ermita/.test(name) || b === 'chapel' || h === 'chapel') return 'ermita';
  if (h === 'church' || b === 'church' || t.amenity === 'place_of_worship' || /iglesia|parroquia|colegiata/.test(name)) return 'iglesia';
  if (h === 'palace' || h === 'manor' || /palacio/.test(name)) return 'palacio';
  if (h === 'tower' || /^torre/.test(name)) return 'torre';
  if (h === 'bridge' || /^puente/.test(name)) return 'puente';
  if (h === 'ruins') return 'ruinas';
  if (h === 'archaeological_site') return 'yacimiento';
  if (t.tourism === 'museum') return 'museo';
  if (h === 'monument') return 'monumento';
  return null;
}

const KIND_SCORE = {
  castillo: 100, acueducto: 95, catedral: 90, muralla: 85, puerta: 78, monasterio: 75,
  palacio: 62, torre: 58, iglesia: 50, puente: 48, museo: 42, ermita: 32, ruinas: 30, yacimiento: 30, monumento: 18,
};

export function heritageScore(h) {
  let s = KIND_SCORE[h.kind] || 0;
  const t = h.tags;
  if (t.heritage) s += 18;                    // Bien de Interés Cultural u otra protección
  if (t['heritage:operator'] || t['ref:bic'] || t['ref:es:bic']) s += 6;
  if (t.wikidata) s += 10;
  if (t.wikipedia) s += 6;
  if (t.historic && h.kind === 'iglesia') s += 6;
  if (t.ruins === 'yes' && h.kind === 'castillo') s -= 8;
  return s;
}

export function classify(elements) {
  const places = [], heritage = [], rivers = [], woods = [], roads = [], rails = [], peaks = [], passes = [], waters = [], wetlands = [], urban = [];
  const coast = [], seaNames = [];
  const seenHeritage = new Set();
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node' && t.place && /^(city|town|village|hamlet)$/.test(t.place) && t.name) {
      places.push({ id: `n${el.id}`, name: t.name, place: t.place, population: Number(t.population) || null, lat: el.lat, lon: el.lon, tags: t });
      continue;
    }
    // puertos de montaña y collados con nombre
    if (el.type === 'node' && (t.mountain_pass === 'yes' || t.natural === 'saddle')) {
      passes.push({ id: `n${el.id}`, name: t.name || null, ele: Number(t.ele) || null, lat: el.lat, lon: el.lon });
      continue;
    }
    if (el.type === 'way' && t.natural === 'coastline' && el.geometry) {
      coast.push(el.geometry.map((g) => [g.lat, g.lon]));
      continue;
    }
    if (el.type === 'node' && t.name && (t.place === 'sea' || t.place === 'ocean' || t.natural === 'bay')) {
      seaNames.push({ name: t.name, kind: t.place || 'bay', lat: el.lat, lon: el.lon });
      continue;
    }
    if (el.type === 'node' && t.natural === 'peak') {
      peaks.push({ id: `n${el.id}`, name: t.name || null, ele: Number(t.ele) || null, lat: el.lat, lon: el.lon });
      continue;
    }
    const isWater = t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin';
    if ((isWater || t.natural === 'wetland') && (el.type === 'way' || el.type === 'relation')) {
      const rings = el.type === 'way' ? (el.geometry ? [el.geometry.map((g) => [g.lat, g.lon])] : []) : relationRings(el);
      if (rings.length) {
        const item = { id: `${el.type[0]}${el.id}`, name: t.name || null, kind: t.water || t.landuse || t.wetland || t.natural, rings };
        (isWater ? waters : wetlands).push(item);
      }
      continue;
    }
    if (el.type === 'way' && t.landuse === 'residential' && el.geometry) {
      urban.push({ id: `w${el.id}`, coords: el.geometry.map((g) => [g.lat, g.lon]) });
      continue;
    }
    if (el.type === 'way' && t.waterway && el.geometry) {
      rivers.push({ id: `w${el.id}`, name: t.name || null, kind: t.waterway, coords: el.geometry.map((g) => [g.lat, g.lon]) });
      continue;
    }
    if (el.type === 'way' && (t.natural === 'wood' || t.landuse === 'forest') && el.geometry) {
      woods.push({ id: `w${el.id}`, leaf: t.leaf_type || null, coords: el.geometry.map((g) => [g.lat, g.lon]) });
      continue;
    }
    if (el.type === 'way' && t.highway && el.geometry) {
      roads.push({ id: `w${el.id}`, ref: t.ref || null, kind: t.highway, coords: el.geometry.map((g) => [g.lat, g.lon]) });
      continue;
    }
    if (el.type === 'way' && t.railway === 'rail' && el.geometry) {
      rails.push({ id: `w${el.id}`, coords: el.geometry.map((g) => [g.lat, g.lon]) });
      continue;
    }
    if (t.name) {
      const kind = heritageKind(t);
      const c = centerOf(el);
      const key = `${el.type[0]}${el.id}`;
      if (kind && c && !seenHeritage.has(key)) {
        seenHeritage.add(key);
        const h = { id: key, name: t.name, kind, lat: c.lat, lon: c.lon, tags: t, wikidata: t.wikidata || null, wikipedia: t.wikipedia || null };
        h.score = heritageScore(h);
        heritage.push(h);
      }
    }
  }
  return { places: dedupePlaces(places), heritage: dedupeHeritage(heritage), rivers, woods, roads, rails, peaks, passes, waters, wetlands, urban, coast, seaNames };
}

/**
 * Une los tramos de un multipolígono en anillos cerrados (exteriores e interiores).
 * Devuelve [[lat,lon]…] por anillo; el render los pinta con evenodd para respetar islas.
 */
export function relationRings(rel) {
  const parts = (rel.members || []).filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const rings = [];
  while (parts.length) {
    let ring = parts.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], end = ring[ring.length - 1];
        if (same(p[0], end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) ring = ring.concat(p.slice(0, -1).reverse());
        else if (same(p[p.length - 1], ring[0])) ring = p.concat(ring.slice(1));
        else if (same(p[0], ring[0])) ring = p.slice().reverse().concat(ring.slice(1));
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

const PLACE_RANK = { city: 4, town: 3, village: 2, hamlet: 1 };

/** Un mismo pueblo puede estar en OSM varias veces (villa + aldea, nodo duplicado): se queda uno. */
export function dedupePlaces(places) {
  const out = [];
  const sorted = places.slice().sort((a, b) => (PLACE_RANK[b.place] - PLACE_RANK[a.place]) || ((b.population || 0) - (a.population || 0)));
  for (const p of sorted) {
    const n = normalizeName(p.name);
    if (out.some((o) => normalizeName(o.name) === n && haversine(o, p) < 3000)) continue;
    out.push(p);
  }
  return out;
}

/** El mismo monumento a menudo es nodo y polígono a la vez: se queda el de más información. */
export function dedupeHeritage(list) {
  const out = [];
  for (const h of list.slice().sort((a, b) => b.score - a.score || (b.id[0] === 'w') - (a.id[0] === 'w'))) {
    const n = normalizeName(h.name);
    if (out.some((o) => normalizeName(o.name) === n && haversine(o, h) < 500)) continue;
    out.push(h);
  }
  return out;
}

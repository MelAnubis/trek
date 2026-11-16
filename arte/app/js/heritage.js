// Poblaciones próximas a la ruta y su patrimonio característico.
// Regla: un monumento solo se asigna a la población donde realmente está.
import { haversine, nearestOnRoute, normalizeName, pointInPolygon } from './geo.js';

// Radio dentro del cual un elemento patrimonial pertenece al núcleo urbano.
// Si OSM tiene el casco (landuse=residential), manda el polígono; si no, estos radios.
const URBAN_RADIUS = { city: 3000, town: 1600, village: 800, hamlet: 400 };
// Distancia máxima a la ruta para considerar la población «relevante» por defecto.
const ROUTE_NEAR = { city: 3500, town: 2500, village: 1500, hamlet: 400 };
const LIST_MAX = 6000;
const RANK = { city: 4, town: 3, village: 2, hamlet: 1 };
// Patrimonio en el campo (villas, ermitas, yacimientos, museos fuera de un casco):
const LOOSE_ROUTE_MAX = 1500;   // distancia máxima a la ruta para listarlo
const LOOSE_MIN_SCORE = 40;     // relevancia mínima (evita cruceros, fuentes, etc.)

export function matchCatalog(place, catalog) {
  const n = normalizeName(place.name);
  return (catalog || []).find((c) => !c.suelto && normalizeName(c.poblacion) === n &&
    haversine(place, { lat: c.lat, lon: c.lon }) <= (c.radio_km || 6) * 1000) || null;
}

/**
 * @returns lista de poblaciones con:
 *  dist (m a la ruta), along (m recorridos), heritage[] (candidatos ordenados),
 *  catalog (entrada curada o null), choice (clave del monumento elegido), selected
 */
export function buildTowns(osm, profile, catalog) {
  const places = osm.places.slice();

  // 1) asignar cada elemento patrimonial a la población más cercana (si cae dentro de su radio)
  const byPlace = new Map(places.map((p) => [p.id, []]));
  const unassigned = [];
  const urban = (osm.urban || []).map((u) => u.coords.map(([la, lo]) => [lo, la]));
  const inUrban = (h) => urban.some((poly) => pointInPolygon(h.lon, h.lat, poly));
  for (const h of osm.heritage) {
    let best = null, bestD = Infinity;
    const urbanHit = inUrban(h);
    for (const p of places) {
      const d = haversine(p, h);
      // dentro de un casco real: se admite hasta el doble de radio; fuera de cualquier casco, el radio estricto
      const r = (URBAN_RADIUS[p.place] || 800) * (urbanHit ? 2 : 1);
      // prioriza el núcleo mayor cuando dos radios se solapan
      const w = d / r - RANK[p.place] * 0.05;
      if (d <= r && w < bestD) { bestD = w; best = p; }
    }
    if (best) byPlace.get(best.id).push({ ...h, distToTown: haversine(best, h) });
    else unassigned.push(h);
  }

  const towns = [];
  for (const p of places) {
    const near = nearestOnRoute(profile, p.lat, p.lon);
    if (near.dist > LIST_MAX) continue;
    // candidatos sin duplicados por nombre, mejor puntuación primero
    const seen = new Set();
    const heritage = byPlace.get(p.id)
      .sort((a, b) => b.score - a.score || a.distToTown - b.distToTown)
      .filter((h) => { const k = normalizeName(h.name); if (seen.has(k)) return false; seen.add(k); return true; });

    const cat = matchCatalog(p, catalog);
    let catalogEntry = null;
    if (cat) {
      const patterns = (cat.buscar_osm || []).map(normalizeName);
      let osmHit = null;
      for (const pat of patterns) {
        osmHit = heritage.find((h) => normalizeName(h.name).includes(pat) && (h.kind === cat.tipo || pat.length > 8));
        if (osmHit) break;
      }
      catalogEntry = {
        ...cat,
        osmId: osmHit ? osmHit.id : null,
        lat: osmHit ? osmHit.lat : p.lat,
        lon: osmHit ? osmHit.lon : p.lon,
        positionSource: osmHit ? 'OSM' : 'centro urbano',
      };
    }

    const rel = near.dist <= (ROUTE_NEAR[p.place] || 1000);
    let choice = 'none';
    if (catalogEntry) choice = 'cat';
    else if (heritage.length && heritage[0].score >= 50) choice = heritage[0].id;

    towns.push({
      id: p.id, name: p.name, place: p.place, population: p.population,
      lat: p.lat, lon: p.lon,
      dist: near.dist, along: near.along, crossed: near.dist < 450,
      heritage, catalog: catalogEntry, choice,
      selected: rel && (p.place !== 'hamlet' || near.dist < 250),
      label: p.name,
    });
  }
  // 2) patrimonio fuera de los cascos pero junto a la ruta: entradas propias
  const seenLoose = new Set(), usedCat = new Set(), looseAdded = [];
  const inCat = (h) => (catalog || []).some((c) => c.suelto && (c.buscar_osm || []).some((pat) => normalizeName(h.name).includes(normalizeName(pat))));
  for (const h of unassigned.sort((a, b) => (inCat(b) - inCat(a)) || b.score - a.score)) {
    const key = normalizeName(h.name);
    if (seenLoose.has(key)) continue;
    const near = nearestOnRoute(profile, h.lat, h.lon);
    const cat = (catalog || []).find((c) => c.suelto && haversine(h, { lat: c.lat, lon: c.lon }) <= (c.radio_km || 3) * 1000 &&
      (c.buscar_osm || []).some((pat) => normalizeName(h.name).includes(normalizeName(pat))));
    if (near.dist > LOOSE_ROUTE_MAX || (h.score < LOOSE_MIN_SCORE && !cat)) continue;
    // un mismo sitio suele estar en OSM dos veces (museo + yacimiento): se queda el más relevante
    if (cat && usedCat.has(cat.id)) continue;
    if (looseAdded.some((o) => haversine(o, h) < 400)) continue;
    seenLoose.add(key);
    if (cat) usedCat.add(cat.id);
    looseAdded.push(h);
    let closest = null, cd = Infinity;
    for (const p of places) { const d = haversine(p, h); if (d < cd) { cd = d; closest = p; } }
    towns.push({
      id: 'poi-' + h.id, name: cat ? cat.monumento : h.name, place: 'poi', population: null,
      lat: h.lat, lon: h.lon,
      dist: near.dist, along: near.along, crossed: near.dist < 450,
      heritage: [{ ...h, distToTown: 0 }],
      catalog: cat ? { ...cat, osmId: h.id, lat: h.lat, lon: h.lon, positionSource: 'OSM' } : null,
      choice: cat ? 'cat' : h.id,
      selected: near.dist <= 800,
      label: cat ? (cat.rotulo || cat.monumento) : h.name,
      nearTown: closest ? `${closest.name} (${(cd / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km)` : null,
    });
  }
  towns.sort((a, b) => a.along - b.along);
  return towns;
}

// Créditos de la foto de referencia de cada acuarela del catálogo (por ruta del PNG), para
// citarla aunque se use en otra población.
const IMAGE_CREDITS = {};
export function setImageCredits(catalog) {
  for (const c of catalog || []) if (c.imagen) IMAGE_CREDITS[c.imagen] = c.ilustracion_ia ? c.ilustracion_ia.referencia || {} : null;
}

/** Monumento efectivo que se dibujará para una población. */
export function chosenMonument(town) {
  const m = baseMonument(town);
  if (m && town.drawing && town.drawing.startsWith('img:')) {
    const path = town.drawing.slice(4);
    return { ...m, image: path, aiCredit: path in IMAGE_CREDITS ? IMAGE_CREDITS[path] : m.aiCredit, overridden: true };
  }
  if (m && town.drawing && town.drawing !== 'auto') return { ...m, illustration: town.drawing, image: null, specific: false, overridden: true };
  return m;
}

/** Elección automática respetando los tipos de patrimonio activados. */
export function autoChoice(town, kinds) {
  const ok = (k) => !kinds || kinds.has(k);
  if (town.catalog && ok(town.catalog.tipo)) return 'cat';
  if (town.place === 'poi') return town.heritage[0] && ok(town.heritage[0].kind) ? town.heritage[0].id : 'none';
  const h = town.heritage.find((x) => ok(x.kind) && x.score >= 45);
  return h ? h.id : 'none';
}

function baseMonument(town) {
  if (town.choice === 'none') return null;
  if (town.choice === 'cat' && town.catalog) {
    return {
      name: town.catalog.monumento, kind: town.catalog.tipo, illustration: town.catalog.ilustracion,
      lat: town.catalog.lat, lon: town.catalog.lon, source: 'catálogo + ' + town.catalog.positionSource,
      specific: !!town.catalog.imagen || !['castillo', 'muralla', 'iglesia', 'monasterio', 'puerta', 'torre', 'palacio', 'puente', 'ermita', 'ruinas', 'acueducto'].includes(town.catalog.ilustracion),
      // ilustración propia en PNG/SVG (app/data/monumentos/…); si no carga, se usa «ilustracion»
      image: town.catalog.imagen || null,
      aiCredit: town.catalog.ilustracion_ia ? town.catalog.ilustracion_ia.referencia || {} : null,
      imageWidth: Number(town.catalog.ancho) || 1,
      blend: town.catalog.mezcla === 'normal' ? 'normal' : 'multiply',
    };
  }
  const h = town.heritage.find((x) => x.id === town.choice);
  if (!h) return null;
  return { name: h.name, kind: h.kind, illustration: h.kind, lat: h.lat, lon: h.lon, source: 'OSM ' + h.id, specific: false, hint: hintFrom(h) };
}

/** Pistas de OSM para elegir la variante del dibujo con fidelidad (material, estilo). */
export function hintFrom(h) {
  const t = h.tags || {};
  const mat = (t['building:material'] || t.material || '').toLowerCase();
  const style = (t['building:architecture'] || t.architecture || '').toLowerCase();
  let material = null;
  if (/brick|ladrillo/.test(mat) || /mud[eé]jar/.test(style) || /mud[eé]jar/i.test(h.name)) material = 'brick';
  else if (/stone|piedra|granit|sandstone|limestone/.test(mat)) material = 'stone';
  return { material, style: style || null };
}

// Utilidades geográficas. La proyección solo transforma para pantalla;
// nunca devuelve ni guarda coordenadas geográficas modificadas.

const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bboxOf(points) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

export function expandBbox(b, meters) {
  const dLat = meters / 111320;
  const midLat = (b.minLat + b.maxLat) / 2;
  const dLon = meters / (111320 * Math.cos(midLat * RAD));
  return { minLat: b.minLat - dLat, maxLat: b.maxLat + dLat, minLon: b.minLon - dLon, maxLon: b.maxLon + dLon };
}

// Web Mercator normalizada (x,y en metros esféricos).
export function mercX(lon) { return R * lon * RAD; }
export function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)); }
export function invMercX(x) { return x / R / RAD; }
export function invMercY(y) { return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / RAD; }

/**
 * Proyección que encaja una caja geográfica en un rectángulo de pantalla
 * con escala uniforme (sin deformar proporciones).
 */
export function makeProjection(bbox, rect) {
  const x0 = mercX(bbox.minLon), x1 = mercX(bbox.maxLon);
  const y0 = mercY(bbox.minLat), y1 = mercY(bbox.maxLat);
  const k = Math.min(rect.w / (x1 - x0), rect.h / (y1 - y0));
  const ox = rect.x + (rect.w - (x1 - x0) * k) / 2;
  const oy = rect.y + (rect.h - (y1 - y0) * k) / 2;
  const project = (lat, lon) => [ox + (mercX(lon) - x0) * k, oy + (y1 - mercY(lat)) * k];
  const invert = (x, y) => ({ lon: invMercX((x - ox) / k + x0), lat: invMercY(y1 - (y - oy) / k) });
  // metros reales por píxel en la latitud media
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const metersPerPx = Math.cos(midLat * RAD) / k;
  return { project, invert, k, metersPerPx, bbox, rect };
}

/** Distancia acumulada a lo largo de cada segmento (no se unen segmentos). */
export function profileOf(segments) {
  const out = [];
  let total = 0;
  segments.forEach((seg, si) => {
    seg.points.forEach((p, j) => {
      if (j > 0) total += haversine(seg.points[j - 1], p);
      out.push({ d: total, ele: p.ele, lat: p.lat, lon: p.lon, si, j });
    });
  });
  return { samples: out, total };
}

export function elevationStats(segments) {
  let up = 0, down = 0, min = Infinity, max = -Infinity, has = false;
  for (const seg of segments) {
    let prev = null;
    for (const p of seg.points) {
      if (p.ele == null) continue;
      has = true;
      if (p.ele < min) min = p.ele;
      if (p.ele > max) max = p.ele;
      if (prev != null) {
        const d = p.ele - prev;
        if (d > 0) up += d; else down -= d;
      }
      prev = p.ele;
    }
  }
  return has ? { up, down, min, max } : null;
}

/**
 * Punto más cercano de la ruta a una posición (lat, lon).
 * Devuelve distancia en metros y km recorridos hasta ese punto.
 */
export function nearestOnRoute(profile, lat, lon) {
  const cosL = Math.cos(lat * RAD);
  let best = { dist: Infinity, d: 0, k: -1 };
  const s = profile.samples;
  for (let k = 0; k < s.length; k++) {
    const dx = (s[k].lon - lon) * cosL * 111320;
    const dy = (s[k].lat - lat) * 111320;
    const dd = dx * dx + dy * dy;
    if (dd < best.dist) best = { dist: dd, d: s[k].d, k };
    // proyección sobre el tramo k→k+1 del mismo segmento
    if (k + 1 < s.length && s[k + 1].si === s[k].si) {
      const ax = (s[k].lon - lon) * cosL * 111320, ay = (s[k].lat - lat) * 111320;
      const bx = (s[k + 1].lon - lon) * cosL * 111320, by = (s[k + 1].lat - lat) * 111320;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2));
        const px = ax + vx * t, py = ay + vy * t;
        const d2 = px * px + py * py;
        if (d2 < best.dist) best = { dist: d2, d: s[k].d + (s[k + 1].d - s[k].d) * t, k };
      }
    }
  }
  return { dist: Math.sqrt(best.dist), along: best.d, k: best.k };
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Generador pseudoaleatorio determinista (mismo GPX → mismo mapa). */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

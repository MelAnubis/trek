// Relieve real a partir de teselas de elevación «Terrarium» (AWS Open Data / Mapzen).
// Se pinta como aguada: sombras de ladera en tonos tierra y un tinte suave por altitud.
// Mismo sistema de proyección que el mapa (Web Mercator), así que encaja sin deformar.

const TILE = 256;
const R = 6378137;
const SOURCES = [
  (z, x, y) => `api/terreno/${z}/${x}/${y}.png`,                                         // proxy del contenedor (caché)
  (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, // directo (CORS abierto)
];

export const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** Terrarium: altura = R·256 + G + B/256 − 32768 (metros). */
export function decodeTerrarium(rgba, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Zoom y rango de teselas que cubren la extensión con ~px píxeles de ancho y como mucho maxTiles. */
export function tileRange(ext, px = 1400, maxTiles = 36) {
  let z = Math.floor(Math.log2(((px / TILE) * 360) / Math.max(1e-6, ext.maxLon - ext.minLon)));
  z = Math.max(5, Math.min(12, z));
  for (;;) {
    const x0 = Math.floor(lon2x(ext.minLon, z)), x1 = Math.floor(lon2x(ext.maxLon, z));
    const y0 = Math.floor(lat2y(ext.maxLat, z)), y1 = Math.floor(lat2y(ext.minLat, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= maxTiles || z <= 5) return { z, x0, x1, y0, y1 };
    z--;
  }
}

/**
 * Sombreado del terreno pintado como acuarela (función pura, se prueba en Node).
 * @param elev alturas (m), fila a fila; w×h
 * @param mpp metros por píxel
 * @returns { rgba: Uint8ClampedArray, min, max }
 */
export function paintRelief(elev, w, h, mpp, { azimuth = 315, altitude = 42, levels = 7 } = {}) {
  // el fondo marino (cota < 0) no cuenta para el tinte de tierra; se pinta como mar
  let min = Infinity, max = -Infinity, land = 0;
  for (const v of elev) { if (v < 0) continue; land++; if (v < min) min = v; if (v > max) max = v; }
  if (!land) { min = 0; max = 1; }
  const range = Math.max(1, max - min);
  // en llanuras (Castilla) se exagera para que se lean vaguadas y páramos; en montaña, poco
  const zf = range < 150 ? 6 : range < 400 ? 3.5 : range < 900 ? 2 : 1.3;
  const az = ((360 - azimuth + 90) * Math.PI) / 180, alt = (altitude * Math.PI) / 180;
  const flat = Math.cos(alt);
  const at = (x, y) => elev[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  // 1) oscuridad de ladera (0 = llano o al sol, 1 = sombra plena)
  const dark = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Horn (3×3)
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), hh = at(x, y + 1), i = at(x + 1, y + 1);
      const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * mpp) * zf;
      const dzdy = ((g + 2 * hh + i) - (a + 2 * b + c)) / (8 * mpp) * zf;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, Math.min(1, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect)));
      dark[y * w + x] = elev[y * w + x] < 0 ? 0 : Math.max(0, flat - shade) / flat;
    }
  }
  // 2) contraste adaptativo: la sombra más marcada del 2 % superior pasa a ~0,8,
  //    así una vega castellana se lee igual que una sierra (sin pasarse en montaña)
  const step = Math.max(1, Math.floor(dark.length / 20000));
  const sample = [];
  for (let k = 0; k < dark.length; k += step) sample.push(dark[k]);
  sample.sort((p, q) => p - q);
  const p98 = sample[Math.floor(sample.length * 0.98)] || 0;
  const gain = p98 > 1e-4 ? Math.min(40, 0.8 / p98) : 0;
  // 3) color: tinte por altitud + sombra en bandas (pincelada, no foto)
  const rgba = new Uint8ClampedArray(w * h * 4);
  const sh = [92, 80, 76];                                      // sombra: sepia azulado
  for (let k = 0; k < w * h; k++) {
    if (elev[k] < 0) {
      const o = k * 4, deep = Math.min(1, -elev[k] / 60);        // más azul cuanto más hondo
      rgba[o] = 128 - 22 * deep; rgba[o + 1] = 172 - 18 * deep; rgba[o + 2] = 196 - 8 * deep;
      rgba[o + 3] = 120 + 50 * deep;
      continue;
    }
    let dk = Math.min(1, dark[k] * gain);
    dk = Math.round(dk * levels) / levels;
    const t = (elev[k] - min) / range;                          // 0 = valle, 1 = cumbre
    const tint = t < 0.5                                         // vega verde → páramo ocre → sierra tostada
      ? [162 + 60 * t, 180 - 4 * t, 128 - 6 * t]
      : [192 + 16 * (t - 0.5), 178 - 50 * (t - 0.5), 125 - 34 * (t - 0.5)];
    const o = k * 4;
    rgba[o] = tint[0] * (1 - dk) + sh[0] * dk;
    rgba[o + 1] = tint[1] * (1 - dk) + sh[1] * dk;
    rgba[o + 2] = tint[2] * (1 - dk) + sh[2] * dk;
    rgba[o + 3] = Math.min(255, 18 + 70 * t + 135 * Math.pow(dk, 1.05));
  }
  return { rgba, min, max };
}

function loadTile(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('tesela no disponible'));
    img.src = src;
  });
}

const cache = new Map();

/**
 * Descarga las teselas, calcula el relieve y lo devuelve como imagen con su extensión geográfica.
 * @returns { href, minLat, maxLat, minLon, maxLon, min, max } o null si no hay teselas
 */
export async function buildRelief(ext, { px = 1400 } = {}) {
  const tr = tileRange(ext, px);
  const key = JSON.stringify(tr);
  if (cache.has(key)) return cache.get(key);
  const { z, x0, x1, y0, y1 } = tr;
  const W = (x1 - x0 + 1) * TILE, H = (y1 - y0 + 1) * TILE;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  let ok = 0;
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    jobs.push((async () => {
      for (const s of SOURCES) {
        try { const img = await loadTile(s(z, tx, ty)); g.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE); ok++; return; } catch { /* siguiente fuente */ }
      }
    })());
  }
  await Promise.all(jobs);
  if (!ok) return null;
  const raw = g.getImageData(0, 0, W, H).data;
  const elev = decodeTerrarium(raw, W * H);
  const midLat = (ext.minLat + ext.maxLat) / 2;
  const mpp = (2 * Math.PI * R * Math.cos((midLat * Math.PI) / 180)) / (TILE * 2 ** z);
  const { rgba, min, max } = paintRelief(elev, W, H, mpp);
  g.putImageData(new ImageData(rgba, W, H), 0, 0);
  const out = {
    href: cv.toDataURL('image/png'),
    minLon: x2lon(x0, z), maxLon: x2lon(x1 + 1, z),
    maxLat: y2lat(y0, z), minLat: y2lat(y1 + 1, z),
    min, max, zoom: z, tiles: ok,
  };
  cache.set(key, out);
  return out;
}

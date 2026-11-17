// #ESTODOBAJADA · Arte — lector GPX sin pérdidas.
// El GPX es la fuente autoritativa: se leen los valores tal cual vienen en el
// fichero (cadena original + número) y nunca se simplifican, reordenan ni unen.

const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attrs(tagSource) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tagSource))) out[m[1]] = m[3] !== undefined ? m[3] : m[4];
  return out;
}

function decodeText(s) {
  if (s == null) return '';
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').trim();
}

function firstChild(inner, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i');
  const m = inner.match(re);
  return m ? decodeText(m[1]) : null;
}

function readPoint(tagName, open, inner, index) {
  const a = attrs(open);
  if (a.lat === undefined || a.lon === undefined) {
    throw new Error(`Punto ${tagName} nº ${index + 1} sin lat/lon`);
  }
  const lat = Number(a.lat);
  const lon = Number(a.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`Coordenadas no válidas en el punto ${index + 1}: ${a.lat}, ${a.lon}`);
  }
  const eleS = inner ? firstChild(inner, 'ele') : null;
  const timeS = inner ? firstChild(inner, 'time') : null;
  const ele = eleS !== null && eleS !== '' && Number.isFinite(Number(eleS)) ? Number(eleS) : null;
  return {
    i: index,            // posición global en el fichero
    latStr: a.lat,       // valor literal del fichero
    lonStr: a.lon,
    lat, lon, ele,
    time: timeS || null,
    name: inner ? firstChild(inner, 'name') : null,
  };
}

// Recorre los elementos de punto (trkpt / rtept / wpt) dentro de un bloque.
function pointsIn(block, tag, counter) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(\\/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    out.push(readPoint(tag, m[1], m[3] || '', counter.n++));
  }
  return out;
}

function blocks(src, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function stripChildBlocks(src, tags) {
  let s = src;
  for (const t of tags) s = s.replace(new RegExp(`<(?:\\w+:)?${t}\\b[\\s\\S]*?</(?:\\w+:)?${t}>`, 'gi'), '');
  return s;
}

/**
 * Lee un GPX y devuelve su modelo íntegro.
 * tracks[].segments[].points[] conserva cada trkpt en el orden del fichero.
 * Las rutas (<rte>) se tratan como segmentos propios; los <wpt> se guardan aparte.
 */
export function parseGPX(text) {
  if (typeof text !== 'string' || !/<gpx\b/i.test(text)) throw new Error('El fichero no parece un GPX');
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  const counter = { n: 0 };
  const metaName = firstChild((src.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i) || [])[1] || '', 'name');

  const tracks = blocks(src, 'trk').map((trk, ti) => {
    const segs = blocks(trk, 'trkseg');
    const head = stripChildBlocks(trk, ['trkseg']);
    return {
      kind: 'trk',
      name: firstChild(head, 'name') || `Track ${ti + 1}`,
      segments: segs.map((s) => ({ points: pointsIn(s, 'trkpt', counter) })).filter((s) => s.points.length > 0),
    };
  });

  const routes = blocks(src, 'rte').map((rte, ri) => ({
    kind: 'rte',
    name: firstChild(stripChildBlocks(rte, ['rtept']), 'name') || `Ruta ${ri + 1}`,
    segments: [{ points: pointsIn(rte, 'rtept', counter) }].filter((s) => s.points.length > 0),
  }));

  const outside = stripChildBlocks(src, ['trk', 'rte']);
  const waypoints = pointsIn(outside, 'wpt', { n: 0 });

  const lines = [...tracks, ...routes].filter((t) => t.segments.length);
  if (!lines.length) throw new Error('El GPX no contiene tracks ni rutas con puntos');

  const name = metaName || lines[0].name || 'Ruta sin nombre';
  return { name, lines, waypoints, rawLength: text.length };
}

/** Todos los segmentos como lista plana, con referencia a su línea. */
export function allSegments(model) {
  const out = [];
  model.lines.forEach((line, li) => line.segments.forEach((seg, si) => out.push({ li, si, line, points: seg.points })));
  return out;
}

export function countPoints(model) {
  return allSegments(model).reduce((n, s) => n + s.points.length, 0);
}

/**
 * Huella canónica del contenido geográfico original: cada punto como
 * "lat,lon" con las cadenas literales del fichero, segmentos separados por "|".
 */
export function canonicalString(model) {
  return allSegments(model)
    .map((s) => s.points.map((p) => `${p.latStr},${p.lonStr}`).join(';'))
    .join('|');
}

/** Lectura independiente del fichero crudo (sin pasar por el modelo) para contrastar. */
export function rawCanonicalString(text) {
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  const parts = [];
  const lineRe = /<(?:\w+:)?(trk|rte)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/gi;
  let m;
  while ((m = lineRe.exec(src))) {
    const kind = m[1].toLowerCase();
    const body = m[2];
    const segBodies = kind === 'trk' ? blocks(body, 'trkseg') : [body];
    const ptTag = kind === 'trk' ? 'trkpt' : 'rtept';
    for (const sb of segBodies) {
      const re = new RegExp(`<(?:\\w+:)?${ptTag}\\b([^>]*?)(\\/>|>)`, 'gi');
      const pts = [];
      let p;
      while ((p = re.exec(sb))) {
        const a = attrs(p[1]);
        pts.push(`${a.lat},${a.lon}`);
      }
      if (pts.length) parts.push(pts.join(';'));
    }
  }
  return parts.join('|');
}

export async function sha256(str) {
  const data = new TextEncoder().encode(str);
  // crypto.subtle solo existe en contextos seguros (https o localhost). Con http://dominio:8088
  // no está disponible, así que se usa la implementación propia (mismo resultado).
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const buf = await subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* se cae a la versión propia */ }
  }
  return sha256js(data);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 en JavaScript puro (FIPS 180-4). */
export function sha256js(bytes) {
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  dv.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

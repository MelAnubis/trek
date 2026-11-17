// Validación técnica: demuestra que el mapa usa exactamente los puntos del GPX.
import { allSegments, countPoints, canonicalString, rawCanonicalString, sha256 } from './gpx.js';
import { haversine } from './geo.js';

export const PX_DECIMALS = 3;               // precisión con la que se escribe la ruta en el SVG
const PX_TOLERANCE = 0.5 * 10 ** -PX_DECIMALS + 1e-9;

/** Extrae los trazados de ruta de un SVG (cadena) en orden de documento. */
export function extractRoutePaths(svgString) {
  const out = [];
  const re = /<path\b[^>]*\bdata-ruta-seg="(\d+)"[^>]*>/g;
  let m;
  while ((m = re.exec(svgString))) {
    const tag = m[0];
    const d = (tag.match(/\sd="([^"]*)"/) || [])[1] || '';
    out.push({ seg: Number(m[1]), d });
  }
  return out;
}

export function parsePathD(d) {
  const tokens = d.trim().match(/[MLml]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let moves = 0, cmd = null;
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    if (/^[MLml]$/.test(t)) { cmd = t; if (t === 'M' || t === 'm') moves++; i++; continue; }
    if (cmd !== 'M' && cmd !== 'L') throw new Error('Comando de trazado no esperado: ' + cmd);
    pts.push([Number(tokens[i]), Number(tokens[i + 1])]);
    i += 2;
    if (cmd === 'M') cmd = 'L';
  }
  return { pts, moves, otherCommands: /[^MLml\d\s.,eE+-]/.test(d) };
}

/**
 * @param model  modelo GPX
 * @param rawText texto original del fichero
 * @param svgString SVG final generado
 * @param projection proyección usada en el render
 */
export async function validate(model, rawText, svgString, projection) {
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok, detail });
  const segs = allSegments(model);

  // 1. número de puntos
  const rawCanon = rawCanonicalString(rawText);
  const rawCount = rawCanon ? rawCanon.split('|').reduce((n, s) => n + s.split(';').length, 0) : 0;
  const modelCount = countPoints(model);
  add('count', 'Número de puntos conservado', rawCount === modelCount,
    `${modelCount.toLocaleString('es-ES')} puntos leídos · ${rawCount.toLocaleString('es-ES')} en el fichero`);

  // 2. coordenadas intactas (huella de las cadenas literales)
  const hModel = await sha256(canonicalString(model));
  const hRaw = await sha256(rawCanon);
  let numericOk = true;
  for (const s of segs) for (const p of s.points) {
    if (Number(p.latStr) !== p.lat || Number(p.lonStr) !== p.lon) numericOk = false;
  }
  add('coords', 'Coordenadas originales intactas', hModel === hRaw && numericOk,
    `SHA-256 ${hModel.slice(0, 16)}… ${hModel === hRaw ? '= fichero' : '≠ fichero'}`);

  // 3. orden de los puntos
  let orderOk = true, last = -1;
  for (const s of segs) for (const p of s.points) { if (p.i <= last) orderOk = false; last = p.i; }
  add('order', 'Orden de los puntos sin cambios', orderOk, 'Índices estrictamente crecientes según el fichero');

  // 4 y 5. trazado SVG
  const paths = extractRoutePaths(svgString);
  let indepOk = paths.length === segs.length;
  let svgCountOk = true, maxPx = 0, maxM = 0, svgPts = 0, jumpsOk = true;
  paths.forEach((p, idx) => {
    const parsed = parsePathD(p.d);
    if (parsed.moves !== 1 || parsed.otherCommands || p.seg !== idx) indepOk = false;
    const seg = segs[p.seg];
    if (!seg || parsed.pts.length !== seg.points.length) { svgCountOk = false; return; }
    svgPts += parsed.pts.length;
    parsed.pts.forEach(([x, y], j) => {
      const src = seg.points[j];
      const [ex, ey] = projection.project(src.lat, src.lon);
      maxPx = Math.max(maxPx, Math.abs(ex - x), Math.abs(ey - y));
      const back = projection.invert(x, y);
      maxM = Math.max(maxM, haversine(back, src));
    });
  });
  // los segmentos no se unen: el final de uno no se conecta al inicio del siguiente
  for (let s = 1; s < paths.length; s++) {
    if (!/^\s*M/.test(paths[s].d)) jumpsOk = false;
  }
  add('segments', 'Segmentos independientes sin unir', indepOk && jumpsOk,
    `${segs.length} segmento(s) en el GPX · ${paths.length} trazado(s) en el SVG, cada uno con un solo «M»`);
  add('svg', 'El SVG usa exactamente los puntos GPX proyectados', svgCountOk && svgPts === modelCount && maxPx <= PX_TOLERANCE,
    `${svgPts.toLocaleString('es-ES')} vértices · desvío máx. ${maxPx.toFixed(4)} px (${(maxM * 100).toFixed(2)} cm sobre el terreno)`);

  // tramos de etapa: deben ser subsecuencias contiguas y exactas que cubren toda la ruta
  const stageRe = /<path\b[^>]*\bdata-etapa="(\d+)"[^>]*>/g;
  let sm, stageOk = true, nStage = 0;
  const covered = segs.map((sg) => new Array(sg.points.length).fill(false));
  while ((sm = stageRe.exec(svgString))) {
    nStage++;
    const tag = sm[0];
    const si = Number((tag.match(/data-etapa-seg="(\d+)"/) || [])[1]);
    const j0 = Number((tag.match(/data-j0="(\d+)"/) || [])[1]);
    const j1 = Number((tag.match(/data-j1="(\d+)"/) || [])[1]);
    const d = (tag.match(/\sd="([^"]*)"/) || [])[1] || '';
    const seg = segs[si];
    const parsed = parsePathD(d);
    if (!seg || parsed.moves !== 1 || parsed.pts.length !== j1 - j0 + 1) { stageOk = false; continue; }
    parsed.pts.forEach(([x, y], k) => {
      const src = seg.points[j0 + k];
      const [ex, ey] = projection.project(src.lat, src.lon);
      if (Math.abs(ex - x) > PX_TOLERANCE || Math.abs(ey - y) > PX_TOLERANCE) stageOk = false;
      covered[si][j0 + k] = true;
    });
  }
  if (nStage) {
    const all = covered.every((c) => c.every(Boolean) || c.length === 1);
    add('stages', 'Las etapas reutilizan exactamente los puntos GPX', stageOk && all,
      `${nStage} tramo(s) de etapa · ${all ? 'cubren todo el recorrido sin huecos' : 'hay puntos sin cubrir'}`);
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    sha256: hModel,
    points: modelCount,
    segments: segs.length,
    generatedAt: new Date().toISOString(),
  };
}

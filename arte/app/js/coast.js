// Mar a partir de la línea de costa de OpenStreetMap (natural=coastline).
// En OSM el mar no es un polígono: la costa es una línea con la tierra a la izquierda y el
// agua a la derecha. Aquí se recorta al recuadro del mapa y se cierran los polígonos de mar
// siguiendo el borde del recuadro en sentido horario (con el agua siempre a la derecha).
// Se trabaja en (x = lon, y = lat), con y hacia arriba.

const EPS = 1e-9;
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/** Une los tramos de costa por sus extremos respetando el sentido (fin de uno = inicio del siguiente). */
export function mergeCoast(ways) {
  const rest = ways.filter((w) => w && w.length > 1).map((w) => w.slice());
  const chains = [];
  while (rest.length) {
    let c = rest.shift();
    let grown = true;
    while (grown && !(c.length > 3 && same(c[0], c[c.length - 1]))) {
      grown = false;
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        if (same(w[0], c[c.length - 1])) { c = c.concat(w.slice(1)); rest.splice(i, 1); grown = true; break; }
        if (same(w[w.length - 1], c[0])) { c = w.concat(c.slice(1)); rest.splice(i, 1); grown = true; break; }
      }
    }
    chains.push(c);
  }
  return chains;
}

// Liang–Barsky: parte del segmento a→b dentro del rectángulo (t0..t1) o null.
function clipSeg(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy], q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const inside = (p, r) => p[0] > r.x0 + EPS && p[0] < r.x1 - EPS && p[1] > r.y0 + EPS && p[1] < r.y1 - EPS;

/** Posición sobre el perímetro, en sentido horario desde la esquina superior izquierda. */
function perim(p, r) {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const d = [Math.abs(p[1] - r.y1), Math.abs(p[0] - r.x1), Math.abs(p[1] - r.y0), Math.abs(p[0] - r.x0)];
  const e = d.indexOf(Math.min(...d));
  if (e === 0) return p[0] - r.x0;                 // arriba, de izquierda a derecha
  if (e === 1) return W + (r.y1 - p[1]);           // derecha, de arriba abajo
  if (e === 2) return W + H + (r.x1 - p[0]);       // abajo, de derecha a izquierda
  return 2 * W + H + (p[1] - r.y0);                // izquierda, de abajo arriba
}

/**
 * @param coastWays [[lat,lon],…] por tramo de costa
 * @param ext { minLat, maxLat, minLon, maxLon } recuadro del mapa
 * @returns { ok, rings: [[lat,lon],…][] } anillos para pintar con evenodd (mar + islas como huecos)
 */
export function seaRings(coastWays, ext) {
  const r = { x0: ext.minLon, x1: ext.maxLon, y0: ext.minLat, y1: ext.maxLat };
  const W = r.x1 - r.x0, H = r.y1 - r.y0, PER = 2 * (W + H);
  const corners = [[0, [r.x0, r.y1]], [W, [r.x1, r.y1]], [W + H, [r.x1, r.y0]], [2 * W + H, [r.x0, r.y0]]];
  const chains = mergeCoast(coastWays.map((w) => w.map(([la, lo]) => [lo, la])));
  const pieces = [], islands = [], lakes = [];
  let dangling = false;

  for (const c of chains) {
    const closed = c.length > 3 && same(c[0], c[c.length - 1]);
    if (c.every((p) => inside(p, r))) {
      if (!closed) { dangling = true; continue; }
      // anillo completo dentro: antihorario = isla (tierra dentro); horario = agua encerrada
      let a = 0;
      for (let i = 0; i < c.length - 1; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
      (a > 0 ? islands : lakes).push(c);
      continue;
    }
    const local = [];
    let cur = null, startInside = false;
    for (let i = 0; i < c.length - 1; i++) {
      const cl = clipSeg(c[i], c[i + 1], r);
      if (!cl) continue;
      const pa = lerp(c[i], c[i + 1], cl[0]), pb = lerp(c[i], c[i + 1], cl[1]);
      if (!cur) {
        const enters = cl[0] > EPS || !inside(c[i], r);
        if (!enters && i === 0) startInside = true;
        cur = { pts: [pa], tin: enters ? perim(pa, r) : null };
      }
      cur.pts.push(pb);
      if (cl[1] < 1 - EPS || !inside(c[i + 1], r)) { cur.tout = perim(pb, r); local.push(cur); cur = null; }
    }
    if (cur) { cur.tout = null; local.push(cur); }
    // cadena cerrada que cruza el borde: el primer y el último trozo son el mismo
    if (closed && startInside && local.length > 1 && local[local.length - 1].tout === null) {
      const last = local.pop(), first = local.shift();
      local.unshift({ pts: last.pts.concat(first.pts.slice(1)), tin: last.tin, tout: first.tout });
    }
    for (const p of local) { if (p.tin == null || p.tout == null) dangling = true; else pieces.push(p); }
  }
  if (dangling) return { ok: false, rings: [] };

  const rings = [];
  if (!pieces.length) {
    if (islands.length) rings.push([[r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0], [r.x0, r.y0], [r.x0, r.y1]]);
  } else {
    const used = new Set();
    for (let s = 0; s < pieces.length; s++) {
      if (used.has(s)) continue;
      const ring = [];
      let k = s, guard = 0;
      do {
        used.add(k);
        const p = pieces[k];
        ring.push(...p.pts);
        // siguiente entrada en sentido horario desde la salida de este trozo
        let best = -1, bestD = Infinity;
        pieces.forEach((q, j) => {
          if (used.has(j) && j !== s) return;
          let d = q.tin - p.tout; if (d < -EPS) d += PER; if (d < EPS && j !== s) d += 0;
          if (d < bestD) { bestD = d; best = j; }
        });
        // esquinas del recuadro que se recorren hasta esa entrada
        const t0 = p.tout, t1 = t0 + bestD;
        for (const [tc, pt] of corners.concat(corners.map(([tc2, pt2]) => [tc2 + PER, pt2]))) {
          if (tc > t0 + EPS && tc < t1 - EPS) ring.push(pt);
        }
        k = best;
      } while (k !== s && k >= 0 && ++guard < 10000);
      ring.push(ring[0]);
      rings.push(ring);
    }
  }
  for (const i of islands) rings.push(i);
  for (const l of lakes) rings.push(l);
  return { ok: true, rings: rings.map((ring) => ring.map(([lo, la]) => [la, lo])) };
}

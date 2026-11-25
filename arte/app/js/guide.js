// Maquetación «Guía ilustrada»: etapas por colores, panel lateral con leyenda y
// puntos de interés, perfiles por etapa y campiña de fondo.
// Las etapas se dibujan como tramos superpuestos que reutilizan exactamente
// los vértices GPX (subsecuencias contiguas); el trazado completo sigue debajo.
import { PAL, pineTree, roundTree, monumentDrawing } from './illustrations.js';
import { PX_DECIMALS } from './integrity.js';

export const STAGE_COLORS = ['#e8743b', '#2f9e44', '#1c7ed6', '#c2255c', '#7048e8', '#e0a100', '#0c8599'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n) => Math.round(n * 10) / 10;
const fx = (n) => Number(n.toFixed(PX_DECIMALS));

function nearestSample(samples, d) {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (samples[mid].d < d) lo = mid; else hi = mid; }
  return Math.abs(samples[lo].d - d) <= Math.abs(samples[hi].d - d) ? lo : hi;
}

/** Fines de etapa automáticos: poblaciones elegidas más cercanas a divisiones iguales. */
export function autoStageEnds(towns, total, n) {
  const sel = towns.filter((t) => t.selected && t.place !== 'poi' && t.along > total * 0.03 && t.along < total * 0.97);
  const ends = new Set();
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    let best = null;
    for (const t of sel) if (!ends.has(t.id) && (!best || Math.abs(t.along - target) < Math.abs(best.along - target))) best = t;
    if (best) ends.add(best.id);
  }
  return ends;
}

export function computeStages(prof, towns, circular, palette = null) {
  const COLS = palette && palette.length ? palette : STAGE_COLORS;
  const s = prof.samples;
  // los elementos sueltos (villas, ermitas…) no son poblaciones: no dan nombre ni cierran etapas
  const sel = towns.filter((t) => t.selected && t.place !== 'poi').sort((a, b) => a.along - b.along);
  const ends = sel.filter((t) => t.stageEnd && t.along > 0 && t.along < prof.total);
  const startTown = sel.find((t) => t.along < Math.max(1500, prof.total * 0.02));
  const endTown = circular ? startTown : sel.slice().reverse().find((t) => t.along > prof.total - Math.max(1500, prof.total * 0.02));
  const bounds = [{ d: 0, town: startTown }, ...ends.map((t) => ({ d: t.along, town: t })), { d: prof.total, town: endTown }];
  const stages = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const k0 = i === 0 ? 0 : nearestSample(s, a.d);
    const k1 = i === bounds.length - 2 ? s.length - 1 : nearestSample(s, b.d);
    let up = 0, down = 0;
    for (let k = k0 + 1; k <= k1; k++) {
      if (s[k].si !== s[k - 1].si || s[k].ele == null || s[k - 1].ele == null) continue;
      const dd = s[k].ele - s[k - 1].ele;
      if (dd > 0) up += dd; else down -= dd;
    }
    const names = [a.town ? a.town.label || a.town.name : 'Salida'];
    for (const t of sel) if (t.along > a.d + 1 && t.along < b.d - 1 && t !== a.town && t !== b.town) names.push(t.label || t.name);
    names.push(b.town ? b.town.label || b.town.name : 'Llegada');
    stages.push({ n: i + 1, k0, k1, d0: s[k0].d, d1: s[k1].d, km: (s[k1].d - s[k0].d) / 1000, up, down, names, color: COLS[i % COLS.length] });
  }
  return stages;
}

/** Tramos de etapa: cada uno es una subsecuencia contigua exacta de vértices GPX proyectados. */
export function stageRoute(stages, prof, segPx, { wet }) {
  const s = prof.samples;
  let bleed = '', ink = '';
  for (const st of stages) {
    let k = st.k0;
    while (k <= st.k1) {
      const si = s[k].si, j0 = s[k].j;
      let k2 = k;
      while (k2 + 1 <= st.k1 && s[k2 + 1].si === si) k2++;
      const j1 = s[k2].j;
      if (j1 > j0) {
        const d = segPx[si].slice(j0, j1 + 1).map(([x, y], i) => `${i ? 'L' : 'M'}${fx(x)} ${fx(y)}`).join('');
        if (wet) bleed += `<path d="${d}" fill="none" stroke="${st.color}" stroke-opacity=".28" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" filter="url(#sangrado)"/>`;
        ink += `<path class="etapa" data-etapa="${st.n}" data-etapa-seg="${si}" data-j0="${j0}" data-j1="${j1}" d="${d}" fill="none" stroke="${st.color}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      k = k2 + 1;
    }
  }
  return `<g id="capa-etapas">${bleed}${ink}</g>`;
}

/** Campiña decorativa: parcelas de cultivo y árboles sueltos (no representan datos OSM). */
export function campina(M, rnd, occupied, sc) {
  const colors = ['#e4cc8a', '#cdd49a', '#d8bd78', '#bccb8a', '#e8d6a2'];
  const cell = 74 * sc;
  let fields = '', hatch = '', trees = '';
  for (let y = M.y; y < M.y + M.h; y += cell * 0.8) {
    for (let x = M.x - cell * 0.3; x < M.x + M.w; x += cell) {
      const cx = x + rnd() * cell * 0.6, cy = y + rnd() * cell * 0.4;
      if (occupied.some((o) => cx > o.x - 10 && cx < o.x + o.w + 10 && cy > o.y - 10 && cy < o.y + o.h + 10)) continue;
      const w = cell * (0.55 + rnd() * 0.5), h = cell * (0.35 + rnd() * 0.35), a = (rnd() - 0.5) * 50;
      if (rnd() < 0.72) {
        // parcela irregular (cuatro esquinas con temblor), girada
        const q = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
          .map(([px, py]) => [cx + px + (rnd() - 0.5) * w * 0.25, cy + py + (rnd() - 0.5) * h * 0.3]);
        const d = q.map(([px, py], i) => `${i ? 'L' : 'M'}${f1(px)} ${f1(py)}`).join('') + 'Z';
        fields += `<path d="${d}" transform="rotate(${f1(a)} ${f1(cx)} ${f1(cy)})" fill="${colors[Math.floor(rnd() * colors.length)]}" fill-opacity="${(0.18 + rnd() * 0.16).toFixed(2)}" filter="url(#acuarela)"/>`;
        if (rnd() < 0.35) {
          let dd = '';
          const n = 2 + Math.floor(rnd() * 3);
          for (let i = 1; i <= n; i++) dd += `M${f1(cx - w * 0.35)} ${f1(cy - h / 2 + (h * i) / (n + 1))}q${f1(w * 0.35)} ${f1((rnd() - 0.5) * 3)} ${f1(w * 0.7)} 0`;
          hatch += `<path d="${dd}" transform="rotate(${f1(a)} ${f1(cx)} ${f1(cy)})" stroke="${PAL.stoneDark}" stroke-opacity=".22" stroke-width=".6" fill="none"/>`;
        }
      }
      if (rnd() < 0.3) {
        // bosquete de 1 a 5 árboles sueltos
        const n = 1 + Math.floor(rnd() * 5);
        const tx0 = cx + (rnd() - 0.5) * cell * 0.8, ty0 = cy + (rnd() - 0.5) * cell * 0.5;
        for (let i = 0; i < n; i++) {
          const tx = tx0 + (rnd() - 0.5) * 22 * sc, ty = ty0 + (rnd() - 0.5) * 12 * sc;
          trees += rnd() < 0.55 ? roundTree(tx, ty, sc * 0.9, Math.floor(rnd() * 1e6)) : pineTree(tx, ty, sc * 0.9, Math.floor(rnd() * 1e6));
        }
      }
    }
  }
  return `<g id="capa-campina">${fields}${hatch}${trees}</g>`;
}

export function bike(x, y, s = 1) {
  const st = `stroke="${PAL.ink}" stroke-width="${f1(1.6 * s)}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const r = 9 * s;
  return `<g transform="translate(${f1(x)} ${f1(y)})"><circle cx="${f1(r)}" cy="0" r="${f1(r)}" ${st}/><circle cx="${f1(r * 4.2)}" cy="0" r="${f1(r)}" ${st}/>
<path d="M${f1(r)} 0L${f1(r * 1.9)} ${f1(-r * 1.4)}L${f1(r * 3.4)} ${f1(-r * 1.4)}L${f1(r * 4.2)} 0M${f1(r * 1.9)} ${f1(-r * 1.4)}L${f1(r * 2.5)} 0L${f1(r * 3.4)} ${f1(-r * 1.4)}M${f1(r * 1.7)} ${f1(-r * 1.9)}l${f1(r * 0.6)} 0M${f1(r * 3.4)} ${f1(-r * 1.4)}l${f1(-r * 0.15)} ${f1(-r * 0.6)}l${f1(r * 0.5)} 0" ${st}/></g>`;
}

let BADGE_TEXT = '#fbf6ea';
export function setBadgeText(c) { BADGE_TEXT = c || '#fbf6ea'; }
export function numberBadge(x, y, n, r = 11) {
  return `<g><circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${PAL.ink}"/><text x="${f1(x)}" y="${f1(y + r * 0.42)}" text-anchor="middle" class="manoF" font-weight="700" font-size="${f1(r * 1.35)}" fill="${BADGE_TEXT}">${n}</text></g>`;
}

// Ancho de la letra manuscrita elegida respecto a Caveat (la maquetación se calculó con ella).
let CW = 1;
export function setTextWidth(k) { CW = k || 1; }
/** Caracteres que caben en «width» con letra manuscrita de tamaño «size». */
const fitChars = (width, size) => Math.max(8, Math.floor(width / (size * 0.48 * CW)));
/** Tamaño que hace caber «text» en «width» (sin pasar de «size»). */
const fitSize = (text, width, size, spacing = 0) => Math.min(size, width / Math.max(1, String(text).length * (0.48 * CW + spacing / size)));

export function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Bloque de título manuscrito. */
export function titleBlock(H, { title, kicker, description, sc, titleScale = 1 }) {
  let s = `<g id="cartela-guia">`;
  // el título no invade la descripción (que empieza al 48 % del ancho) ni la bicicleta
  const room = description ? H.w * 0.45 : H.w - 90 * sc;
  const ts = Math.min(H.h * 0.46, room / (Math.max(6, title.length) * 0.5 * CW)) * titleScale;
  s += `<text class="mano" x="${H.x + 4}" y="${f1(H.y + ts * 0.92)}" font-size="${f1(ts)}" font-weight="700">${esc(title)}</text>`;
  s += `<path d="M${H.x + 2} ${f1(H.y + ts * 1.08)}Q${f1(H.x + H.w * 0.25)} ${f1(H.y + ts * 1.02)} ${f1(H.x + Math.min(H.w * 0.55, title.length * ts * 0.48))} ${f1(H.y + ts * 1.1)}" stroke="${PAL.ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  const ks = fitSize(kicker, H.w - 12, 24 * sc * 1.15, 1.5) / 1.15;
  const ds = 19 * sc;
  const lines = wrap(description, fitChars(H.w * 0.38, ds));
  // la línea de datos va bajo el título y, si la descripción baja más, bajo la descripción
  const descBottom = H.y + ds * 1.25 * Math.min(4, lines.length) + 4;
  const ky = Math.max(H.y + ts * 1.1 + ks * 1.3, lines.length ? descBottom + ks * 1.15 : 0);
  s += `<text class="mano" x="${H.x + 4}" y="${f1(ky)}" font-size="${f1(ks)}" letter-spacing="1.5">${esc(kicker.toUpperCase())}</text>`;
  lines.slice(0, 4).forEach((ln, i) => { s += `<text class="mano" x="${f1(H.x + H.w * 0.48)}" y="${f1(H.y + ds * 1.25 * (i + 1) + 4)}" font-size="${f1(ds)}">${esc(ln)}</text>`; });
  s += bike(H.x + H.w - 66 * sc, H.y + 34 * sc, sc * 1.1);
  return s + '</g>';
}

/** Perfiles de altitud por etapa (o uno solo). */
export function stageProfiles(Pr, prof, stages, stats, look = {}) {
  const gap = 18;
  const n = stages.length;
  const w = (Pr.w - gap * (n - 1)) / n;
  const lo = Math.floor(stats.min / 20) * 20, hi = Math.ceil(stats.max / 20) * 20 + 20;
  let s = '<g id="perfiles-etapa">';
  stages.forEach((st, i) => {
    const x0 = Pr.x + i * (w + gap), y0 = Pr.y, h = Pr.h;
    const gx = x0 + 10, gy = y0 + 34, gw = w - 20, gh = h - 54;
    const smp = prof.samples.slice(st.k0, st.k1 + 1).filter((p) => p.ele != null);
    if (smp.length < 2) return;
    const X = (d) => gx + ((d - st.d0) / Math.max(1, st.d1 - st.d0)) * gw;
    const Y = (e) => gy + gh - ((e - lo) / (hi - lo)) * gh;
    let line = '';
    smp.forEach((p, j) => { line += `${j ? 'L' : 'M'}${f1(X(p.d))} ${f1(Y(p.ele))}`; });
    s += `<rect x="${f1(x0)}" y="${f1(y0)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${PAL.ink}" stroke-width=".9" filter="url(#tinta)"/>`;
    const kmT = `${st.km.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km · +${Math.round(st.up)} m`;
    const dayW = `Día ${st.n}`.length * 22 * 0.52 * CW;
    s += `<text class="mano" x="${f1(x0 + 10)}" y="${f1(y0 + 24)}" font-size="22" font-weight="700" fill="${st.color}" style="fill:${st.color}">Día ${st.n}</text>`;
    s += `<text class="mano" x="${f1(x0 + w - 10)}" y="${f1(y0 + 24)}" font-size="${f1(fitSize(kmT, w - 32 - dayW, 17))}" text-anchor="end">${kmT}</text>`;
    s += `<path d="${line}L${f1(X(smp[smp.length - 1].d))} ${f1(gy + gh)}L${f1(X(smp[0].d))} ${f1(gy + gh)}Z" fill="${look.fill || '#b9a27c'}" fill-opacity="${look.fill ? 1 : .45}" filter="url(#acuarela)"/>`;
    s += `<path d="${line}" fill="none" stroke="${st.color}" stroke-width="2"/>`;
    s += `<path d="M${f1(gx)} ${f1(gy + gh)}L${f1(gx + gw)} ${f1(gy + gh)}" stroke="${PAL.ink}" stroke-width=".8"/>`;
    s += `<text class="tx" x="${f1(gx)}" y="${f1(gy + gh + 14)}" font-size="10">${Math.round(st.d0 / 1000)} km</text><text class="tx" x="${f1(gx + gw)}" y="${f1(gy + gh + 14)}" font-size="10" text-anchor="end">${Math.round(st.d1 / 1000)} km</text>`;
  });
  return s + '</g>';
}

/** Panel lateral: etapas, leyenda y puntos de interés. */
export function sidePanel(R, { dot = '#fbf6ea', sea = '#8fbcd2', stages, pois, start, circular, motto, hasWoods, hasRivers, hasWater, hasWetlands, hasSea, sc }) {
  let s = `<g id="panel-guia">`;
  s += `<path d="M${f1(R.x)} ${f1(R.y)}L${f1(R.x)} ${f1(R.y + R.h)}" stroke="${PAL.ink}" stroke-width="1.1" filter="url(#tinta)"/>`;
  const x = R.x + 18, w = R.w - 30;
  let y = R.y + 8;
  const head = (txt) => {
    y += 30;
    s += `<text class="mano" x="${f1(x)}" y="${f1(y)}" font-size="${f1(fitSize(txt, w, 27 * sc * 1.1, 2.5) / 1.1)}" letter-spacing="2.5" font-weight="700">${esc(txt)}</text>`;
    s += `<path d="M${f1(x)} ${f1(y + 7)}L${f1(x + w)} ${f1(y + 7)}" stroke="${PAL.ink}" stroke-width="1"/>`;
    y += 14;
  };
  const maxChars = Math.round(w / (9.2 * sc * CW));
  head('ETAPAS');
  for (const st of stages) {
    y += 30 * sc;
    s += `<path d="M${f1(x)} ${f1(y - 8)}q12 -6 24 0" stroke="${st.color}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    s += `<text class="mano" x="${f1(x + 34)}" y="${f1(y)}" font-size="${f1(25 * sc)}" font-weight="700" style="fill:${st.color}">Día ${st.n}</text>`;
    s += `<text class="mano" x="${f1(x + w)}" y="${f1(y)}" font-size="${f1(17 * sc)}" text-anchor="end">${st.km.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km · +${Math.round(st.up)} m</text>`;
    for (const ln of wrap(st.names.join(' → '), maxChars - 4)) { y += 21 * sc; s += `<text class="mano" x="${f1(x + 34)}" y="${f1(y)}" font-size="${f1(19 * sc)}">${esc(ln)}</text>`; }
    y += 6;
  }
  y += 10;
  s += `<path d="M${f1(x)} ${f1(y)}L${f1(x + w)} ${f1(y)}" stroke="${PAL.ink}" stroke-width=".6"/>`;
  // leyenda
  const item = (icon, txt, sub) => {
    y += 30 * sc;
    s += icon(x + 14, y - 6);
    s += `<text class="mano" x="${f1(x + 38)}" y="${f1(y)}" font-size="${f1(fitSize(txt, w - 40, 19 * sc))}">${esc(txt)}</text>`;
    if (sub) { y += 17 * sc; s += `<text class="mano" x="${f1(x + 38)}" y="${f1(y)}" font-size="${f1(fitSize(sub, w - 40, 15 * sc))}" opacity=".8">${esc(sub)}</text>`; }
  };
  item((a, b) => `<circle cx="${a}" cy="${b}" r="7" fill="${dot}" stroke="${PAL.ink}" stroke-width="2.4"/>`, circular ? `Inicio / Fin: ${start}` : `Inicio: ${start}`);
  item((a, b) => `<circle cx="${a}" cy="${b}" r="4.5" fill="${dot}" stroke="${PAL.ink}" stroke-width="1.8"/>`, 'Puntos de paso');
  item((a, b) => `<path d="M${a - 12} ${b + 3}q8 -9 14 -2t12 -3" stroke="${PAL.ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`, 'Track de la ruta', '(trazado GPX original, sin modificar)');
  if (hasWoods) item((a, b) => pineTree(a, b + 7, 1, 3), 'Bosques y pinares', '(según OpenStreetMap)');
  item((a, b) => `<g transform="translate(${a} ${b + 8}) scale(.2)">${monumentDrawing('castillo', 'castillo', 4).body}</g>`, 'Monumentos y patrimonio');
  if (hasSea) item((a, b) => `<rect x="${a - 12}" y="${b - 7}" width="24" height="14" fill="${sea}" fill-opacity=".7"/><path d="M${a - 9} ${b}q3 -3 6 0t6 0" stroke="${PAL.waterDark}" stroke-width=".9" fill="none"/>`, 'Mar');
  if (hasWater) item((a, b) => `<ellipse cx="${a}" cy="${b}" rx="11" ry="6" fill="${PAL.water}" fill-opacity=".6" stroke="${PAL.waterDark}" stroke-width=".9"/>`, 'Lagunas y embalses');
  if (hasWetlands) item((a, b) => `<path d="M${a - 9} ${b + 4}l18 0M${a - 3} ${b + 4}l-2 -6M${a} ${b + 4}l0 -8M${a + 3} ${b + 4}l2 -6" stroke="${PAL.waterDark}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`, 'Humedales');
  if (hasRivers) item((a, b) => `<path d="M${a - 12} ${b}q6 -6 12 0t12 0" stroke="${PAL.waterDark}" stroke-width="2.2" fill="none"/>`, 'Ríos');
  y += 16;
  s += `<path d="M${f1(x)} ${f1(y)}L${f1(x + w)} ${f1(y)}" stroke="${PAL.ink}" stroke-width=".6"/>`;
  if (pois.length) {
    head('PUNTOS DE INTERÉS');
    const bottomLimit = R.y + R.h - 90 * sc;
    for (const p of pois) {
      const subLines = p.monument ? wrap(`(${p.monument})`, maxChars - 2) : [];
      const nameLines = wrap(p.name, fitChars(w - 34, 21 * sc * 1.1));
      if (y + 30 * sc + (nameLines.length - 1) * 22 * sc + subLines.length * 17 * sc > bottomLimit) break;
      y += 30 * sc;
      s += numberBadge(x + 12, y - 7, p.n, 12 * sc);
      nameLines.forEach((ln, k) => { if (k) y += 22 * sc; s += `<text class="mano" x="${f1(x + 34)}" y="${f1(y)}" font-size="${f1(21 * sc)}" font-weight="700">${esc(ln)}</text>`; });
      for (const ln of subLines) { y += 17 * sc; s += `<text class="mano" x="${f1(x + 34)}" y="${f1(y)}" font-size="${f1(15.5 * sc)}">${esc(ln)}</text>`; }
    }
  }
  if (motto) {
    const lines = wrap(motto, fitChars(w - 10, 22 * sc));
    const by = R.y + R.h - 14 - (lines.length - 1) * 24 * sc;
    lines.forEach((ln, i) => { s += `<text class="mano" x="${f1(x + w / 2)}" y="${f1(by + i * 24 * sc)}" font-size="${f1(22 * sc)}" text-anchor="middle">${esc(ln)}</text>`; });
    s += `<path d="M${f1(x)} ${f1(by - 30 * sc)}L${f1(x + w)} ${f1(by - 30 * sc)}" stroke="${PAL.ink}" stroke-width=".6"/>`;
  }
  return s + '</g>';
}

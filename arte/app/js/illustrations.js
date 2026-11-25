// Ilustraciones de tinta y acuarela.
// Cada dibujo se construye en coordenadas locales: suelo en y = 0, centrado en x = 0,
// creciendo hacia arriba (y negativa). Las aguadas llevan el filtro «acuarela»;
// las líneas de tinta, el filtro «tinta». Ninguno se aplica jamás a la ruta GPX.
import { rng } from './geo.js';

export const PAL = {
  ink: '#2b2117',
  brick: '#c57650', brickLight: '#dc9c72', brickDark: '#94533a',
  stone: '#d9c8a2', stoneDark: '#a8946c', granite: '#b9b3a3',
  roof: '#b25438', wall: '#f1e6cf', door: '#3a2a1e',
  green: '#93a86a', greenDark: '#5d7444', pine: '#55703f', pineDark: '#3c5530', trunk: '#7a5236',
  water: '#7eaac2', waterDark: '#5a87a3', mountain: '#b8a98a', snow: '#f4efe3',
};

let R = rng(7);
// pistas del monumento (material, etc.) para elegir variantes con fidelidad
let HINT = {};
const j = (a = 0.6) => (R() - 0.5) * 2 * a;
const f = (n) => Math.round(n * 10) / 10;

const PAL_BASE = { ...PAL };
const DS_BASE = { inkOpacity: 1, inkWidth: 1, washOpacity: 0.88, bleedWash: false, looseTrees: false, pal: null };
let DS = { ...DS_BASE };
/**
 * Ajusta el trazo según el estilo elegido (opacidad de tinta, aguadas desbordadas…) y, en los
 * estilos contemporáneos, la paleta base (tinta, agua, verdes…). Cada estilo parte de cero.
 */
export function setDrawStyle(ds) {
  DS = { ...DS_BASE, ...ds };
  for (const k of Object.keys(PAL)) PAL[k] = PAL_BASE[k];
  if (DS.pal) Object.assign(PAL, DS.pal);
}

const wash = (d, fill, op = 0.88) => {
  const o = Math.min(1, op * (DS.washOpacity / 0.88));
  let s = `<path d="${d}" fill="${fill}" fill-opacity="${o.toFixed(2)}" filter="url(#acuarela)"/>`;
  // segunda pasada desplazada: el color se sale de la línea como en una acuarela real
  if (DS.bleedWash) s += `<path d="${d}" transform="translate(${f(1.2 + R() * 1.5)} ${f(0.6 + R())})" fill="${fill}" fill-opacity="${(o * 0.35).toFixed(2)}" filter="url(#acuarela)"/>`;
  return s;
};
const ink = (d, w = 1.1, op = 1) => `<path d="${d}" fill="none" stroke="${PAL.ink}" stroke-width="${f(w * DS.inkWidth)}" stroke-opacity="${(op * DS.inkOpacity).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" filter="url(#tinta)"/>`;
const inkFill = (d, fill = PAL.door) => `<path d="${d}" fill="${fill}" fill-opacity=".9" stroke="${PAL.ink}" stroke-width=".7" filter="url(#tinta)"/>`;

// rectángulo con un ligero temblor de mano
function rect(x, y, w, h) {
  return `M${f(x + j(.3))} ${f(y + j(.3))}L${f(x + w + j(.3))} ${f(y + j(.3))}L${f(x + w + j(.3))} ${f(y + h)}L${f(x + j(.3))} ${f(y + h)}Z`;
}

function crenels(x1, x2, y, cw = 3.6, ch = 3.4) {
  const n = Math.max(2, Math.round((x2 - x1) / (cw * 1.9)));
  const step = (x2 - x1) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const cx = x1 + i * step + (step - cw) / 2;
    d += `M${f(cx)} ${f(y)}L${f(cx)} ${f(y - ch)}L${f(cx + cw)} ${f(y - ch)}L${f(cx + cw)} ${f(y)}`;
  }
  return d;
}

function courses(x, y, w, h, step = 4.2, op = 0.28) {
  let d = '';
  for (let yy = y + step; yy < y + h - 1; yy += step) {
    let xx = x + R() * 3;
    while (xx < x + w - 2) {
      const len = 3 + R() * 7;
      if (R() > 0.35) d += `M${f(xx)} ${f(yy + j(.25))}l${f(Math.min(len, x + w - xx - 1))} 0`;
      xx += len + 2 + R() * 4;
    }
  }
  return d ? ink(d, 0.5, op) : '';
}

function shade(x, y, w, h, frac = 0.38, color = PAL.brickDark, op = 0.42) {
  return `<path d="${rect(x + w * (1 - frac), y, w * frac, h)}" fill="${color}" fill-opacity="${op}" filter="url(#acuarela)"/>`;
}

function windowSlit(x, y, w = 1.6, h = 4.5) {
  return inkFill(`M${f(x)} ${f(y + h)}L${f(x)} ${f(y + w)}Q${f(x + w / 2)} ${f(y)} ${f(x + w)} ${f(y + w)}L${f(x + w)} ${f(y + h)}Z`);
}

function archDoor(cx, w, h, pointed = true) {
  const x = cx - w / 2;
  const top = pointed ? `Q${f(x)} ${f(-h)} ${f(cx)} ${f(-h - w * 0.15)}Q${f(x + w)} ${f(-h)} ${f(x + w)} ${f(-h + w / 2)}` : `A${w / 2} ${w / 2} 0 0 1 ${f(x + w)} ${f(-h + w / 2)}`;
  return inkFill(`M${f(x)} 0L${f(x)} ${f(-h + w / 2)}${top}L${f(x + w)} 0Z`);
}

function squareTower(x, w, h, o = {}) {
  const y = -h;
  const c = o.color || PAL.brick;
  let s = wash(rect(x, y, w, h), c) + shade(x, y, w, h, 0.36, o.dark || PAL.brickDark);
  if (o.crenels !== false) s += wash(crenels(x - 0.6, x + w + 0.6, y) + 'Z', c, 0.8);
  if (o.texture !== false) s += courses(x, y, w, h);
  s += ink(rect(x, y, w, h)) + (o.crenels !== false ? ink(crenels(x - 0.6, x + w + 0.6, y), 1) : '');
  if (o.machicolation) s += ink(`M${f(x - 1)} ${f(y + 4)}L${f(x + w + 1)} ${f(y + 4)}` + Array.from({ length: Math.floor(w / 3) }, (_, i) => `M${f(x + 1.5 + i * 3)} ${f(y + 4)}l0 2.4`).join(''), 0.7);
  const win = o.windows ?? Math.max(1, Math.floor(h / 16));
  for (let i = 0; i < win; i++) s += windowSlit(x + w / 2 - 0.8, y + 8 + i * ((h - 14) / Math.max(1, win)));
  return s;
}

function roundTower(cx, r, h, o = {}) {
  const x = cx - r, y = -h;
  const c = o.color || PAL.brick;
  const body = `M${f(x)} ${f(y)}L${f(x)} 0Q${f(cx)} ${f(r * 0.35)} ${f(x + 2 * r)} 0L${f(x + 2 * r)} ${f(y)}Q${f(cx)} ${f(y + r * 0.35)} ${f(x)} ${f(y)}Z`;
  let s = wash(body, c);
  s += `<path d="${rect(cx + r * 0.25, y, r * 0.75, h)}" fill="${o.dark || PAL.brickDark}" fill-opacity=".45" filter="url(#acuarela)"/>`;
  s += `<path d="${rect(x + r * 0.2, y, r * 0.35, h)}" fill="#fff4dc" fill-opacity=".25" filter="url(#acuarela)"/>`;
  s += wash(crenels(x - 0.8, x + 2 * r + 0.8, y, 3.2, 3.6) + 'Z', c, 0.8);
  if (o.bands) for (let b = 1; b <= o.bands; b++) {
    const yy = y + (h * b) / (o.bands + 1);
    s += ink(`M${f(x)} ${f(yy)}Q${f(cx)} ${f(yy + r * 0.3)} ${f(x + 2 * r)} ${f(yy)}`, 0.6, 0.6);
  }
  s += courses(x + 1, y, 2 * r - 2, h, 4.6, 0.22);
  s += ink(body) + ink(crenels(x - 0.8, x + 2 * r + 0.8, y, 3.2, 3.6), 1);
  if (o.machicolation) s += ink(`M${f(x - 1.2)} ${f(y + 4.5)}Q${f(cx)} ${f(y + 6)} ${f(x + 2 * r + 1.2)} ${f(y + 4.5)}`, 0.9);
  const win = o.windows ?? Math.max(1, Math.floor(h / 18));
  for (let i = 0; i < win; i++) s += windowSlit(cx - 0.8 - r * 0.2, y + 9 + i * ((h - 16) / win));
  return s;
}

function curtain(x1, x2, h, o = {}) {
  const c = o.color || PAL.brick;
  let s = wash(rect(x1, -h, x2 - x1, h), c) + wash(crenels(x1, x2, -h, 3, 3) + 'Z', c, 0.75);
  if (o.texture !== false) s += courses(x1, -h, x2 - x1, h, 4, 0.22);
  s += `<path d="${rect(x1, -h * 0.35, x2 - x1, h * 0.35)}" fill="${o.dark || PAL.brickDark}" fill-opacity=".2" filter="url(#acuarela)"/>`;
  return s + ink(rect(x1, -h, x2 - x1, h)) + ink(crenels(x1, x2, -h, 3, 3), 0.9);
}

function ground(w, color = PAL.green) {
  const hw = w / 2 + 8;
  const d = `M${f(-hw)} 2Q${f(-hw * 0.5)} ${f(-4)} 0 ${f(-3)}Q${f(hw * 0.6)} ${f(-4.5)} ${f(hw)} 2Q0 7 ${f(-hw)} 2Z`;
  return wash(d, color, 0.55) + ink(`M${f(-hw + 3)} 2.5Q${f(-hw * 0.3)} 0.5 ${f(hw * 0.2)} 1.5T${f(hw - 3)} 2`, 0.8, 0.8);
}

function gableHouse(x, w, h, o = {}) {
  const roofH = w * 0.38;
  let s = wash(rect(x, -h, w, h), o.wall || PAL.wall, 0.95);
  s += wash(`M${f(x - 1)} ${f(-h)}L${f(x + w / 2)} ${f(-h - roofH)}L${f(x + w + 1)} ${f(-h)}Z`, o.roof || PAL.roof);
  s += shade(x, -h, w, h, 0.35, PAL.stoneDark, 0.3);
  s += ink(rect(x, -h, w, h), 0.9) + ink(`M${f(x - 1)} ${f(-h)}L${f(x + w / 2)} ${f(-h - roofH)}L${f(x + w + 1)} ${f(-h)}`, 0.9);
  if (o.door !== false) s += inkFill(rect(x + w * 0.4, -h * 0.45, w * 0.2, h * 0.45));
  return s;
}

// ————————————————————————————— dibujos propios de monumentos ——————————————
const SPECIFIC = {};
const META = {};

// Pinceles que reciben los dibujos propios (app/data/dibujos/*.js). R y HINT se leen al dibujar.
const brushes = () => ({ wash, ink, inkFill, rect, crenels, courses, shade, windowSlit, archDoor, squareTower,
  roundTower, curtain, ground, gableHouse, PAL, R: () => R(), j, f, HINT,
  pineTree, roundTree, mountain, townDrawing });

/** Registra un dibujo propio (función que recibe los pinceles y devuelve { body, w, h }). */
export function registerDrawing(id, fn, meta = {}) {
  SPECIFIC[id] = () => fn(brushes());
  META[id] = { id, nombre: meta.nombre || id, ...meta };
  if (!SPECIFIC_IDS.includes(id)) SPECIFIC_IDS.push(id);
}
export function drawingMeta(id) { return META[id] || null; }
export function allDrawingMeta() { return SPECIFIC_IDS.map((id) => META[id]); }

/**
 * Carga los dibujos propios desde app/data/dibujos/ (índice + módulos). En el navegador y en Node.
 * Un dibujo que falle no impide cargar los demás. @returns número de dibujos cargados
 */
export async function loadDrawings(baseUrl) {
  const base = new URL(baseUrl, globalThis.location ? globalThis.location.href : undefined);
  let index;
  if (base.protocol === 'file:') {
    const fs = await import('node:fs');
    index = JSON.parse(fs.readFileSync(new URL('indice.json', base), 'utf8'));
  } else {
    index = await (await fetch(new URL('indice.json', base), { cache: 'no-cache' })).json();
  }
  const stamp = base.protocol === 'file:' ? '' : `?v=${index.version || 1}-${(index.dibujos || []).length}-${Date.now() >> 16}`;
  let n = 0;
  await Promise.all((index.dibujos || []).map(async (d) => {
    try {
      const mod = await import(new URL(d.archivo, base).href + stamp);
      registerDrawing(d.id, mod.default, d);
      n++;
    } catch (e) { console.warn('No se pudo cargar el dibujo', d.id, e); }
  }));
  return n;
}

// ——————————————————————————————— dibujos tipológicos ————————————————————
const TYPOLOGICAL = {
  castillo() {
    let s = ground(110);
    s += curtain(-44, 44, 22);
    s += squareTower(-50, 13, 34) + squareTower(37, 13, 34);
    s += squareTower(-12, 24, 54, { machicolation: true });
    s += archDoor(-26, 6, 11);
    return { body: s, w: 120, h: 62 };
  },
  muralla() {
    let s = ground(120);
    const c = { color: PAL.stone, dark: PAL.stoneDark };
    s += curtain(-58, 58, 22, c);
    for (const x of [-48, -16, 16, 48]) s += roundTower(x, 6, 30, { ...c, windows: 0 });
    s += archDoor(0, 8, 15, false);
    return { body: s, w: 130, h: 38 };
  },
  puerta() {
    let s = ground(90);
    s += curtain(-40, -12, 20) + curtain(12, 40, 20);
    s += squareTower(-14, 28, 40, { windows: 0 });
    s += archDoor(0, 12, 24);
    return { body: s, w: 95, h: 48 };
  },
  // Iglesia parroquial con variantes (misma población → mismo dibujo):
  // torre a un lado o espadaña, remate de la torre, ábside, pórtico y material.
  iglesia() {
    const brick = HINT.material === 'brick' || (HINT.material !== 'stone' && R() < 0.3);
    const c = brick ? { color: '#c98a60', dark: '#93583c' } : { color: R() < 0.5 ? PAL.stone : '#d6c6a0', dark: PAL.stoneDark };
    const left = R() < 0.65, espadana = R() < 0.25;
    const navW = 44 + Math.round(R() * 14), navH = 20 + Math.round(R() * 6);
    const x0 = left ? -navW / 2 + 8 : -navW / 2 - 8;
    let s = ground(110);
    // nave con tejado a dos aguas
    s += wash(rect(x0, -navH, navW, navH), c.color) + shade(x0, -navH, navW, navH, 0.32, c.dark, 0.3);
    if (brick) s += courses(x0, -navH, navW, navH, 3.6, 0.2);
    s += wash(`M${x0 - 2} ${-navH}L${x0 + navW / 2} ${-navH - 10}L${x0 + navW + 2} ${-navH}Z`, PAL.roof) + ink(`M${x0 - 2} ${-navH}L${x0 + navW / 2} ${-navH - 10}L${x0 + navW + 2} ${-navH}`) + ink(rect(x0, -navH, navW, navH));
    // ábside semicircular (románico) o cabecera recta
    const ax = left ? x0 + navW : x0;
    const dir = left ? 1 : -1;
    if (R() < 0.6) {
      const ap = `M${ax} 0L${ax} ${-navH + 4}Q${ax + dir * 13} ${-navH + 4} ${ax + dir * 14} ${-navH / 2}L${ax + dir * 14} 0Z`;
      s += wash(ap, c.color) + ink(ap) + ink(`M${ax} ${-navH + 4}Q${ax + dir * 13} ${-navH - 2} ${ax + dir * 14} ${-navH / 2}`, 0.8);
      s += inkFill(`M${ax + dir * 6} -6l0 -6q1 -2 2 0l0 6Z`, '#5a4636');
    }
    // ventanas de la nave
    for (let i = 1; i <= 2; i++) s += inkFill(`M${x0 + (navW * i) / 3 - 1.5} ${-navH + 13}l0 -6q1.5 -3 3 0l0 6Z`, '#5a4636');
    // pórtico con arcos a veces
    if (R() < 0.35) {
      const px = x0 + navW * 0.15, pw = navW * 0.7;
      s += wash(rect(px, -9, pw, 9), c.color) + wash(`M${px - 1} -9L${px + pw + 1} -9L${px + pw} -12L${px} -12Z`, PAL.roof) + ink(rect(px, -9, pw, 9));
      const n = Math.max(3, Math.round(pw / 7));
      for (let i = 0; i < n; i++) s += inkFill(`M${px + 1.2 + (i * pw) / n} 0l0 -5q${pw / n / 2 - 1.2} -3.5 ${pw / n - 2.4} 0l0 5Z`, '#6b5644');
    } else {
      s += archDoor(x0 + navW / 2, 7, 13, !brick && R() < 0.5);
    }
    const tx = left ? x0 - 15 : x0 + navW;
    if (espadana) {
      // espadaña: muro campanario con dos o tres vanos
      const ex = left ? x0 - 2 : x0 + navW - 16, ew = 18, eh = navH + 22;
      const d = `M${ex} ${-navH + 2}L${ex} ${-eh}L${ex + ew / 2} ${-eh - 7}L${ex + ew} ${-eh}L${ex + ew} ${-navH + 2}Z`;
      s += wash(d, c.color) + ink(d);
      const nv = R() < 0.5 ? 2 : 3;
      for (let i = 0; i < nv; i++) s += inkFill(`M${ex + 2.5 + i * ((ew - 5) / nv)} ${-eh + 12}l0 -7q${(ew - 5) / nv / 2 - 1} -4 ${(ew - 5) / nv - 2} 0l0 7Z`, '#3a2a1e');
    } else {
      const th = navH + 28 + Math.round(R() * 14);
      s += squareTower(tx, 15, th, { ...c, windows: 0, texture: brick, crenels: false });
      // campanas
      s += inkFill(`M${tx + 4} ${-th + 14}l0 -6q3.5 -4 7 0l0 6Z`, '#3a2a1e');
      // remate: tejadillo piramidal, chapitel, almenas o campanario con cúpula
      const top = Math.floor(R() * 4);
      if (top === 0) s += wash(`M${tx - 1} ${-th}L${tx + 7.5} ${-th - 9}L${tx + 16} ${-th}Z`, PAL.roof) + ink(`M${tx - 1} ${-th}L${tx + 7.5} ${-th - 9}L${tx + 16} ${-th}`);
      else if (top === 1) s += wash(`M${tx + 1} ${-th}L${tx + 7.5} ${-th - 20}L${tx + 14} ${-th}Z`, '#8e8c84') + ink(`M${tx + 1} ${-th}L${tx + 7.5} ${-th - 20}L${tx + 14} ${-th}M${tx + 7.5} ${-th - 20}l0 -4`);
      else if (top === 2) s += wash(crenels(tx - 0.6, tx + 15.6, -th) + 'Z', c.color, 0.8) + ink(crenels(tx - 0.6, tx + 15.6, -th), 0.9);
      else s += wash(`M${tx + 2} ${-th}Q${tx + 7.5} ${-th - 11} ${tx + 13} ${-th}Z`, '#8e8c84') + ink(`M${tx + 2} ${-th}Q${tx + 7.5} ${-th - 11} ${tx + 13} ${-th}M${tx + 7.5} ${-th - 8}l0 -4`);
      // cigüeñal, tan castellano
      if (R() < 0.35) s += wash(`M${tx + 3} ${-th - (top === 1 ? 0 : 2)}q4.5 -3 9 0Z`, '#6b5644', 0.9) + ink(`M${tx + 7} ${-th - 3}l2 -5l1.5 1`, 0.8);
    }
    return { body: s, w: 115, h: navH + 60 };
  },
  ermita() {
    let s = ground(70);
    const c = HINT.material === 'brick' ? '#d8a27c' : '#efe4c9';
    s += gableHouse(-18, 30, 16, { wall: c });
    if (R() < 0.5) {
      s += wash('M10 -22L10 -34L18 -34L18 -22Z', PAL.stone) + ink('M10 -22L10 -34L14 -38L18 -34L18 -22') + inkFill('M12.5 -26l0 -4q1.5 -2 3 0l0 4Z');
    } else {
      // espadaña de un vano sobre el hastial
      s += wash('M-21 -16L-21 -30L-17 -34L-13 -30L-13 -16Z', PAL.stone) + ink('M-21 -16L-21 -30L-17 -34L-13 -30L-13 -16') + inkFill('M-18.5 -24l0 -4q1.5 -2 3 0l0 4Z', '#3a2a1e');
    }
    if (R() < 0.4) s += wash('M-14 0L-14 -9L14 -9L14 0', '#bfae88', 0.6) + ink('M-16 -9L16 -9M-12 0L-12 -9M0 0L0 -9M12 0L12 -9', 0.7);
    return { body: s, w: 75, h: 40 };
  },
  catedral() {
    let s = ground(120);
    const c = { color: PAL.stone, dark: PAL.stoneDark };
    s += wash(rect(-28, -34, 56, 34), c.color) + ink(rect(-28, -34, 56, 34));
    s += wash('M-30 -34L0 -50L30 -34Z', PAL.roof) + ink('M-30 -34L0 -50L30 -34');
    s += squareTower(-46, 18, 64, { ...c, windows: 2, texture: false }) + squareTower(28, 18, 64, { ...c, windows: 2, texture: false });
    s += inkFill('M-6 -30a6 6 0 1 1 12 0a6 6 0 1 1 -12 0', '#5a4636');
    s += archDoor(0, 10, 20);
    return { body: s, w: 125, h: 72 };
  },
  monasterio() {
    let s = ground(130);
    const c = { color: PAL.stone, dark: PAL.stoneDark };
    s += wash(rect(-58, -22, 70, 22), c.color) + ink(rect(-58, -22, 70, 22));
    for (let i = 0; i < 7; i++) s += inkFill(`M${-54 + i * 10} 0l0 -9q3 -4 6 0l0 9Z`, '#6b5644');
    s += wash('M-60 -22L-23 -30L14 -22Z', PAL.roof) + ink('M-60 -22L-23 -30L14 -22');
    s += wash(rect(10, -32, 40, 32), c.color) + wash('M8 -32L30 -44L52 -32Z', PAL.roof) + ink(rect(10, -32, 40, 32)) + ink('M8 -32L30 -44L52 -32');
    s += squareTower(46, 13, 54, { ...c, windows: 1, texture: false });
    s += archDoor(30, 8, 15);
    return { body: s, w: 135, h: 60 };
  },
  palacio() {
    let s = ground(110);
    const c = { color: PAL.stone, dark: PAL.stoneDark };
    s += wash(rect(-36, -30, 72, 30), c.color) + shade(-36, -30, 72, 30, 0.3, c.dark, 0.25) + ink(rect(-36, -30, 72, 30));
    for (let i = 0; i < 5; i++) s += inkFill(rect(-30 + i * 13, -24, 5, 7), '#6b5644');
    s += squareTower(-48, 14, 42, { ...c, windows: 1, texture: false }) + squareTower(34, 14, 42, { ...c, windows: 1, texture: false });
    s += archDoor(0, 8, 14, false) + ink('M-6 -18l12 0', 0.7);
    return { body: s, w: 115, h: 50 };
  },
  torre() {
    let s = ground(50);
    s += squareTower(-9, 18, 52, { machicolation: true, windows: 2 });
    return { body: s, w: 55, h: 58 };
  },
  puente() {
    let s = wash('M-60 0Q0 6 60 0L60 6Q0 12 -60 6Z', PAL.water, 0.7);
    const c = PAL.stone;
    s += wash('M-58 -16L58 -16L58 -10L-58 -10Z', c);
    let d = 'M-58 -16L58 -16';
    for (const [cx, r] of [[-36, 10], [-10, 12], [16, 12], [42, 10]]) {
      s += `<path d="M${cx - r} 2L${cx - r} -4A${r} ${r} 0 0 1 ${cx + r} -4L${cx + r} 2" fill="${c}" fill-opacity=".001"/>`;
      d += `M${cx - r} 2L${cx - r} -4A${r} ${r} 0 0 1 ${cx + r} -4L${cx + r} 2`;
    }
    s += wash('M-58 -10L-58 2L-46 2L-46 -4A10 10 0 0 1 -26 -4L-26 2L-22 2L-22 -4A12 12 0 0 1 2 -4L2 2L4 2L4 -4A12 12 0 0 1 28 -4L28 2L32 2L32 -4A10 10 0 0 1 52 -4L52 2L58 2L58 -10Z', c);
    s += ink(d) + ink('M-58 -10L58 -10M-58 -16L-58 2M58 -16L58 2');
    return { body: s, w: 125, h: 20 };
  },
  ruinas() {
    let s = ground(90);
    const c = { color: PAL.stone, dark: PAL.stoneDark };
    s += wash('M-36 0L-36 -22L-30 -26L-26 -18L-20 -20L-20 0Z', c.color) + ink('M-36 0L-36 -22L-30 -26L-26 -18L-20 -20L-20 0');
    s += wash('M-14 0L-14 -14L-6 -10L2 -16L8 -8L8 0Z', c.color) + ink('M-14 0L-14 -14L-6 -10L2 -16L8 -8L8 0');
    s += squareTower(14, 14, 34, { ...c, windows: 1, texture: false });
    s += ink('M14 -34l4 -3l3 3l4 -4l3 4', 0.9);
    return { body: s, w: 90, h: 40 };
  },
  museo() {
    let s = ground(90);
    const c = PAL.stone;
    s += wash(rect(-30, -30, 60, 24), PAL.stoneDark, 0.45);
    s += wash(rect(-36, -6, 72, 6), c) + ink(rect(-36, -6, 72, 6)) + ink('M-34 -3l68 0', 0.5);
    for (const x of [-27, -13, 7, 21]) s += wash(rect(x, -30, 6, 24), c) + ink(rect(x, -30, 6, 24), 0.9);
    s += archDoor(0, 7, 14, false);
    s += wash(rect(-34, -35, 68, 5), c) + ink(rect(-34, -35, 68, 5));
    s += wash('M-36 -35L0 -48L36 -35Z', c) + ink('M-36 -35L0 -48L36 -35Z');
    return { body: s, w: 95, h: 50 };
  },
  yacimiento() {
    let s = ground(70);
    for (const [x, h] of [[-24, 10], [-12, 14], [0, 9], [12, 13], [22, 8]]) s += wash(rect(x, -h, 7, h), PAL.stone) + ink(rect(x, -h, 7, h), 0.8);
    s += wash('M-26 -10L-5 -15L-5 -13L-26 -8Z', PAL.stoneDark, 0.7);
    return { body: s, w: 70, h: 20 };
  },
  monumento() {
    let s = ground(40);
    s += wash('M-10 0L-10 -6L10 -6L10 0Z', PAL.stone) + ink('M-10 0L-10 -6L10 -6L10 0');
    s += wash('M-4 -6L-2.5 -34L0 -38L2.5 -34L4 -6Z', PAL.stone) + ink('M-4 -6L-2.5 -34L0 -38L2.5 -34L4 -6Z');
    return { body: s, w: 40, h: 40 };
  },
};
TYPOLOGICAL.acueducto = () => (SPECIFIC['acueducto-segovia'] || TYPOLOGICAL.muralla)();

export function hasSpecific(id) { return Object.prototype.hasOwnProperty.call(SPECIFIC, id); }
export const SPECIFIC_IDS = [];
export const TYPOLOGICAL_IDS = Object.keys(TYPOLOGICAL);

/** Dibujo de un monumento. Usa el propio si existe; si no, el de su tipología. */
export function monumentDrawing(illustrationId, kind, seed = 1, hint = {}) {
  R = rng(seed);
  HINT = hint || {};
  const fn = SPECIFIC[illustrationId] || TYPOLOGICAL[illustrationId] || TYPOLOGICAL[kind] || TYPOLOGICAL.monumento;
  return fn();
}

// ——————————————————————————————— caserío genérico ————————————————————
export function townDrawing(place, seed = 1) {
  R = rng(seed);
  const n = { city: 6, town: 5, village: 3, hamlet: 2 }[place] || 3;
  let s = '';
  let x = -n * 5.5;
  const items = [];
  for (let i = 0; i < n; i++) {
    const w = 8 + R() * 5, h = 6 + R() * 5;
    items.push([x, w, h]);
    x += w - 1.5;
  }
  const off = -(x + items[0][0]) / 2;
  s += wash(`M${f(items[0][0] + off - 4)} 1Q0 -3 ${f(x + off + 4)} 1Q0 5 ${f(items[0][0] + off - 4)} 1Z`, PAL.green, 0.45);
  items.forEach(([hx, w, h], i) => { s += gableHouse(hx + off, w, h, { door: i % 2 === 0 }); });
  return { body: s, w: x - items[0][0] + 8, h: 16 };
}

// ——————————————————————————————— naturaleza ————————————————————————
export function pineTree(x, y, sc = 1, seed = 1) {
  R = rng(seed);
  const w = (13 + R() * 5) * sc, h = (7 + R() * 2.5) * sc;
  const crown = `M${f(x - w / 2)} ${f(y - h + 2 * sc)}Q${f(x - w / 2 - 1)} ${f(y - h - 2 * sc)} ${f(x - w / 4)} ${f(y - h - 2.5 * sc)}Q${f(x)} ${f(y - h - 4.5 * sc)} ${f(x + w / 4)} ${f(y - h - 2.6 * sc)}Q${f(x + w / 2 + 1.5)} ${f(y - h - 2 * sc)} ${f(x + w / 2)} ${f(y - h + 1.5 * sc)}Q${f(x)} ${f(y - h + 3.5 * sc)} ${f(x - w / 2)} ${f(y - h + 2 * sc)}Z`;
  const col = R() > 0.5 ? PAL.pine : PAL.pineDark;
  if (DS.looseTrees) return `<g class="arbol"><path d="M${f(x)} ${f(y)}L${f(x + 0.4)} ${f(y - h + 2.5 * sc)}" stroke="${PAL.trunk}" stroke-opacity=".7" stroke-width="${f(1 * sc)}" stroke-linecap="round"/><path d="${crown}" fill="${col}" fill-opacity=".7" filter="url(#acuarela)"/></g>`;
  return `<g class="arbol">${wash(crown, col, 0.85)}<path d="M${f(x)} ${f(y)}L${f(x + 0.4)} ${f(y - h + 2.5 * sc)}" stroke="${PAL.trunk}" stroke-width="${f(1.2 * sc)}" stroke-linecap="round"/>${ink(crown, 0.6 * sc, 0.75)}</g>`;
}

export function roundTree(x, y, sc = 1, seed = 1) {
  R = rng(seed);
  const r = (4 + R() * 2) * sc;
  const crown = `M${f(x - r)} ${f(y - r - 3 * sc)}a${f(r)} ${f(r * 1.05)} 0 1 1 ${f(2 * r)} 0a${f(r)} ${f(r * 1.05)} 0 1 1 ${f(-2 * r)} 0Z`;
  const col = R() > 0.5 ? PAL.green : PAL.greenDark;
  if (DS.looseTrees) return `<g class="arbol"><path d="M${f(x)} ${f(y)}L${f(x)} ${f(y - 3.5 * sc)}" stroke="${PAL.trunk}" stroke-opacity=".7" stroke-width="${f(1 * sc)}"/><path d="${crown}" fill="${col}" fill-opacity=".7" filter="url(#acuarela)"/></g>`;
  return `<g class="arbol"><path d="M${f(x)} ${f(y)}L${f(x)} ${f(y - 3.5 * sc)}" stroke="${PAL.trunk}" stroke-width="${f(1.1 * sc)}"/>${wash(crown, col, 0.85)}${ink(crown, 0.55 * sc, 0.7)}</g>`;
}

export function mountain(x, y, sc = 1, seed = 1) {
  R = rng(seed);
  const w = (34 + R() * 10) * sc, h = (22 + R() * 8) * sc;
  const d = `M${f(x - w / 2)} ${f(y)}L${f(x - w * 0.12)} ${f(y - h * 0.82)}L${f(x)} ${f(y - h)}L${f(x + w * 0.18)} ${f(y - h * 0.7)}L${f(x + w / 2)} ${f(y)}Z`;
  const shadeD = `M${f(x)} ${f(y - h)}L${f(x + w * 0.18)} ${f(y - h * 0.7)}L${f(x + w / 2)} ${f(y)}L${f(x + w * 0.05)} ${f(y)}Z`;
  let hatch = '';
  for (let i = 1; i < 6; i++) hatch += `M${f(x + w * 0.04 * i)} ${f(y - h + h * 0.18 * i)}l${f(w * 0.06)} ${f(h * 0.08)}`;
  return `<g class="monte">${wash(d, PAL.mountain, 0.75)}${wash(shadeD, PAL.stoneDark, 0.45)}${ink(`M${f(x - w / 2)} ${f(y)}L${f(x - w * 0.12)} ${f(y - h * 0.82)}L${f(x)} ${f(y - h)}L${f(x + w * 0.18)} ${f(y - h * 0.7)}L${f(x + w / 2)} ${f(y)}`, 0.9)}${ink(hatch, 0.5, 0.7)}</g>`;
}

// Puerto de montaña: dos lomas con el collado entre ellas y el banderín del puerto.
export function mountainPass(x, y, sc = 1, seed = 1, onRoute = false) {
  R = rng(seed);
  const w = 30 * sc, h = 15 * sc;
  const d = `M${f(x - w / 2)} ${f(y)}Q${f(x - w * 0.36)} ${f(y - h)} ${f(x - w * 0.18)} ${f(y - h * 0.95)}Q${f(x - w * 0.06)} ${f(y - h * 0.55)} ${f(x)} ${f(y - h * 0.5)}Q${f(x + w * 0.06)} ${f(y - h * 0.55)} ${f(x + w * 0.18)} ${f(y - h * 0.95)}Q${f(x + w * 0.36)} ${f(y - h)} ${f(x + w / 2)} ${f(y)}Z`;
  const top = y - h * 0.5, pole = 11 * sc;
  let s = `<g class="puerto">${wash(d, PAL.mountain, 0.7)}${wash(`M${f(x)} ${f(top)}Q${f(x + w * 0.06)} ${f(y - h * 0.55)} ${f(x + w * 0.18)} ${f(y - h * 0.95)}Q${f(x + w * 0.36)} ${f(y - h)} ${f(x + w / 2)} ${f(y)}L${f(x)} ${f(y)}Z`, PAL.stoneDark, 0.35)}`;
  s += ink(d.slice(0, -1), 1.1);
  s += ink(`M${f(x)} ${f(top)}L${f(x)} ${f(top - pole)}`, onRoute ? 1.4 : 0.9);
  s += inkFill(`M${f(x)} ${f(top - pole)}L${f(x + 9 * sc)} ${f(top - pole + 2.8 * sc)}L${f(x)} ${f(top - pole + 5.6 * sc)}Z`, onRoute ? PAL.roof : PAL.brickLight);
  return s + '</g>';
}

export function compassRose(cx, cy, r) {
  const p = (a, rr) => [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr];
  let s = `<g class="rosa">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="none" stroke="${PAL.ink}" stroke-width=".8"/><circle cx="${cx}" cy="${cy}" r="${r * 0.78}" fill="none" stroke="${PAL.ink}" stroke-width=".4"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, big = i % 2 === 0;
    const L = big ? r : r * 0.6, wd = big ? r * 0.16 : r * 0.1;
    const tip = p(a, L), l = p(a - Math.PI / 2, wd), rr = p(a + Math.PI / 2, wd);
    s += `<path d="M${f(cx)} ${f(cy)}L${f(l[0])} ${f(l[1])}L${f(tip[0])} ${f(tip[1])}Z" fill="${big ? '#b23a2a' : PAL.stone}" fill-opacity=".9" stroke="${PAL.ink}" stroke-width=".6"/>`;
    s += `<path d="M${f(cx)} ${f(cy)}L${f(rr[0])} ${f(rr[1])}L${f(tip[0])} ${f(tip[1])}Z" fill="${big ? '#f1e6cf' : PAL.wall}" stroke="${PAL.ink}" stroke-width=".6"/>`;
  }
  const n = p(0, r + 9);
  s += `<text x="${f(n[0])}" y="${f(n[1])}" text-anchor="middle" font-family="EtbFell SC, serif" font-size="${f(r * 0.42)}" fill="${PAL.ink}">N</text></g>`;
  return s;
}

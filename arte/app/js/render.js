import { VERSION } from './version.js';
// Composición del mapa ilustrado en SVG.
// La ruta se escribe vértice a vértice desde los puntos GPX proyectados (sin
// simplificar, suavizar ni unir segmentos). El resto de capas se adapta a ella.
import { allSegments } from './gpx.js';
import { bboxOf, expandBbox, makeProjection, profileOf, elevationStats, haversine, pointInPolygon, rng, hashString, nearestOnRoute } from './geo.js';
import { PX_DECIMALS } from './integrity.js';
import { chosenMonument } from './heritage.js';
import { monumentDrawing, townDrawing, pineTree, roundTree, mountain, mountainPass, compassRose, PAL, setDrawStyle } from './illustrations.js';
import { KIND_LABEL } from './osm.js';
import { seaRings } from './coast.js';
import { fontFor } from './fonts.js';
import { computeStages, stageRoute, campina, titleBlock, stageProfiles, sidePanel, numberBadge, wrap, setTextWidth, setBadgeText } from './guide.js';

export const FORMATS = {
  a3v: { label: 'A3 vertical', w: 1188, h: 1680 },
  a3h: { label: 'A3 horizontal', w: 1680, h: 1188 },
  cuadrado: { label: 'Cuadrado (redes)', w: 1400, h: 1400 },
  panoramico: { label: 'Panorámico', w: 1800, h: 1000 },
};


// Estilos artísticos. Solo cambian la capa decorativa: la ruta se escribe siempre igual.
export const STYLES = {
  acuarela: {
    label: 'Acuarela húmeda', desc: 'Aguadas que desbordan la línea, bordes con pigmento acumulado y manchas de color sobre papel de grano grueso.',
    paper: '#f6efdf', field: '#ecdcb6', wet: true, blooms: true, bleed: true, vignette: .2,
    draw: { inkOpacity: .72, inkWidth: .85, washOpacity: .82, bleedWash: true, looseTrees: true },
    trees: 900, woodWash: .5, riverWash: 13, layerFilter: null, relief: .85,
  },
  tinta: {
    label: 'Tinta y aguada', desc: 'Dibujo a plumilla nítido con aguadas planas, estilo cartela clásica.',
    paper: '#f3ead6', field: '#e9dcb9', wet: false, blooms: false, bleed: false, vignette: .28,
    draw: { inkOpacity: 1, inkWidth: 1, washOpacity: .88, bleedWash: false, looseTrees: false },
    trees: 2200, woodWash: .32, riverWash: 7, layerFilter: null, relief: .6,
  },
  sepia: {
    label: 'Grabado sepia', desc: 'Monocromo en tonos tierra, como un mapa antiguo; la ruta conserva su color.',
    paper: '#efe2c4', field: '#e3d1a8', wet: false, blooms: false, bleed: false, vignette: .38,
    draw: { inkOpacity: 1, inkWidth: 1.05, washOpacity: .8, bleedWash: false, looseTrees: false },
    trees: 2000, woodWash: .3, riverWash: 6, layerFilter: 'sepia', relief: .75,
  },
  cuaderno: {
    label: 'Cuaderno de viaje', desc: 'Lápiz suave y toques de color ligeros sobre papel blanco, como un apunte en ruta.',
    paper: '#fbf8f1', field: '#f1ead9', wet: true, blooms: false, bleed: false, vignette: 0,
    draw: { inkOpacity: .5, inkWidth: .75, washOpacity: .55, bleedWash: true, looseTrees: true },
    trees: 700, woodWash: .28, riverWash: 8, layerFilter: null, relief: .45,
  },
  // ——— estilos contemporáneos: sin papel envejecido ni pintura; paleta, letra y trazo propios.
  // Los dibujos de los monumentos se recolorean solos a la paleta del estilo (ver restyle). ———
  minimal: {
    label: 'Minimalista', modern: true,
    desc: 'Fondo limpio, dibujos de línea fina en grises y la ruta como único color. Letra sans en mayúsculas espaciadas.',
    paper: '#f7f6f2', field: null, wet: false, blooms: false, bleed: false, vignette: 0, texture: false, frame: 'single',
    draw: { inkOpacity: .9, inkWidth: .72, washOpacity: .95, bleedWash: false, looseTrees: false,
      pal: { ink: '#26282b', water: '#cddbe4', waterDark: '#8ea8b8', green: '#dfe4d5', greenDark: '#b9c2ad', stoneDark: '#b4b3ac', mountain: '#e2e0da', roof: '#26282b' } },
    recolor: { mode: 'ramp', dark: '#b9b8b1', light: '#ffffff', gamma: .55, ink: '#26282b' },
    trees: 0, woodWash: .85, riverWash: 5, layerFilter: null, relief: .3, reliefFilter: 'img-gris',
    colors: { sea: '#d6e3ea', urban: '#e8e5de', wetland: '#d4e0da', profile: '#e2e0da', road: '#ffffff', dot: '#ffffff', monGround: null },
    filters: 'clean', compass: 'arrow', peaks: 'triangle', caps: true, imageFilter: 'img-gris',
    stageColors: ['#2f3a5c', '#8796a5', '#c99a2e', '#5b8c6f', '#a05a7a'],
    suggest: { font_rotulos: 'grotesk', font_mano: 'inter', font_texto: 'inter', routeColor: 'coral' },
  },
  plano: {
    label: 'Plano contemporáneo', modern: true,
    desc: 'Ilustración plana de colores sólidos (terracota, arena, salvia y azul profundo), sin texturas, al estilo de un póster actual.',
    paper: '#f4eee3', field: null, wet: false, blooms: false, bleed: false, vignette: 0, texture: false, frame: 'single',
    draw: { inkOpacity: .5, inkWidth: .6, washOpacity: 1, bleedWash: false, looseTrees: false,
      pal: { ink: '#2f3550', water: '#a7cbd9', waterDark: '#5f8ea6', green: '#b7d0bc', greenDark: '#6f9a82', stoneDark: '#b9a58b', mountain: '#ead9bd', roof: '#e07a5f' } },
    recolor: { mode: 'palette', colors: ['#e07a5f', '#c4664a', '#f2cc8f', '#e9b872', '#81b29a', '#5f8a72', '#9cc5d6', '#3d405b', '#f8f3e8', '#e8dcc8'], ink: '#2f3550' },
    trees: 0, woodWash: .9, riverWash: 6, layerFilter: null, relief: .32, reliefFilter: null,
    colors: { sea: '#a7cbd9', urban: '#ecd8c0', wetland: '#bcd5c9', profile: '#f2cc8f', road: '#fbf7ef', dot: '#fbf7ef', monGround: null },
    filters: 'clean', compass: 'arrow', peaks: 'triangle', caps: true, imageFilter: 'img-plano',
    stageColors: ['#3d405b', '#e07a5f', '#5f9a7e', '#e9a03b', '#5e8ca3'],
    suggest: { font_rotulos: 'syne', font_mano: 'inter', font_texto: 'inter', routeColor: 'marino' },
  },
  noche: {
    label: 'Nocturno', modern: true,
    desc: 'Fondo azul noche con dibujos de línea clara y la ruta luminosa. Muy gráfico, para pantalla o un póster oscuro.',
    paper: '#15202b', field: null, wet: false, blooms: false, bleed: false, vignette: 0, texture: false, frame: 'single',
    draw: { inkOpacity: .92, inkWidth: .72, washOpacity: .95, bleedWash: false, looseTrees: false,
      pal: { ink: '#efe7d6', water: '#2a4a66', waterDark: '#79a6c4', green: '#1d3433', greenDark: '#3f6b5e', stoneDark: '#5f6f7d', mountain: '#26384a', roof: '#efe7d6', door: '#0e1720' } },
    recolor: { mode: 'ramp', dark: '#0f1822', light: '#273a4f', gamma: 1, ink: '#efe7d6' },
    trees: 0, woodWash: .95, riverWash: 5, layerFilter: null, relief: .55, reliefFilter: null,
    colors: { sea: '#1c3550', urban: '#1f2e3d', wetland: '#1c3636', profile: '#273a4f', road: '#15202b', dot: '#15202b', monGround: null },
    filters: 'clean', compass: 'arrow', peaks: 'triangle', caps: true, imageFilter: 'img-noche', glow: true,
    stageColors: ['#4fd1c5', '#f472b6', '#a3e635', '#93c5fd', '#fdba74'],
    suggest: { font_rotulos: 'grotesk', font_mano: 'inter', font_texto: 'inter', routeColor: 'ambar' },
  },
  riso: {
    label: 'Risografía', modern: true,
    desc: 'Impresión de tintas planas (rosa flúor, azul, amarillo y verde) con grano y un leve desajuste de registro, como un fanzine o un cartel de serigrafía.',
    paper: '#f3efe6', field: null, wet: false, blooms: false, bleed: false, vignette: 0, texture: false, frame: 'single',
    draw: { inkOpacity: .85, inkWidth: .8, washOpacity: .92, bleedWash: false, looseTrees: false,
      pal: { ink: '#1d4e9e', water: '#7fb8e0', waterDark: '#0078bf', green: '#9fd8b6', greenDark: '#00a95c', stoneDark: '#8fa3c7', mountain: '#f9d7e8', roof: '#ff48b0' } },
    recolor: { mode: 'palette', colors: ['#ff48b0', '#ff8fcd', '#ffc4e3', '#0078bf', '#66aedb', '#b3d6ee', '#ffe800', '#fff38c', '#00a95c', '#80d4ad', '#f3efe6'], ink: '#1d4e9e' },
    trees: 0, woodWash: .75, riverWash: 6, layerFilter: null, relief: .3, reliefFilter: 'img-riso',
    colors: { sea: '#7fb8e0', urban: '#ffd1e8', wetland: '#a9dcc4', profile: '#ffc4e3', road: '#f3efe6', dot: '#f3efe6', monGround: null },
    filters: 'riso', compass: 'arrow', peaks: 'triangle', caps: true, imageFilter: 'img-riso',
    stageColors: ['#0078bf', '#00a95c', '#ffb000', '#ff48b0', '#765ba7'],
    suggest: { font_rotulos: 'grotesk', font_mano: 'mono', font_texto: 'mono', routeColor: 'rosa' },
  },
};
// Colores de capas del mapa que no salen de la paleta de los dibujos (estilos clásicos).
const BASE_COLORS = { sea: '#8fbcd2', urban: '#d6a578', wetland: '#8fb3a0', profile: '#b9a27c', road: '#f6eedc', dot: '#fbf6ea', monGround: 'auto' };
let C = BASE_COLORS;
/** Tipografías y color de ruta propios de cada estilo (para la interfaz). */
export const CLASSIC_SUGGEST = { font_rotulos: 'fell', font_mano: 'caveat', font_texto: 'fell', routeColor: 'carmin' };
function useStyle(style) {
  ST = STYLES[style] || STYLES.acuarela;
  C = { ...BASE_COLORS, ...(ST.colors || {}) };
  setDrawStyle(ST.draw);
}
let ST = STYLES.acuarela;

// ——— recoloreado de dibujos a la paleta de un estilo contemporáneo ———
const hexRgb = (h) => { h = h.slice(1); if (h.length === 3) h = h.replace(/./g, (c) => c + c); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const recolorCache = new Map();
function recolorFill(hex) {
  const rc = ST.recolor;
  const key = ST.label + hex;
  if (recolorCache.has(key)) return recolorCache.get(key);
  const c = hexRgb(hex);
  let out;
  if (rc.mode === 'ramp') {
    const t = Math.max(0, Math.min(1, (lum(c) - 0.12) / 0.8)) ** (rc.gamma || 1);
    out = rgbHex(mixRgb(hexRgb(rc.dark), hexRgb(rc.light), t));
  } else {
    // color de la paleta más parecido (distancia con peso perceptual aproximado)
    let best = null, bd = Infinity;
    for (const p of rc.colors) {
      const q = hexRgb(p), rm = (c[0] + q[0]) / 2;
      const d = (2 + rm / 256) * (c[0] - q[0]) ** 2 + 4 * (c[1] - q[1]) ** 2 + (2 + (255 - rm) / 256) * (c[2] - q[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    out = best;
  }
  recolorCache.set(key, out);
  return out;
}
/** Fondo de las miniaturas en los estilos contemporáneos (en Nocturno, el azul noche). */
export function thumbBackground() { return ST.modern ? ST.paper : null; }
/** Pasa un dibujo (SVG) a la paleta del estilo actual. En los estilos clásicos no cambia nada. */
export function restyle(body) {
  if (!ST.recolor || !body) return body;
  return body
    .replace(/fill="(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})"/g, (_, h) => `fill="${recolorFill(h)}"`)
    .replace(/stroke="(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})"/g, () => `stroke="${ST.recolor.ink}"`);
}
// filtros de pintura que los estilos limpios no usan (se quitan del SVG final: más nítido y rápido)
const PAINT_FILTERS = { clean: /acuarela|tinta|borde|relieve|sangrado|floracion|floracion-capa/, riso: /borde|relieve|sangrado|floracion|floracion-capa/ };
function stripPaint(svg) {
  const re = PAINT_FILTERS[ST.filters];
  if (!re) return svg;
  return svg.replace(/ filter="url\(#([a-z-]+)\)"/g, (m, id) => (re.test(id) && new RegExp(`^(${re.source})$`).test(id) ? '' : m));
}
/** Flecha de norte sobria para los estilos contemporáneos. */
function northArrow(cx, cy, r) {
  const k = r / 44;
  return `<g id="rosa"><path d="M${f1(cx)} ${f1(cy - 30 * k)}L${f1(cx + 9 * k)} ${f1(cy + 14 * k)}L${f1(cx)} ${f1(cy + 6 * k)}L${f1(cx - 9 * k)} ${f1(cy + 14 * k)}Z" fill="${PAL.ink}"/>`
    + `<text class="tit" x="${f1(cx)}" y="${f1(cy - 38 * k)}" text-anchor="middle" font-size="${f1(17 * k)}">N</text></g>`;
}
/** Cima como triángulo plano. */
function peakMark(x, y, sc) {
  const w = 7 * sc / 0.95, h = 9 * sc / 0.95;
  return `<path d="M${f1(x - w)} ${f1(y)}L${f1(x)} ${f1(y - h)}L${f1(x + w)} ${f1(y)}Z" fill="${PAL.ink}" fill-opacity=".85"/>`;
}

export const ROUTE_COLORS = {
  carmin: { label: 'Carmín', color: '#b1271d' },
  tinta: { label: 'Tinta negra', color: '#1d1814' },
  ocre: { label: 'Naranja ocre', color: '#d2691e' },
  coral: { label: 'Coral', color: '#ff5a4e' },
  marino: { label: 'Azul marino', color: '#2f3a5c' },
  azul: { label: 'Azul eléctrico', color: '#1f4fe0' },
  rosa: { label: 'Rosa flúor', color: '#ff3ea5' },
  ambar: { label: 'Ámbar luminoso', color: '#ffb020' },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n) => Math.round(n * 10) / 10;
const fx = (n) => Number(n.toFixed(PX_DECIMALS));

/** Filtros y patrones del estilo, para las miniaturas del selector de dibujo. */
export function thumbDefs(style) {
  useStyle(style);
  return defs('');
}

// Filtros para las acuarelas PNG y el relieve en los estilos contemporáneos (las acuarelas
// pasan a la paleta: grises, duotono de tinta o línea clara sobre fondo oscuro).
// El fondo claro de la acuarela se vuelve transparente (no depende de mix-blend-mode, que no se
// combina bien con filtros) y el resto pasa a la paleta: grises, duotono o colores planos.
const KNOCK = `<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.126 -7.152 -.722 0 9.3" result="ka"/><feComposite in="ka" in2="SourceAlpha" operator="in" result="mask"/>`;
function duotone(id, dark, light, stops = null) {
  const a = hexRgb(dark).map((v) => v / 255), b = hexRgb(light).map((v) => v / 255);
  const tv = (i) => (stops || [0, 1]).map((t) => (a[i] + (b[i] - a[i]) * t).toFixed(3)).join(' ');
  return `<filter id="${id}" color-interpolation-filters="sRGB">${KNOCK}<feColorMatrix in="SourceGraphic" type="matrix" values=".2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  0 0 0 1 0"/>`
    + `<feComponentTransfer result="col"><feFuncR type="table" tableValues="${tv(0)}"/><feFuncG type="table" tableValues="${tv(1)}"/><feFuncB type="table" tableValues="${tv(2)}"/></feComponentTransfer><feComposite in="col" in2="mask" operator="in"/></filter>`;
}
/** Mapa de degradado: la luminosidad de la imagen recorre los colores dados (oscuro → claro). */
function gradientMap(id, colors) {
  const cs = colors.map((c) => hexRgb(c).map((v) => (v / 255).toFixed(3)));
  const tv = (i) => cs.map((c) => c[i]).join(' ');
  return `<filter id="${id}" color-interpolation-filters="sRGB">${KNOCK}<feColorMatrix in="SourceGraphic" type="matrix" values=".2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  0 0 0 1 0"/>`
    + `<feComponentTransfer result="col"><feFuncR type="table" tableValues="${tv(0)}"/><feFuncG type="table" tableValues="${tv(1)}"/><feFuncB type="table" tableValues="${tv(2)}"/></feComponentTransfer><feComposite in="col" in2="mask" operator="in"/></filter>`;
}
function imageFilters() {
  // clásicos: solo se quita el fondo claro (la acuarela conserva sus colores)
  const clasico = `<filter id="img-clasico" color-interpolation-filters="sRGB">${KNOCK}<feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>`;
  if (!ST.modern) return clasico;
  return duotone('img-gris', '#2e2f31', '#ffffff', [0, .3, .72, 1])
    + duotone('img-noche', ST.draw.pal.ink, ST.paper, [0, .12, .4, .8, 1])
    + duotone('img-riso', '#0078bf', '#ffffff', [0, .3, .8, 1])
    + gradientMap('img-plano', ['#2f3550', '#3d405b', '#c4664a', '#e07a5f', '#f2cc8f', '#f2cc8f', '#f8f3e8'])
    + `<filter id="brillo" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5"/></filter>`;
}

function defs(fontCss, opts = {}) {
  const FR = fontFor('rotulos', opts).family, FM = fontFor('mano', opts).family, FT = fontFor('texto', opts).family;
  return `<defs>
<style>${fontCss || ''}
.lbl{font-family:'${FR}',serif;fill:${PAL.ink};paint-order:stroke;stroke:${ST.paper};stroke-width:4px;stroke-linejoin:round}
.mano{font-family:'${FM}',cursive;fill:${PAL.ink};paint-order:stroke;stroke:${ST.paper};stroke-width:3.5px;stroke-linejoin:round}
.rio{font-family:'${FT}',serif;font-style:italic;fill:${PAL.waterDark}}
.tit{font-family:'${FR}',serif;fill:${PAL.ink}}
.tx{font-family:'${FT}',serif;fill:${PAL.ink}}
.manoF{font-family:'${FM}',cursive}
.txF{font-family:'${FT}',serif}
${ST.caps ? `.lbl{text-transform:uppercase;letter-spacing:.16em}.tit{letter-spacing:.04em}` : ''}
</style>
${ST.filters === 'clean' ? `<filter id="acuarela"><feOffset/></filter><filter id="tinta"><feOffset/></filter>`
  : ST.filters === 'riso' ? `<filter id="acuarela" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="9" result="g"/>
  <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.75" result="ga"/>
  <feComposite in="SourceGraphic" in2="ga" operator="in"/>
</filter>
<filter id="tinta" x="-5%" y="-5%" width="110%" height="110%"><feOffset dx="1.3" dy=".7"/></filter>`
  : ST.wet ? `<filter id="acuarela" x="-15%" y="-15%" width="130%" height="130%">
  <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="3" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="1.1" result="b"/>
  <feMorphology in="b" operator="erode" radius="1.4" result="er"/>
  <feComposite in="b" in2="er" operator="out" result="edge"/>
  <feColorMatrix in="edge" type="matrix" values=".62 0 0 0 0  0 .62 0 0 0  0 0 .62 0 0  0 0 0 .75 0" result="edged"/>
  <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="9" result="g"/>
  <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.35" result="ga"/>
  <feComposite in="b" in2="ga" operator="in" result="tex"/>
  <feMerge><feMergeNode in="tex"/><feMergeNode in="edged"/></feMerge>
</filter>` : `<filter id="acuarela" x="-10%" y="-10%" width="120%" height="120%">
  <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="4" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation=".45" result="b"/>
  <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="9" result="g"/>
  <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.25" result="ga"/>
  <feComposite in="b" in2="ga" operator="in" result="tex"/>
  <feComponentTransfer in="tex"><feFuncA type="linear" slope="1.08"/></feComponentTransfer>
</filter>`}
${imageFilters()}
<filter id="floracion" x="-60%" y="-60%" width="220%" height="220%">
  <feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="4" seed="21" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="9" result="b"/>
  <feMorphology in="b" operator="erode" radius="6" result="er"/>
  <feComposite in="b" in2="er" operator="out" result="edge"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="edge"/></feMerge>
</filter>
<filter id="floracion-capa" x="-8%" y="-8%" width="116%" height="116%">
  <feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="4" seed="21" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="9" result="b"/>
  <feMorphology in="b" operator="erode" radius="6" result="er"/>
  <feComposite in="b" in2="er" operator="out" result="edge"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="edge"/></feMerge>
</filter>
<filter id="sangrado" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="13" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="2.4"/>
</filter>
<filter id="relieve" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="17" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation=".9"/>
</filter>
<filter id="sepia"><feColorMatrix type="matrix" values=".39 .77 .19 0 -.06  .35 .69 .17 0 -.07  .27 .53 .13 0 -.08  0 0 0 1 0"/></filter>
<filter id="tinta" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="1" seed="2" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale=".9" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="papel" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="3" seed="11" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .55  0 0 0 0 .45  0 0 0 0 .32  0 0 0 .09 0"/>
  <feComposite in2="SourceGraphic" operator="in"/>
</filter>
<filter id="manchas" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".004" numOctaves="4" seed="5" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .78  0 0 0 0 .66  0 0 0 0 .45  0 0 0 .55 -.18"/>
  <feComposite in2="SourceGraphic" operator="in"/>
</filter>
<filter id="borde" x="-2%" y="-2%" width="104%" height="104%">
  <feTurbulence type="fractalNoise" baseFrequency=".02" numOctaves="3" seed="3" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<pattern id="olas" width="46" height="26" patternUnits="userSpaceOnUse"><path d="M4 9q5-4 10 0t10 0M27 21q5-4 10 0t10 0" fill="none" stroke="${PAL.waterDark}" stroke-width=".8" stroke-linecap="round"/></pattern>
<radialGradient id="vineta" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#8a6a3c" stop-opacity="0"/><stop offset="100%" stop-color="#8a6a3c" stop-opacity="${ST.vignette}"/></radialGradient>
</defs>`;
}

/** Ilustración propia (PNG/SVG). Suelo en y = 0, centrada; en «multiply» el blanco del papel desaparece. */
function imageDrawing(img, mon) {
  let W = 130 * (mon.imageWidth || 1);
  let H = (W * img.h) / Math.max(1, img.w);
  if (H > 150 * (mon.imageWidth || 1)) { W *= (150 * (mon.imageWidth || 1)) / H; H = 150 * (mon.imageWidth || 1); }
  const href = esc(img.href);
  return {
    body: `<image href="${href}" xlink:href="${href}" x="${f1(-W / 2)}" y="${f1(-H)}" width="${f1(W)}" height="${f1(H)}" preserveAspectRatio="xMidYMax meet" filter="url(#${ST.imageFilter || 'img-clasico'})" style="mix-blend-mode:${ST.modern ? 'normal' : mon.blend || 'multiply'}"/>`,
    w: W, h: H,
  };
}

// Un filtro por capa en vez de uno por elemento: el ruido de los filtros va en coordenadas del
// dibujo, así que el aspecto es el mismo, pero el navegador lo calcula una vez y no cientos.
const AQ = ' filter="url(#acuarela)"', TN = ' filter="url(#tinta)"';
const pool = (inner, flt = 'acuarela') => (inner ? `<g filter="url(#${flt})">${inner}</g>` : '');
function poolTrees(trees, loose) {
  const a = [], t = [];
  const rest = trees.replace(/<path [^>]*\/>/g, (el) => {
    if (el.includes(AQ)) { a.push(el.replace(AQ, '')); return ''; }
    if (el.includes(TN)) { t.push(el.replace(TN, '')); return ''; }
    return el;
  });
  return loose ? rest + pool(a.join('')) + pool(t.join(''), 'tinta') : pool(a.join('')) + rest + pool(t.join(''), 'tinta');
}

function blooms(M, r) {
  const colors = ['#d9b77a', '#a9b886', '#d49a78', '#a9c4d1', '#c9b98f'];
  let s = '<g id="capa-manchas" filter="url(#floracion-capa)">';
  for (let i = 0; i < 16; i++) {
    const cx = M.x + r() * M.w, cy = M.y + r() * M.h;
    if (i > 13) break;
    const rx = M.w * (0.08 + r() * 0.16), ry = rx * (0.5 + r() * 0.5);
    s += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" transform="rotate(${f1(r() * 180)} ${f1(cx)} ${f1(cy)})" fill="${colors[i % colors.length]}" fill-opacity="${(0.12 + r() * 0.12).toFixed(2)}"/>`;
  }
  return s + '</g>';
}

/**
 * Coloca los nombres del perfil sin que se pisen.
 * Horizontal si caben en una fila; si no, vertical con separación mínima (≈ altura de letra),
 * repartiendo hacia los lados y, si ni así caben, dejando fuera los de menos prioridad.
 * @returns { mode: 'horizontal'|'vertical', placed: [{ text, x, lx, d }], dropped }
 */
export function layoutProfileLabels(items, { x0, x1, fs = 13 }) {
  const list = items.slice().sort((a, b) => a.x - b.x);
  const w = (t) => t.length * fs * 0.48;
  let fits = true;
  for (let i = 1; i < list.length; i++) if (list[i].x + 4 < list[i - 1].x + 4 + w(list[i - 1].text) + 8) { fits = false; break; }
  if (list.length && list[list.length - 1].x + 4 + w(list[list.length - 1].text) > x1 + 10) fits = false;
  if (fits) return { mode: 'horizontal', placed: list.map((t) => ({ ...t, lx: t.x })), dropped: 0 };
  const gap = fs * 1.05;
  let keep = list.slice();
  const maxN = Math.max(1, Math.floor((x1 - x0) / gap));
  if (keep.length > maxN) {
    const byPrio = keep.slice().sort((a, b) => b.prio - a.prio || a.x - b.x).slice(0, maxN);
    const ok = new Set(byPrio);
    keep = keep.filter((t) => ok.has(t));
  }
  // repartir: hacia la derecha lo justo y, si se sale, de vuelta hacia la izquierda
  const p = keep.map((t) => Math.min(Math.max(t.x, x0), x1));
  for (let i = 1; i < p.length; i++) p[i] = Math.max(p[i], p[i - 1] + gap);
  if (p.length && p[p.length - 1] > x1) p[p.length - 1] = x1;
  for (let i = p.length - 2; i >= 0; i--) p[i] = Math.min(p[i], p[i + 1] - gap);
  for (let i = 0; i < p.length; i++) if (p[i] < x0) p[i] = x0 + i * gap;
  return { mode: 'vertical', placed: keep.map((t, i) => ({ ...t, lx: p[i] })), dropped: list.length - keep.length };
}

function layoutFor(fmt, opts) {
  const { w, h } = FORMATS[fmt] || FORMATS.a3v;
  const m = Math.round(Math.min(w, h) * 0.035);
  const vertical = h >= w;
  if (opts.layout === 'guia') {
    const panelW = Math.round(w * (vertical ? 0.3 : 0.24));
    const profileH = opts.showProfile ? Math.round(h * (vertical ? 0.1 : 0.14)) : 0;
    const headH = Math.round(h * (vertical ? 0.1 : 0.13));
    const frame = { x: m, y: m, w: w - 2 * m, h: h - 2 * m };
    const colW = w - 2 * m - 24 - panelW;
    const head = { x: m + 12, y: m + 12, w: colW, h: headH };
    const map = { x: m + 12, y: head.y + headH + 8, w: colW, h: h - 2 * m - 24 - headH - 8 - (profileH ? profileH + 14 : 0) };
    const profile = profileH ? { x: m + 12, y: map.y + map.h + 14, w: colW, h: profileH } : null;
    const panel = { x: m + 12 + colW + 12, y: m + 12, w: panelW - 12, h: h - 2 * m - 24 };
    return { w, h, m, frame, map, profile, head, panel, vertical, guide: true };
  }
  const profileH = opts.showProfile ? Math.round(h * (vertical ? 0.13 : 0.16)) : 0;
  const headH = vertical ? Math.round(h * 0.1) : 0;
  const frame = { x: m, y: m, w: w - 2 * m, h: h - 2 * m };
  const map = { x: m + 12, y: m + 12 + headH, w: w - 2 * m - 24, h: h - 2 * m - 24 - headH - (profileH ? profileH + 14 : 0) };
  const profile = profileH ? { x: m + 12, y: map.y + map.h + 14, w: map.w, h: profileH } : null;
  const head = headH ? { x: m + 12, y: m + 12, w: map.w, h: headH } : null;
  return { w, h, m, frame, map, profile, head, vertical };
}

/**
 * @param model   modelo GPX
 * @param ctx { osm, towns, opts, fontCss }
 */
// Encuadre: maquetación + proyección. Lo comparten el render y el cálculo del relieve.
function frameOf(allPts, opts) {
  const L = layoutFor(opts.format || 'a3v', opts);
  // caja de la ruta con margen para dibujos y rótulos
  const rb = bboxOf(allPts);
  const spanM = Math.max(haversine({ lat: rb.minLat, lon: rb.minLon }, { lat: rb.maxLat, lon: rb.minLon }),
    haversine({ lat: rb.minLat, lon: rb.minLon }, { lat: rb.minLat, lon: rb.maxLon }));
  const bbox = expandBbox(rb, spanM * 0.09 + 400);
  const inset = 26;
  const P = makeProjection(bbox, { x: L.map.x + inset, y: L.map.y + inset, w: L.map.w - 2 * inset, h: L.map.h - 2 * inset });
  return { L, P };
}

/** Extensión geográfica que ocupa el recuadro del mapa (para pedir el relieve justo). */
export function mapExtent(model, opts = {}) {
  const { L, P } = frameOf(allSegments(model).flatMap((s) => s.points), opts);
  const M = L.map;
  const a = P.invert(M.x, M.y), b = P.invert(M.x + M.w, M.y + M.h);
  return { minLat: b.lat, maxLat: a.lat, minLon: a.lon, maxLon: b.lon, widthPx: M.w };
}

export function renderMap(model, ctx) {
  const opts = { format: 'a3v', routeColor: 'carmin', monumentScale: 1, showRivers: true, showWoods: true, showRoads: true, showRails: true,
    showPeaks: true, showPasses: true, showProfile: true, showCompass: true, showKm: true, showArrows: true, style: 'acuarela', layout: 'poster', campina: false, description: '', motto: '', title: model.name, subtitle: '', ...ctx.opts };
  useStyle(opts.style);
  // anchos de letra (las maquetas se calcularon con IM Fell SC y Caveat)
  const RW = fontFor('rotulos', opts).w || 0.51;
  const LW = ST.caps ? RW + 0.16 : RW;          // rótulos de poblaciones (mayúsculas espaciadas)
  const MW = fontFor('mano', opts).w || 1;
  setTextWidth(MW);
  setBadgeText(ST.paper);
  const segs = allSegments(model);
  const allPts = segs.flatMap((s) => s.points);
  const { L, P } = frameOf(allPts, opts);
  const seed = hashString(model.name + allPts.length);
  const rnd = rng(seed);
  const proj = (lat, lon) => P.project(lat, lon);
  const routeColor = (ROUTE_COLORS[opts.routeColor] || ROUTE_COLORS.carmin).color;

  // vértices de ruta proyectados (para colisiones)
  const routePx = [];
  const segPx = segs.map((s) => s.points.map((p) => { const q = proj(p.lat, p.lon); routePx.push(q); return q; }));

  const prof = profileOf(segs);
  const stats = elevationStats(segs);
  const first = allPts[0], last = allPts[allPts.length - 1];
  const circular = haversine(first, last) < 500;

  const towns = (ctx.towns || []).filter((t) => t.selected);
  const guide = !!L.guide;
  const stages = guide || (ctx.towns || []).some((t) => t.selected && t.stageEnd) ? computeStages(prof, ctx.towns || [], circular, ST.stageColors ? [routeColor, ...ST.stageColors.filter((c) => c.toLowerCase() !== routeColor.toLowerCase())] : null) : null;
  const occupied = [];   // rectángulos ocupados por dibujos y rótulos
  const scaleBase = Math.min(L.w, L.h) / 1188 * 0.95 * opts.monumentScale;
  // multiplicadores de tamaño de letra elegidos por el usuario (1 = automático)
  const FS = { title: opts.sizeTitle || 1, towns: opts.sizeTowns || 1, hand: opts.sizeHand || 1, rivers: opts.sizeRivers || 1 };

  const inMap = (r) => r.x >= L.map.x + 4 && r.y >= L.map.y + 4 && r.x + r.w <= L.map.x + L.map.w - 4 && r.y + r.h <= L.map.y + L.map.h - 4;
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const routeHits = (r, pad = 5) => {
    let n = 0;
    for (const [x, y] of routePx) if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) n++;
    return n;
  };

  // ——— colocación de monumentos (evitando tapar la ruta) ———
  const placedMonuments = [];
  const monTowns = [];
  towns.forEach((t, idx) => {
    const mon = chosenMonument(t);
    const anchorGeo = mon ? { lat: mon.lat, lon: mon.lon } : { lat: t.lat, lon: t.lon };
    const [ax, ay] = proj(anchorGeo.lat, anchorGeo.lon);
    const sc = (mon ? 1 : 0.9) * scaleBase * (t.place === 'city' ? 1.15 : t.place === 'town' ? 1 : t.place === 'village' ? 0.82 : t.place === 'poi' ? 0.85 : 0.7);
    const img = mon && mon.image && ctx.images ? ctx.images[mon.image] : null;
    const drawing0 = mon ? (img ? imageDrawing(img, mon) : monumentDrawing(mon.illustration, mon.kind, hashString(t.id), mon.hint)) : townDrawing(t.place, hashString(t.id));
    const drawing = img ? drawing0 : { ...drawing0, body: restyle(drawing0.body) };
    const w = drawing.w * sc, h = drawing.h * sc;
    const fsL = (t.place === 'city' ? 25 : t.place === 'town' ? 22 : t.place === 'village' ? 18 : 15) / 0.95;
    const labelW = Math.max((t.label || t.name).length * fsL * LW * FS.towns, mon && opts.showMonumentNames !== false ? mon.name.length * fsL * 0.72 * 0.48 * MW * FS.hand : 0) * scaleBase;
    let best = null;
    const dirs = [[0, 0], [0, -1], [1, -0.6], [-1, -0.6], [1, 0.4], [-1, 0.4], [0, 1], [1.2, -1.2], [-1.2, -1.2], [1.3, 1], [-1.3, 1]];
    for (const dist of [0, 0.75, 1.2, 1.8]) {
      for (const [dx, dy] of dirs) {
        if (dist === 0 && (dx || dy)) continue;
        const bx = ax + dx * dist * w * 0.8;
        const by = ay + dy * dist * h * 1.1;
        const r = { x: bx - w / 2, y: by - h - 2, w, h: h + 4 };
        const lbl = { x: bx - Math.max(w * 0.6, labelW / 2), y: by + 2, w: Math.max(w * 1.2, labelW), h: 42 * scaleBase * Math.max(FS.towns, FS.hand) };
        let score = routeHits(r) * 60 + routeHits(lbl, 3) * 70 + dist * 30 + Math.abs(dx) * 4;
        for (const o of occupied) score += (overlap(r, o) + overlap(lbl, o)) * 1.5;
        if (!inMap(r) || !inMap(lbl)) score += 5000;
        if (!best || score < best.score) best = { score, bx, by, r, lbl };
      }
    }
    occupied.push(best.r, best.lbl);
    placedMonuments.push({ t, mon, drawing, sc, ax, ay, ...best, idx });
    if (mon) monTowns.push({ t, mon });
  });

  // ——— capas ———
  let out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${L.w} ${L.h}" width="${L.w}" height="${L.h}" data-generador="ESTODOBAJADA-arte" data-version="${VERSION}">`;
  out += defs(ctx.fontCss, opts);
  out += `<rect width="${L.w}" height="${L.h}" fill="${ST.paper}"/>`;
  if (ST.texture !== false) {
    out += `<rect width="${L.w}" height="${L.h}" fill="${ST.paper}" filter="url(#manchas)"/>`;
    out += `<rect width="${L.w}" height="${L.h}" fill="#000" filter="url(#papel)"/>`;
    out += `<rect width="${L.w}" height="${L.h}" fill="url(#vineta)"/>`;
  }

  // marco (doble a tinta en los clásicos; una línea fina en los contemporáneos)
  const Fm = L.frame;
  if (ST.frame === 'single') out += `<rect x="${Fm.x}" y="${Fm.y}" width="${Fm.w}" height="${Fm.h}" fill="none" stroke="${PAL.ink}" stroke-width="1"/>`;
  else {
    out += `<rect x="${Fm.x}" y="${Fm.y}" width="${Fm.w}" height="${Fm.h}" fill="none" stroke="${PAL.ink}" stroke-width="2.2" filter="url(#tinta)"/>`;
    out += `<rect x="${Fm.x + 6}" y="${Fm.y + 6}" width="${Fm.w - 12}" height="${Fm.h - 12}" fill="none" stroke="${PAL.ink}" stroke-width=".7" filter="url(#tinta)"/>`;
  }

  const M = L.map;
  out += `<clipPath id="clipMapa"><rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}"/></clipPath>`;
  out += `<g clip-path="url(#clipMapa)">`;
  // aguada de fondo del territorio con borde irregular
  if (ST.field) out += `<rect x="${M.x + 14}" y="${M.y + 14}" width="${M.w - 28}" height="${M.h - 28}" fill="${ST.field}" fill-opacity=".55" filter="url(#borde)"/>`;
  // relieve real (teselas de elevación), aguada multiplicada sobre el papel
  if (ctx.relief && opts.showRelief !== false) {
    const r = ctx.relief;
    const [x0, y0] = proj(r.maxLat, r.minLon), [x1, y1] = proj(r.minLat, r.maxLon);
    out += `<image id="capa-relieve" href="${r.href}" x="${f1(x0)}" y="${f1(y0)}" width="${f1(x1 - x0)}" height="${f1(y1 - y0)}" preserveAspectRatio="none" opacity="${ST.relief}" style="mix-blend-mode:multiply" filter="url(#${ST.reliefFilter || 'relieve'})"/>`.replace(/^/, ST.layerFilter ? `<g filter="url(#${ST.layerFilter})">` : '') + (ST.layerFilter ? '</g>' : '');
  }
  if (ST.blooms) out += blooms(M, rng(seed + 5));
  if (opts.campina) out += campina(M, rng(seed + 9), occupied, scaleBase);

  const osm = ctx.osm;
  const toPath = (coords) => coords.map(([la, lo], i) => { const [x, y] = proj(la, lo); return `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`; }).join('');

  const ringsD = (rings) => rings.map((r) => toPath(r) + 'Z').join('');
  const boxOf = (rings) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (const [la, lo] of r) { const [x, y] = proj(la, lo); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  };
  const visible = (b) => !(b.x1 < M.x || b.x0 > M.x + M.w || b.y1 < M.y || b.y0 > M.y + M.h);

  // mar: polígonos cerrados a partir de la línea de costa de OSM (agua a la derecha)
  let seaInfo = null;
  if (osm && opts.showWater !== false && osm.coast && osm.coast.length) {
    const a = P.invert(M.x, M.y), b = P.invert(M.x + M.w, M.y + M.h);
    const sea = seaRings(osm.coast, { minLat: b.lat, maxLat: a.lat, minLon: a.lon, maxLon: b.lon });
    const coastD = osm.coast.map((c) => toPath(c)).join('');
    let s = '';
    if (sea.ok && sea.rings.length) {
      const d = sea.rings.map((r) => toPath(r) + 'Z').join('');
      s += `<path d="${d}" fill="${C.sea}" fill-opacity="${ST.modern ? 1 : ST.wet ? 0.62 : 0.55}" fill-rule="evenodd" filter="url(#acuarela)"/>`;
      s += `<clipPath id="clip-mar"><path d="${d}" clip-rule="evenodd"/></clipPath><g clip-path="url(#clip-mar)">`;
      // el pigmento se acumula junto a la costa, como en una acuarela; olas a plumilla mar adentro
      s += `<path d="${coastD}" fill="none" stroke="${PAL.waterDark}" stroke-opacity=".2" stroke-width="30" stroke-linejoin="round" filter="url(#acuarela)"/>`;
      s += `<path d="${coastD}" fill="none" stroke="${PAL.waterDark}" stroke-opacity=".28" stroke-width="9" stroke-linejoin="round"/>`;
      if (!ST.modern) s += `<rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" fill="url(#olas)" opacity="${ST.wet ? 0.4 : 0.5}"/>`;
      s += '</g>';
      seaInfo = { rings: sea.rings };
      // nombre del mar: el punto de mar abierto más alejado de costa y ruta
      const names = (osm.seaNames || []).filter((n) => n.kind !== 'bay');
      if (names.length) {
        const pr = sea.rings.map((r) => r.map(([la, lo]) => proj(la, lo)));
        const inSea = (x, y) => pr.reduce((n, poly) => n + (pointInPolygon(x, y, poly) ? 1 : 0), 0) % 2 === 1;
        const coastPx = [];
        osm.coast.forEach((c) => c.forEach(([la, lo], i) => { if (i % 3 === 0) { const q = proj(la, lo); if (q[0] > M.x - 50 && q[0] < M.x + M.w + 50 && q[1] > M.y - 50 && q[1] < M.y + M.h + 50) coastPx.push(q); } }));
        let best = null;
        for (let gx = 1; gx < 14; gx++) for (let gy = 1; gy < 14; gy++) {
          const x = M.x + (M.w * gx) / 14, y = M.y + (M.h * gy) / 14;
          if (!inSea(x, y)) continue;
          let dmin = Infinity;
          for (const [cx, cy] of coastPx) dmin = Math.min(dmin, Math.hypot(cx - x, cy - y));
          for (let k = 0; k < routePx.length; k += 4) dmin = Math.min(dmin, Math.hypot(routePx[k][0] - x, routePx[k][1] - y) * 1.5);
          if (occupied.some((o) => x > o.x - 20 && x < o.x + o.w + 20 && y > o.y - 20 && y < o.y + o.h + 20)) dmin *= 0.3;
          if (!best || dmin > best.d) best = { x, y, d: dmin };
        }
        if (best && best.d > 40) {
          const c = P.invert(best.x, best.y);
          const n = names.slice().sort((p1, p2) => haversine(p1, c) - haversine(p2, c))[0];
          const fs = 22 * scaleBase / 0.95;
          s += `<text class="rio" x="${f1(best.x)}" y="${f1(best.y)}" text-anchor="middle" font-size="${f1(fs)}" letter-spacing="${f1(fs * 0.28)}">${esc(n.name)}</text>`;
          occupied.push({ x: best.x - n.name.length * fs * 0.4, y: best.y - fs, w: n.name.length * fs * 0.8, h: fs * 1.4 });
        }
      }
      // bahías y ensenadas con nombre, en su sitio
      for (const bay of (osm.seaNames || []).filter((n) => n.kind === 'bay')) {
        const [x, y] = proj(bay.lat, bay.lon);
        if (x < M.x || x > M.x + M.w || y < M.y || y > M.y + M.h) continue;
        s += `<text class="rio" x="${f1(x)}" y="${f1(y)}" text-anchor="middle" font-size="${f1(13.5 * scaleBase / 0.95)}">${esc(bay.name)}</text>`;
      }
    }
    s += `<path d="${coastD}" fill="none" stroke="${PAL.waterDark}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    out += `<g id="capa-mar"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${s}</g>`;
  }

  // cascos urbanos reales (landuse=residential)
  if (osm && opts.showUrban !== false && osm.urban && osm.urban.length) {
    let s = '', lines = '';
    for (const u of osm.urban) {
      if (u.coords.length < 4) continue;
      const d = toPath(u.coords) + 'Z';
      s += `<path d="${d}" fill="${C.urban}" fill-opacity="${ST.modern ? 1 : ST.wet ? 0.3 : 0.22}"/>`;
      if (!ST.modern) lines += `<path d="${d}" fill="none" stroke="${PAL.brickDark}" stroke-opacity=".22" stroke-width=".6"/>`;
    }
    out += `<g id="capa-urbano"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${pool(s)}${lines}</g>`;
  }

  // bosques reales: aguada + árboles dentro del polígono
  if (osm && opts.showWoods) {
    let washes = '', trees = '';
    let treeBudget = ST.trees;
    const spacing = 15 * scaleBase / 0.95;
    const woods = osm.woods.map((wd) => ({ ...wd, px: wd.coords.map(([la, lo]) => proj(la, lo)) }));
    for (const wd of woods) {
      if (wd.px.length < 4) continue;
      washes += `<path d="${wd.px.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join('')}Z" fill="${PAL.green}" fill-opacity="${ST.woodWash}"/>`;
    }
    const pts = [];
    for (const wd of woods) {
      if (wd.px.length < 4) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of wd.px) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 < M.x || x0 > M.x + M.w || y1 < M.y || y0 > M.y + M.h) continue;
      const area = (x1 - x0) * (y1 - y0);
      if (area < spacing * spacing * 0.5) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (pointInPolygon(cx, cy, wd.px)) pts.push([cx, cy, wd.leaf]);
        continue;
      }
      for (let y = y0 + spacing / 2; y < y1; y += spacing * 0.8) {
        for (let x = x0 + ((y / spacing) % 2) * spacing * 0.5; x < x1; x += spacing) {
          const jx = x + (rnd() - 0.5) * spacing * 0.6, jy = y + (rnd() - 0.5) * spacing * 0.5;
          if (pointInPolygon(jx, jy, wd.px)) pts.push([jx, jy, wd.leaf]);
        }
      }
    }
    pts.sort((a, b) => a[1] - b[1]);
    const stride = Math.max(1, Math.ceil(pts.length / treeBudget));
    for (let i = 0; i < pts.length; i += stride) {
      const [x, y, leaf] = pts[i];
      if (occupied.some((o) => x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h + 6)) continue;
      const pine = leaf === 'needleleaved' || (leaf !== 'broadleaved' && rnd() > 0.45);
      const sc = scaleBase * (0.8 + rnd() * 0.35);
      if (!treeBudget) break;
      trees += pine ? pineTree(x, y, sc * (ST.draw.looseTrees ? 1.25 : 1), i + 3) : roundTree(x, y, sc * (ST.draw.looseTrees ? 1.25 : 1), i + 3);
    }
    out += `<g id="capa-bosques"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${pool(washes)}${poolTrees(trees, ST.draw.looseTrees)}</g>`;
  }

  // humedales reales: aguada verde azulada y matas de junco
  if (osm && opts.showWater !== false && osm.wetlands && osm.wetlands.length) {
    let s = '', tufts = '';
    let budget = 700;
    const sp = 17 * scaleBase / 0.95;
    for (const w of osm.wetlands) {
      const b = boxOf(w.rings);
      if (!visible(b)) continue;
      const d = ringsD(w.rings);
      s += `<path d="${d}" fill="${C.wetland}" fill-opacity="${ST.modern ? 1 : .34}" fill-rule="evenodd"/>`;
      const px = w.rings[0].map(([la, lo]) => proj(la, lo));
      for (let y = b.y0 + sp / 2; y < b.y1 && budget > 0; y += sp * 0.8) {
        for (let x = b.x0 + ((y / sp) % 2) * sp * 0.5; x < b.x1 && budget > 0; x += sp) {
          if (!pointInPolygon(x, y, px)) continue;
          budget--;
          tufts += `M${f1(x - 3.5)} ${f1(y)}l7 0M${f1(x - 1.6)} ${f1(y)}l-1.2 -3.2M${f1(x)} ${f1(y)}l0 -4M${f1(x + 1.6)} ${f1(y)}l1.2 -3.2`;
        }
      }
    }
    out += `<g id="capa-humedales"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${pool(s)}<path d="${tufts}" fill="none" stroke="${PAL.waterDark}" stroke-opacity=".65" stroke-width=".7" stroke-linecap="round"/></g>`;
  }

  // ríos
  if (osm && opts.showRivers) {
    let r = '', lines = '', names = '';
    const longest = new Map();
    osm.rivers.forEach((rv, i) => {
      const d = toPath(rv.coords);
      const k = rv.kind === 'river' ? 1 : rv.kind === 'canal' ? 0.55 : 0.3;
      r += `<path d="${d}" fill="none" stroke="${PAL.water}" stroke-opacity=".5" stroke-width="${f1(ST.riverWash * k)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      lines += `<path d="${d}" fill="none" stroke="${PAL.waterDark}" stroke-opacity="${k < 0.5 ? 0.7 : 1}" stroke-width="${k === 1 ? 1.3 : k > 0.5 ? 0.8 : 0.55}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (rv.name) {
        let len = 0;
        for (let k = 1; k < rv.coords.length; k++) len += haversine({ lat: rv.coords[k - 1][0], lon: rv.coords[k - 1][1] }, { lat: rv.coords[k][0], lon: rv.coords[k][1] });
        const prev = longest.get(rv.name);
        if (!prev || len > prev.len) longest.set(rv.name, { len, rv, i });
      }
    });
    for (const [name, { len, rv, i }] of longest) {
      const pxLen = len / P.metersPerPx;
      if (pxLen < name.length * 14) continue;
      let coords = rv.coords;
      const a = proj(...coords[0]), b = proj(...coords[coords.length - 1]);
      if (a[0] > b[0]) coords = coords.slice().reverse();
      const id = `rio-${i}`;
      names += `<path id="${id}" d="${toPath(coords)}" fill="none"/><text class="rio" font-size="${f1(15 * scaleBase / 0.95 * FS.rivers)}" dy="-6"><textPath href="#${id}" xlink:href="#${id}" startOffset="${f1(20 + (hashString(name) % 30))}%">${esc(name)}</textPath></text>`;
    }
    out += `<g id="capa-rios"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${pool(r)}${lines}${names}</g>`;
  }

  // lagunas y embalses reales: aguada, color acumulado en la orilla y línea de costa
  if (osm && opts.showWater !== false && osm.waters && osm.waters.length) {
    let s = '', wash = '', names = '';
    osm.waters.forEach((w, i) => {
      const b = boxOf(w.rings);
      if (!visible(b) || (b.w < 1.2 && b.h < 1.2)) return;
      const d = ringsD(w.rings);
      wash += `<path d="${d}" fill="${PAL.water}" fill-opacity="${ST.wet ? 0.5 : 0.55}" fill-rule="evenodd"/>`;
      if (b.w * b.h > 300) {
        const id = `agua-${i}`;
        s += `<clipPath id="${id}"><path d="${d}" clip-rule="evenodd"/></clipPath>`;
        s += `<g clip-path="url(#${id})"><path d="${d}" fill="none" stroke="${PAL.waterDark}" stroke-opacity=".18" stroke-width="12"/><path d="${d}" fill="none" stroke="${PAL.waterDark}" stroke-opacity=".3" stroke-width="4"/></g>`;
      }
      s += `<path d="${d}" fill="none" stroke="${PAL.waterDark}" stroke-width="${b.w * b.h > 300 ? 0.9 : 0.6}" stroke-linejoin="round"/>`;
      if (w.name && b.w > w.name.length * 6) {
        names += `<text class="rio" x="${f1((b.x0 + b.x1) / 2)}" y="${f1(b.y1 + 14 * scaleBase)}" text-anchor="middle" font-size="${f1(13.5 * scaleBase / 0.95 * FS.rivers)}">${esc(w.name)}</text>`;
      }
    });
    out += `<g id="capa-agua"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${pool(wash)}${s}${names}</g>`;
  }

  // ferrocarril y carreteras principales (tinta suave)
  if (osm && opts.showRails) {
    let s = '';
    for (const rl of osm.rails) {
      const d = toPath(rl.coords);
      s += `<path d="${d}" fill="none" stroke="${PAL.ink}" stroke-opacity=".55" stroke-width="2.4"/><path d="${d}" fill="none" stroke="${ST.paper}" stroke-width="1.2" stroke-dasharray="5 5"/>`;
    }
    out += `<g id="capa-tren">${s}</g>`;
  }
  if (osm && opts.showRoads) {
    let s = '';
    for (const rd of osm.roads) {
      const d = toPath(rd.coords);
      const big = rd.kind === 'motorway' || rd.kind === 'trunk';
      if (rd.kind === 'secondary' || rd.kind === 'tertiary') {
        s += `<path d="${d}" fill="none" stroke="${PAL.stoneDark}" stroke-opacity="${rd.kind === 'secondary' ? 0.45 : 0.32}" stroke-width="${rd.kind === 'secondary' ? 1.5 : 1}"/>`;
        continue;
      }
      s += `<path d="${d}" fill="none" stroke="${PAL.stoneDark}" stroke-opacity=".6" stroke-width="${big ? 3.2 : 2.2}"/><path d="${d}" fill="none" stroke="${C.road}" stroke-width="${big ? 1.6 : 1}"/>`;
    }
    out += `<g id="capa-carreteras" opacity=".8">${s}</g>`;
  }

  // puertos de montaña reales: los que cruza la ruta van siempre, destacados y en el perfil
  let passLayer = '';
  const routePasses = [];
  if (osm && opts.showPasses && osm.passes && osm.passes.length) {
    const list = osm.passes.map((ps) => ({ ...ps, near: nearestOnRoute(prof, ps.lat, ps.lon) }))
      .map((ps) => ({ ...ps, onRoute: ps.near.dist < 350 }))
      .filter((ps) => ps.onRoute || ps.name)
      .sort((a, b) => b.onRoute - a.onRoute || (b.ele || 0) - (a.ele || 0));
    const seen = new Set();
    list.forEach((ps, i) => {
      const [x, y] = proj(ps.lat, ps.lon);
      if (x < M.x || x > M.x + M.w || y < M.y || y > M.y + M.h) return;
      const key = (ps.name || '') + Math.round(ps.near.along / 500);
      if (seen.has(key)) return;
      const label = ps.name ? `${esc(ps.name)}${ps.ele ? ` · ${Math.round(ps.ele).toLocaleString('es-ES')} m` : ''}` : (ps.ele ? `Puerto · ${Math.round(ps.ele).toLocaleString('es-ES')} m` : 'Puerto');
      const fsz = 13 * scaleBase * FS.hand * (ps.onRoute ? 1.15 : 1);
      const lw = label.length * fsz * 0.42;
      const box = { x: x - Math.max(24, lw / 2), y: y - 36 * scaleBase, w: Math.max(48, lw), h: 36 * scaleBase + fsz + 4 };
      if (!ps.onRoute && occupied.some((o) => overlap(box, o) > 40)) return;
      seen.add(key);
      passLayer += restyle(mountainPass(x, y + 2, scaleBase * (ps.onRoute ? 1.4 : 0.9), i + 7, ps.onRoute));
      passLayer += `<text class="mano" x="${f1(x)}" y="${f1(y + 4 + fsz)}" text-anchor="middle" font-size="${f1(fsz)}"${ps.onRoute ? ' font-weight="700"' : ''}>${label}</text>`;
      occupied.push(box);
      if (ps.onRoute) routePasses.push({ along: ps.near.along, name: ps.name, ele: ps.ele });
    });
  }

  // cimas reales
  if (osm && opts.showPeaks) {
    let s = '';
    osm.peaks.forEach((pk, i) => {
      const [x, y] = proj(pk.lat, pk.lon);
      if (x < M.x || x > M.x + M.w || y < M.y || y > M.y + M.h) return;
      const box = { x: x - 22, y: y - 30, w: 44, h: 32 };
      if (occupied.some((o) => overlap(box, o) > 40) || routeHits(box, 0) > 3) return;
      s += ST.peaks === 'triangle' ? peakMark(x, y + 2, scaleBase) : mountain(x, y + 2, scaleBase * 0.9, i + 1);
      if (pk.name) s += `<text class="mano" x="${f1(x)}" y="${f1(y + 16)}" text-anchor="middle" font-size="${f1(13 * scaleBase * FS.hand)}">${esc(pk.name)}${pk.ele ? ` · ${Math.round(pk.ele)} m` : ''}</text>`;
      occupied.push(box);
    });
    out += `<g id="capa-cimas"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${s}</g>`;
  }

  // monumentos y caseríos (debajo de la ruta: la ruta siempre queda visible)
  let monLayer = '';
  for (const pm of placedMonuments) {
    const { drawing, sc, bx, by, ax, ay, t, mon } = pm;
    const moved = Math.hypot(bx - ax, by - ay) > 4;
    if (moved) monLayer += `<path d="M${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}" stroke="${PAL.ink}" stroke-width=".8" stroke-dasharray="2 3" fill="none"/>`;
    if (C.monGround) monLayer += `<ellipse cx="${f1(bx)}" cy="${f1(by - 2)}" rx="${f1(drawing.w * sc * .62)}" ry="${f1(drawing.h * sc * .32)}" fill="${ST.wet ? '#d8b27a' : PAL.green}" fill-opacity="${ST.wet ? .32 : .18}" filter="url(#acuarela)"/>`;
    monLayer += `<g class="monumento" data-poblacion="${esc(t.name)}" transform="translate(${f1(bx)} ${f1(by)}) scale(${sc.toFixed(3)})">${drawing.body}</g>`;
    monLayer += `<circle cx="${f1(ax)}" cy="${f1(ay)}" r="2.6" fill="${PAL.ink}"/>`;
    void mon;
  }
  out += `<g id="capa-patrimonio"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${monLayer}</g>`;

  // ——— RUTA GPX (geometría exacta) ———
  let route = '';
  const dList = segPx.map((pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fx(x)} ${fx(y)}`).join(''));
  if (ST.bleed) for (const d of dList) route += `<path d="${d}" fill="none" stroke="${routeColor}" stroke-opacity=".22" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" filter="url(#sangrado)"/>`;
  if (ST.glow) for (const d of dList) route += `<path d="${d}" fill="none" stroke="${routeColor}" stroke-opacity=".55" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" filter="url(#brillo)"/>`;
  else for (const d of dList) route += `<path d="${d}" fill="none" stroke="${ST.paper}" stroke-opacity=".9" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
  dList.forEach((d, si) => {
    route += `<path class="ruta" data-ruta-seg="${si}" d="${d}" fill="none" stroke="${routeColor}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  out += `<g id="capa-ruta">${route}</g>`;
  // los puertos van encima de la ruta: están sobre la propia carretera
  if (passLayer) out += `<g id="capa-puertos"${ST.layerFilter ? ` filter="url(#${ST.layerFilter})"` : ''}>${passLayer}</g>`;
  if (stages) out += stageRoute(stages, prof, segPx, { wet: ST.wet });

  // marcas sobre la ruta: km, sentido, salida/llegada (solo superpuestas, no alteran la geometría)
  const at = (dist) => {
    const s = prof.samples;
    let lo = 0, hi = s.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (s[mid].d < dist) lo = mid; else hi = mid; }
    const a = s[lo], b = s[hi];
    const t = b.d > a.d ? (dist - a.d) / (b.d - a.d) : 0;
    const pa = proj(a.lat, a.lon), pb = proj(b.lat, b.lon);
    return { x: pa[0] + (pb[0] - pa[0]) * t, y: pa[1] + (pb[1] - pa[1]) * t, ang: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) };
  };
  let marks = '';
  const totalKm = prof.total / 1000;
  if (opts.showArrows && prof.total > 2000) {
    const n = Math.max(3, Math.min(10, Math.round(totalKm / 15)));
    for (let i = 1; i <= n; i++) {
      const p = at((prof.total * (i - 0.5)) / n);
      const deg = (p.ang * 180) / Math.PI;
      marks += `<path transform="translate(${f1(p.x)} ${f1(p.y)}) rotate(${f1(deg)})" d="M-3.5 -4L2.5 0L-3.5 4" fill="none" stroke="${PAL.ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  if (opts.showKm && totalKm > 12) {
    const step = totalKm > 160 ? 20 : 10;
    for (let k = step; k < totalKm - step * 0.4; k += step) {
      const p = at(k * 1000);
      marks += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="8.5" fill="${ST.paper}" stroke="${guide ? PAL.ink : routeColor}" stroke-width="1.6"/><text x="${f1(p.x)}" y="${f1(p.y + 3.6)}" text-anchor="middle" class="txF" font-size="9.5" fill="${PAL.ink}">${k}</text>`;
    }
  }
  const [sx, sy] = proj(first.lat, first.lon);
  const [ex, ey] = proj(last.lat, last.lon);
  if (!circular) marks += `<rect x="${f1(ex - 6)}" y="${f1(ey - 6)}" width="12" height="12" fill="${PAL.ink}" stroke="${ST.paper}" stroke-width="2"/>`;
  marks += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="8" fill="${routeColor}" stroke="${ST.paper}" stroke-width="2.5"/><circle cx="${f1(sx)}" cy="${f1(sy)}" r="2.6" fill="${ST.paper}"/>`;
  if (guide) {
    for (const t of towns) {
      if (t.dist > 1500) continue;
      const p = at(Math.min(prof.total, Math.max(0, t.along)));
      marks += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="5.5" fill="${C.dot}" stroke="${PAL.ink}" stroke-width="2"/>`;
    }
  }
  out += `<g id="capa-marcas">${marks}</g>`;

  // rótulos de poblaciones y monumentos
  let labels = '';
  const pois = [];
  for (const pm of placedMonuments.slice().sort((a, b) => a.t.along - b.t.along)) {
    if (pm.mon) { pm.poi = pois.length + 1; const nm = pm.t.label || pm.t.name; pois.push({ n: pm.poi, name: nm, monument: pm.mon.name !== nm ? pm.mon.name : null }); }
  }
  for (const pm of placedMonuments) {
    const { t, mon, bx, by } = pm;
    const fs0 = (t.place === 'city' ? 25 : t.place === 'town' ? 22 : t.place === 'village' ? 18 : 15) * scaleBase / 0.95;
    const fs = fs0 * FS.towns, fm = fs0 * 0.72 * FS.hand;
    if (guide && pm.poi) labels += numberBadge(bx - (t.label || t.name).length * fs * LW / 2 - 14, by + fs * 0.62, pm.poi, 10 * scaleBase / 0.95);
    labels += `<text class="lbl" x="${f1(bx)}" y="${f1(by + fs + 2)}" text-anchor="middle" font-size="${f1(fs)}">${esc(t.label || t.name)}</text>`;
    if (mon && opts.showMonumentNames !== false && mon.name !== (t.label || t.name)) labels += `<text class="mano" x="${f1(bx)}" y="${f1(by + fs + 2 + fm * 1.08)}" text-anchor="middle" font-size="${f1(fm)}">${esc(mon.name)}</text>`;
  }
  out += `<g id="capa-rotulos">${labels}</g>`;
  out += `</g>`; // fin clip mapa
  out += `<rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" fill="none" stroke="${PAL.ink}" stroke-width="1.1" filter="url(#tinta)"/>`;

  // ——— cartela ———
  const title = opts.title || model.name;
  const kmTxt = `${totalKm.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
  const upTxt = stats ? `+${Math.round(stats.up).toLocaleString('es-ES')} m` : '';
  const kind = circular ? 'Circular' : 'Lineal';
  if (guide) {
    const nd = stages.length;
    out += titleBlock(L.head, { titleScale: FS.title, title, kicker: `Ruta cicloturismo · ${nd} ${nd === 1 ? 'día' : 'días'} · ${kmTxt}${upTxt ? ' · ' + upTxt : ''} · ruta ${kind.toLowerCase()}`, description: opts.description || opts.subtitle, sc: scaleBase / 0.95 });
  } else if (L.head) {
    const H = L.head;
    if (ST.wet) out += `<path d="M${H.x - 8} ${f1(H.y + H.h * .2)}Q${f1(H.x + H.w * .2)} ${f1(H.y + H.h * .08)} ${f1(H.x + H.w * .42)} ${f1(H.y + H.h * .16)}L${f1(H.x + H.w * .41)} ${f1(H.y + H.h * .34)}Q${f1(H.x + H.w * .2)} ${f1(H.y + H.h * .4)} ${H.x - 6} ${f1(H.y + H.h * .33)}Z" fill="${routeColor}" fill-opacity=".28" filter="url(#floracion)"/>`;
    out += `<g id="cartela"><text class="tit" x="${H.x}" y="${H.y + H.h * 0.28}" font-size="${f1(H.h * 0.2)}" letter-spacing="3">#ESTODOBAJADA</text>`;
    // el título deja sitio a los datos de la derecha
    const rightW = opts.subtitle ? opts.subtitle.length * H.h * 0.2 * 0.48 * MW + 30 : 20;
    const tsz = Math.min(H.h * 0.42, (H.w - rightW) / Math.max(4, title.length * RW)) * FS.title;
    out += `<text class="tit" x="${H.x}" y="${H.y + H.h * 0.72}" font-size="${f1(tsz)}">${esc(title)}</text>`;
    out += `<text class="mano" x="${H.x + H.w}" y="${H.y + H.h * 0.38}" text-anchor="end" font-size="${f1(H.h * 0.24)}">${esc(kmTxt)}${upTxt ? ' · ' + upTxt : ''} · ${kind}</text>`;
    if (opts.subtitle) out += `<text class="mano" x="${H.x + H.w}" y="${H.y + H.h * 0.72}" text-anchor="end" font-size="${f1(H.h * 0.2)}">${esc(opts.subtitle)}</text>`;
    out += `<path d="M${H.x} ${H.y + H.h - 4}L${H.x + H.w} ${H.y + H.h - 4}" stroke="${PAL.ink}" stroke-width="1.2" filter="url(#tinta)"/></g>`;
  } else {
    // cartela flotante en la esquina con menos ruta
    const cw = Math.min(520, M.w * 0.36), ch = 150;
    const corners = [[M.x + 16, M.y + 16], [M.x + M.w - cw - 16, M.y + 16], [M.x + 16, M.y + M.h - ch - 16], [M.x + M.w - cw - 16, M.y + M.h - ch - 16]];
    let bestC = corners[0], bestS = Infinity;
    for (const [cx, cy] of corners) {
      const r = { x: cx, y: cy, w: cw, h: ch };
      const s = routeHits(r, 10) * 10 + occupied.reduce((a, o) => a + overlap(r, o), 0) * 0.05;
      if (s < bestS) { bestS = s; bestC = [cx, cy]; }
    }
    const [cx, cy] = bestC;
    out += `<g id="cartela"><path d="M${cx} ${cy}L${cx + cw} ${cy}L${cx + cw} ${cy + ch}L${cx} ${cy + ch}Z" fill="${ST.paper}" fill-opacity=".94" stroke="${PAL.ink}" stroke-width="1.3" filter="url(#tinta)"/>`;
    out += `<path d="M${cx + 6} ${cy + 6}L${cx + cw - 6} ${cy + 6}L${cx + cw - 6} ${cy + ch - 6}L${cx + 6} ${cy + ch - 6}Z" fill="none" stroke="${PAL.ink}" stroke-width=".5"/>`;
    out += `<text class="tit" x="${cx + 22}" y="${cy + 38}" font-size="22" letter-spacing="3">#ESTODOBAJADA</text>`;
    out += `<text class="tit" x="${cx + 22}" y="${cy + 84}" font-size="${f1(Math.min(42, (cw - 40) / Math.max(8, title.length) * 1.7) * FS.title)}">${esc(title)}</text>`;
    out += `<text class="mano" x="${cx + 22}" y="${cy + 122}" font-size="24">${esc(kmTxt)}${upTxt ? ' · ' + upTxt : ''} · ${kind}${opts.subtitle ? ' · ' + esc(opts.subtitle) : ''}</text></g>`;
    occupied.push({ x: cx, y: cy, w: cw, h: ch });
  }

  // rosa de los vientos y escala gráfica (esquinas libres)
  const freeCorner = (w, h) => {
    const cs = [[M.x + M.w - w - 20, M.y + 20], [M.x + 20, M.y + 20], [M.x + M.w - w - 20, M.y + M.h - h - 20], [M.x + 20, M.y + M.h - h - 20]];
    let best = cs[0], bs = Infinity;
    for (const [x, y] of cs) {
      const r = { x, y, w, h };
      const s = routeHits(r, 6) * 10 + occupied.reduce((a, o) => a + overlap(r, o), 0);
      if (s < bs) { bs = s; best = [x, y]; }
    }
    occupied.push({ x: best[0], y: best[1], w, h });
    return best;
  };
  if (opts.showCompass) {
    const rr = 44 * scaleBase / 0.95;
    const [x, y] = freeCorner(rr * 2.4, rr * 2.6);
    out += ST.compass === 'arrow' ? northArrow(x + rr * 1.2, y + rr * 1.5, rr) : compassRose(x + rr * 1.2, y + rr * 1.5, rr);
  }
  {
    const nice = [500, 1000, 2000, 5000, 10000, 20000, 50000];
    const target = M.w * 0.22 * P.metersPerPx;
    const len = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const px = len / P.metersPerPx;
    const [x, y] = freeCorner(px + 30, 46);
    let s = `<g id="escala" transform="translate(${f1(x + 10)} ${f1(y + 18)})">`;
    for (let i = 0; i < 4; i++) s += `<rect x="${f1((px / 4) * i)}" y="0" width="${f1(px / 4)}" height="6" fill="${i % 2 ? ST.paper : PAL.ink}" stroke="${PAL.ink}" stroke-width=".8"/>`;
    s += `<text class="tx" x="0" y="22" font-size="12">0</text><text class="tx" x="${f1(px)}" y="22" font-size="12" text-anchor="middle">${len >= 1000 ? len / 1000 + ' km' : len + ' m'}</text></g>`;
    out += s;
  }

  // ——— perfil de altitud ———
  if (L.profile && stats && stages && (guide || stages.length > 1)) {
    out += stageProfiles(L.profile, prof, stages, stats, { fill: ST.modern ? C.profile : null });
  } else if (L.profile && stats) {
    const Pr = L.profile;
    const pad = { l: 54, r: 16, t: 16, b: 30 };
    const gx = Pr.x + pad.l, gy = Pr.y + pad.t, gw = Pr.w - pad.l - pad.r, gh = Pr.h - pad.t - pad.b;
    const lo = Math.floor(stats.min / 20) * 20;
    let hi = Math.ceil(stats.max / 20) * 20 + 20;
    const X = (d) => gx + (d / prof.total) * gw;
    const labelItems = towns.map((t) => ({
      text: t.label || t.name, x: X(t.along), d: t.along,
      prio: (t.stageEnd ? 6 : 0) + (chosenMonument(t) ? 3 : 0) + ({ city: 4, town: 3, village: 2, poi: 2, hamlet: 1 }[t.place] || 1) + (t.crossed ? 1 : 0),
    }));
    const lay = layoutProfileLabels(labelItems, { x0: gx, x1: gx + gw, fs: 13 });
    // con nombres en vertical, la curva ocupa algo menos de alto para dejarles sitio encima
    if (lay.mode === 'vertical') hi = lo + Math.ceil(((hi - lo) / 0.66) / 20) * 20;
    const Y = (e) => gy + gh - ((e - lo) / (hi - lo)) * gh;
    const smp = prof.samples.filter((s) => s.ele != null);
    let line = '';
    smp.forEach((s, i) => { line += `${i ? 'L' : 'M'}${f1(X(s.d))} ${f1(Y(s.ele))}`; });
    let s = `<g id="perfil">`;
    s += `<path d="${line}L${f1(X(smp[smp.length - 1].d))} ${f1(gy + gh)}L${f1(X(smp[0].d))} ${f1(gy + gh)}Z" fill="${ST.modern ? C.profile : ST.wet ? '#b9a27c' : PAL.mountain}" fill-opacity="${ST.modern ? 1 : ST.wet ? .5 : .6}" filter="url(#acuarela)"/>`;
    s += `<path d="${line}" fill="none" stroke="${routeColor}" stroke-width="1.8"/>`;
    s += `<path d="M${gx} ${gy}L${gx} ${gy + gh}L${gx + gw} ${gy + gh}" fill="none" stroke="${PAL.ink}" stroke-width="1"/>`;
    const step = totalKm > 160 ? 20 : totalKm > 60 ? 10 : 5;
    for (let k = 0; k <= totalKm; k += step) s += `<path d="M${f1(X(k * 1000))} ${gy + gh}l0 4" stroke="${PAL.ink}"/><text class="tx" x="${f1(X(k * 1000))}" y="${gy + gh + 17}" font-size="11" text-anchor="middle">${k}</text>`;
    s += `<text class="tx" x="${gx - 6}" y="${f1(Y(hi - 20) + 4)}" font-size="11" text-anchor="end">${hi - 20} m</text><text class="tx" x="${gx - 6}" y="${f1(Y(lo) + 4)}" font-size="11" text-anchor="end">${lo} m</text>`;
    s += `<text class="tx" x="${gx + gw}" y="${gy + gh + 17}" font-size="11" text-anchor="end"> km</text>`;
    // nombres de las poblaciones: en horizontal si caben; si no, en vertical sobre la línea
    // (como los perfiles de etapa), repartidos con línea guía y, si sobran, los más importantes
    {
      const eleAt = (d) => {
        let lo2 = 0, hi2 = smp.length - 1;
        while (lo2 < hi2 - 1) { const mid = (lo2 + hi2) >> 1; if (smp[mid].d < d) lo2 = mid; else hi2 = mid; }
        const a2 = smp[lo2], b2 = smp[hi2], t2 = b2.d > a2.d ? (d - a2.d) / (b2.d - a2.d) : 0;
        return a2.ele + (b2.ele - a2.ele) * Math.max(0, Math.min(1, t2));
      };
      for (const it of lay.placed) {
        const yc = Y(eleAt(it.d));
        s += `<path d="M${f1(it.x)} ${gy + gh}L${f1(it.x)} ${f1(yc)}" stroke="${PAL.ink}" stroke-width=".6" stroke-dasharray="2 2"/>`;
        if (lay.mode === 'horizontal') {
          s += `<path d="M${f1(it.x)} ${f1(yc)}L${f1(it.x)} ${gy - 2}" stroke="${PAL.ink}" stroke-width=".6" stroke-dasharray="2 2"/>`;
          s += `<text class="mano" x="${f1(it.x + 4)}" y="${gy + 4}" font-size="13">${esc(it.text)}</text>`;
          continue;
        }
        // vertical: el texto sube desde justo encima de la curva
        const top = gy - pad.t + 2;
        const ycl = Y(eleAt(((it.lx - gx) / gw) * prof.total));
        const yl = Math.min(yc, ycl) - 7;                       // encima de la curva
        const yb = Math.max(yc, ycl) + 9;                       // o, si no cabe, debajo
        const need = (f) => it.text.length * f * 0.47;
        const roomUp = yl - top, roomDown = gy + gh - 4 - yb;
        let fsz = 12, txt = it.text, below = false;
        if (need(fsz) > roomUp && roomDown > roomUp) below = true;
        const room = below ? roomDown : roomUp;
        while (need(fsz) > room && fsz > 9) fsz -= 0.5;
        if (txt.length * fsz * 0.47 > room) txt = txt.slice(0, Math.max(3, Math.floor(room / (fsz * 0.47)) - 1)) + '…';
        const ya = below ? yb : yl;
        if (Math.abs(it.lx - it.x) > 1.5) s += `<path d="M${f1(it.x)} ${f1(below ? yc + 1 : yc - 1)}L${f1(it.lx)} ${f1(below ? ya - 2 : ya + 2)}" stroke="${PAL.ink}" stroke-width=".6" fill="none"/>`;
        s += `<circle cx="${f1(it.x)}" cy="${f1(yc)}" r="1.8" fill="${PAL.ink}"/>`;
        s += `<text class="mano" transform="translate(${f1(it.lx + fsz * 0.35)} ${f1(ya)}) rotate(-90)" font-size="${f1(fsz)}"${below ? ' text-anchor="end"' : ''}>${esc(txt)}</text>`;
      }
    }
    // puertos que cruza la ruta: banderín sobre la línea del perfil
    for (const ps of routePasses) {
      const x = X(ps.along);
      // a la altura del propio perfil en ese punto (la cota de OSM se muestra en el rótulo)
      const k = smp.findIndex((q) => q.d >= ps.along);
      const e = (smp[Math.max(0, k)] || smp[smp.length - 1]).ele;
      const y = Math.max(gy + 14, Math.min(gy + gh, Y(e)));
      s += `<path d="M${f1(x)} ${f1(y)}L${f1(x)} ${f1(y - 12)}" stroke="${PAL.ink}" stroke-width="1"/><path d="M${f1(x)} ${f1(y - 12)}l7 2.2l-7 2.2Z" fill="${PAL.roof}" stroke="${PAL.ink}" stroke-width=".5"/>`;
      s += `<text class="mano" x="${f1(x - 3)}" y="${f1(y - 4)}" text-anchor="end" font-size="12" font-weight="700">${esc(ps.name || 'Puerto')}${ps.ele ? ` ${Math.round(ps.ele)} m` : ''}</text>`;
    }
    s += `</g>`;
    out += s;
  }

  if (guide) {
    const st0 = stages[0];
    out += sidePanel(L.panel, { dot: C.dot, sea: C.sea, stages, pois, start: st0.names[0], circular, motto: opts.motto, hasWoods: !!(osm && opts.showWoods && osm.woods.length), hasRivers: !!(osm && opts.showRivers && osm.rivers.length), hasWater: !!(osm && opts.showWater !== false && osm.waters && osm.waters.length), hasSea: !!seaInfo, hasWetlands: !!(osm && opts.showWater !== false && osm.wetlands && osm.wetlands.length), sc: scaleBase / 0.95 });
  }

  // créditos obligatorios
  // créditos: «breve» (una línea centrada que siempre cabe), «completo» (autores de las fotos,
  // en varias líneas) o «ninguno». La lista completa va siempre en el informe exportado.
  const aiUsed = monTowns.filter(({ mon }) => mon.aiCredit && mon.image && ctx.images && ctx.images[mon.image]);
  const creditMode = opts.credits || 'breve';
  if (creditMode !== 'ninguno') {
    const parts = [osm ? '© colaboradores de OpenStreetMap' : null,
      ctx.relief && opts.showRelief !== false ? 'relieve: Terrain Tiles' : null,
      aiUsed.length ? 'ilustraciones sobre fotos de Wikimedia Commons' : null].filter(Boolean);
    const lines = [parts.join('  ·  ')];
    if (creditMode === 'completo' && aiUsed.length) {
      const who = [...new Set(aiUsed.map(({ mon }) => `${mon.aiCredit.autor || '?'} (${mon.aiCredit.licencia || '?'})`))];
      lines.push(...wrap('Fotos de referencia: ' + who.join(', '), 160).slice(0, 2));
    }
    const avail = L.w - 2 * L.m - 40;
    let fs = 10;
    const longest = Math.max(...lines.map((l) => l.length));
    while (longest * fs * 0.5 > avail && fs > 7) fs -= 0.5;
    const lh = fs * 1.35;
    const y0 = L.h - L.m / 2 - ((lines.length - 1) * lh) / 2 + fs * 0.35;
    lines.forEach((ln, k) => {
      out += `<text class="tx" x="${f1(L.w / 2)}" y="${f1(y0 + k * lh)}" font-size="${f1(fs)}" text-anchor="middle" letter-spacing=".6" opacity=".55">${esc(ln)}</text>`;
    });
  }
  out += `</svg>`;
  out = stripPaint(out);

  return {
    svg: out, projection: P, layout: L,
    stats: { km: totalKm, up: stats ? stats.up : null, down: stats ? stats.down : null, min: stats ? stats.min : null, max: stats ? stats.max : null, circular },
    stages: stages ? stages.map((st) => ({ dia: st.n, km: st.km, desnivel: Math.round(st.up), poblaciones: st.names })) : null,
    credits: aiUsed.map(({ t, mon }) => ({ poblacion: t.name, monumento: mon.name, ...mon.aiCredit })),
    monuments: monTowns.map(({ t, mon }) => ({ town: t.name, name: mon.name, kind: KIND_LABEL[mon.kind] || mon.kind, specific: mon.specific, image: mon.image && ctx.images && ctx.images[mon.image] ? mon.image : null, source: mon.source })),
  };
}

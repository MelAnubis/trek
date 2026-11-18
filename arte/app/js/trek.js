// Enlace con Trek: las rutas que el usuario ya tiene allí (planificador, tracks y excursiones de
// sus viajes) llegan como GPX, con los puntos tal como Trek los guarda.

export const ROUTE_KIND = { planner: 'Planificador', track: 'Track de viaje', tour: 'Excursión' };

/** @returns [{ tipo, id, nombre, km, puntos, viaje, fecha }] */
export async function listRoutes() {
  const r = await fetch('trek/rutas', { cache: 'no-store' });
  if (!r.ok) throw new Error(`No se pudieron leer tus rutas (error ${r.status})`);
  return (await r.json()).rutas || [];
}

/** @returns { nombre, gpx } */
export async function routeGpx(tipo, id) {
  const r = await fetch(`trek/rutas/${encodeURIComponent(tipo)}/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 404 ? 'Esa ruta ya no existe o no tienes acceso a ella' : `No se pudo abrir la ruta (error ${r.status})`);
  return r.json();
}

/** Filtra por palabras (sin acentos ni mayúsculas) en nombre y viaje. */
export function filterRoutes(list, q = '') {
  const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = norm(q).split(/\s+/).filter(Boolean);
  return list.filter((it) => { const t = norm(`${it.nombre} ${it.viaje || ''} ${ROUTE_KIND[it.tipo] || ''}`); return words.every((w) => t.includes(w)); });
}

// ——— agrupación del selector «Mis rutas de Trek» ———

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const time = (f) => { const t = f ? Date.parse(String(f).replace(' ', 'T')) : NaN; return Number.isFinite(t) ? t : 0; };

/** Cuántas rutas hay de cada tipo: { planner: n, track: n, tour: n } (solo los que hay). */
export function countKinds(list) {
  const out = {};
  for (const it of list) out[it.tipo] = (out[it.tipo] || 0) + 1;
  return out;
}

/**
 * Agrupa las rutas para el selector.
 *   por 'viaje': un grupo por viaje (las del planificador, sin viaje, juntas); dentro,
 *                por nombre con los números en orden (001, 002… 010), que es como se nombran las etapas.
 *   por 'mes':   un grupo por mes de la fecha; dentro, de la más reciente a la más antigua.
 * Los grupos van del que tiene la ruta más reciente al más antiguo.
 * @returns [{ clave, titulo, items, km, desde, hasta }]
 */
export function groupRoutes(list, por = 'viaje') {
  const map = new Map();
  for (const it of list) {
    let clave, titulo;
    if (por === 'mes') {
      const t = time(it.fecha);
      const d = t ? new Date(t) : null;
      clave = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'sin-fecha';
      titulo = d ? `${MESES[d.getMonth()]} ${d.getFullYear()}` : 'Sin fecha';
    } else if (it.viaje) {
      clave = `v:${it.viaje}`; titulo = it.viaje;
    } else {
      clave = `k:${it.tipo}`; titulo = it.tipo === 'planner' ? 'Planificador (sin viaje)' : 'Sin viaje';
    }
    if (!map.has(clave)) map.set(clave, { clave, titulo, items: [], km: 0, desde: Infinity, hasta: 0 });
    const g = map.get(clave);
    g.items.push(it);
    g.km += Number(it.km) || 0;
    const t = time(it.fecha);
    if (t) { g.desde = Math.min(g.desde, t); g.hasta = Math.max(g.hasta, t); }
  }
  const groups = [...map.values()];
  for (const g of groups) {
    if (!Number.isFinite(g.desde)) g.desde = 0;
    g.items.sort(por === 'mes'
      ? (a, b) => time(b.fecha) - time(a.fecha) || collator.compare(a.nombre, b.nombre)
      : (a, b) => collator.compare(a.nombre, b.nombre) || time(b.fecha) - time(a.fecha));
  }
  // Lo sin fecha y el planificador sin fecha, al final; el resto, de lo más reciente a lo más antiguo.
  return groups.sort((a, b) => b.hasta - a.hasta || collator.compare(a.titulo, b.titulo));
}

/**
 * El principio que comparten todos los nombres de un grupo y que se puede quitar
 * («Vía Verde Sierra de la Demanda … — » en «… — 001Pineda», «… — 002Quintanar»).
 * Corta en un separador (espacio, guion, raya, barra, punto…), no lo quita si es
 * corto o si un nombre es el principio de otro, y deja algo a cada nombre.
 * @returns el prefijo, o '' si no hay que abreviar
 */
export function namePrefix(items) {
  if (items.length < 2) return '';
  const names = items.map((it) => String(it.nombre ?? ''));
  const first = names[0];
  let n = 0;
  while (n < first.length && names.every((s) => s[n] === first[n])) n++;
  // Un nombre que es el principio de otro («… Campos» / «… Campos II»): abreviar confundiría.
  if (names.some((s) => s.length === n)) return '';
  // Retrocede hasta justo después de un separador, para no partir una palabra.
  const SEP = /[\s\-–—_/·.,:;()]/;
  while (n > 0 && !SEP.test(first[n - 1])) n--;
  if (n < 15) return '';  // quitar «Camino de » no ayuda; quitar 60 caracteres repetidos, sí
  if (names.some((s) => strip(s.slice(n)).length < 2)) return '';
  return first.slice(0, n);
}
const strip = (s) => s.replace(/^[\s\-–—_/·.,:;]+/, '');

/** Nombres abreviados dentro de un grupo (sin el prefijo común). @returns Map(item → nombre) */
export function shortNames(items) {
  const pre = namePrefix(items);
  return new Map(items.map((it) => [it, pre ? `… ${strip(String(it.nombre).slice(pre.length))}` : it.nombre]));
}

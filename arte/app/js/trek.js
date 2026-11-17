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

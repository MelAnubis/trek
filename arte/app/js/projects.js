// Composiciones guardadas: el GPX original (texto literal, sin tocar), las opciones de diseño,
// las decisiones por población y los datos de OpenStreetMap ya descargados, para reabrir un
// mapa tal como se dejó sin consultar OSM de nuevo.
// Se guardan en el servidor de Trek (por usuario) y se pueden exportar/importar como archivo .json.

export const FORMAT = 'estodobajada-arte/composicion';
export const FORMAT_VERSION = 1;
const TOWN_FIELDS = ['selected', 'choice', 'manual', 'drawing', 'stageEnd'];

/** Composición lista para guardar (función pura). */
export function snapshot({ id, nombre, raw, fileName, opts, extra, towns, osm, appVersion, miniatura, now = new Date() }) {
  const pueblos = {};
  for (const t of towns || []) {
    const o = {};
    for (const k of TOWN_FIELDS) if (t[k] !== undefined) o[k] = t[k];
    pueblos[t.id] = o;
  }
  return {
    formato: FORMAT, formato_version: FORMAT_VERSION, app: appVersion,
    id: id || `c${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nombre: (nombre || '').trim() || 'Sin título',
    guardado: now.toISOString(),
    gpx: { nombre: fileName || null, texto: raw },
    opciones: opts, extra: extra || {}, pueblos,
    osm: osm || null,
    ...(miniatura ? { miniatura } : {}),
  };
}

/** Comprueba que un objeto (p. ej. leído de un archivo) es una composición utilizable. */
export function checkProject(p) {
  if (!p || p.formato !== FORMAT) throw new Error('El archivo no es una composición de #ESTODOBAJADA · Arte');
  if (p.formato_version > FORMAT_VERSION) throw new Error('La composición es de una versión más nueva de la app');
  if (!p.gpx || typeof p.gpx.texto !== 'string' || !p.gpx.texto.includes('<')) throw new Error('La composición no contiene el GPX');
  return p;
}

/** Vuelve a aplicar las decisiones guardadas sobre las poblaciones recién calculadas. */
export function applyTownState(towns, saved) {
  let n = 0;
  for (const t of towns) {
    const s = saved && saved[t.id];
    if (!s) continue;
    for (const k of TOWN_FIELDS) if (s[k] !== undefined) t[k] = s[k];
    // una elección de monumento que ya no existe en los datos vuelve a la automática
    if (t.choice && !['cat', 'none'].includes(t.choice) && !t.heritage.some((h) => h.id === t.choice)) { t.choice = null; t.manual = false; }
    if (t.choice === 'cat' && !t.catalog) { t.choice = null; t.manual = false; }
    n++;
  }
  return n;
}

// ——— almacenamiento: en el servidor de Trek, por usuario ———
// (antes en el IndexedDB del navegador; así se ven desde cualquier equipo y entran en las copias
// de seguridad de Trek)
const API = 'trek/composiciones';
async function call(path, init) {
  let r;
  try { r = await fetch(path, init); } catch { throw new Error('Sin conexión con el servidor'); }
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try { const j = await r.json(); if (j && j.error) msg = j.error; } catch { /* sin detalle */ }
    if (r.status === 413) msg = 'La composición es demasiado grande para guardarla';
    throw new Error(msg);
  }
  return r;
}
const one = (id) => `${API}/${encodeURIComponent(id)}`;
/** @param extra campos que solo viajan al guardar (p. ej. `imagen`: el mapa pintado, para Studio) */
export const saveProject = (p, extra = {}) => call(one(p.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, ...extra }) }).then(() => p);
export const getProject = (id) => call(one(id), { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
export const deleteProject = (id) => call(one(id), { method: 'DELETE' });
/** Lista resumida, la más reciente primero (sin cargar las composiciones enteras). */
export async function listProjects() {
  const j = await (await call(API, { cache: 'no-store' })).json();
  return (j.composiciones || []).sort((a, b) => String(b.guardado).localeCompare(String(a.guardado)));
}

/** Filtra y ordena la lista de composiciones para la galería. */
export function filterProjects(list, q = '', orden = 'fecha') {
  const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = norm(q).split(/\s+/).filter(Boolean);
  const out = list.filter((it) => { const t = norm(`${it.nombre} ${it.gpx || ''}`); return words.every((w) => t.includes(w)); });
  if (orden === 'nombre') out.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true, sensitivity: 'base' }));
  else if (orden === 'antiguas') out.sort((a, b) => String(a.guardado).localeCompare(String(b.guardado)));
  else out.sort((a, b) => String(b.guardado).localeCompare(String(a.guardado)));
  return out;
}

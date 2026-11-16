// Composiciones guardadas: el GPX original (texto literal, sin tocar), las opciones de diseño,
// las decisiones por población y los datos de OpenStreetMap ya descargados, para reabrir un
// mapa tal como se dejó sin consultar OSM de nuevo.
// Se guardan en el navegador (IndexedDB) y se pueden exportar/importar como archivo .json.

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

// ——— almacenamiento en el navegador ———
const DB = 'etb-arte';
const STORE = 'composiciones';
function open() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('Este navegador no permite guardar composiciones')); return; }
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('No se pudo abrir el almacén del navegador'));
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(out && 'result' in out ? out.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error || new Error('Sin espacio en el navegador')); };
  });
}
export const saveProject = (p) => tx('readwrite', (s) => s.put(p)).then(() => p);
export const getProject = (id) => tx('readonly', (s) => s.get(id));
export const deleteProject = (id) => tx('readwrite', (s) => s.delete(id));
/** Lista resumida, la más reciente primero (sin cargar todo en pantalla). */
export async function listProjects() {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  return all.map((p) => ({ id: p.id, nombre: p.nombre, guardado: p.guardado, gpx: p.gpx && p.gpx.nombre, conOsm: !!p.osm, miniatura: p.miniatura || null }))
    .sort((a, b) => String(b.guardado).localeCompare(String(a.guardado)));
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

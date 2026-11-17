// Peticiones de dibujo propio: un issue con la etiqueta «dibujo» en el repositorio de
// ilustraciones, enviado por el servidor o, si no está configurado, abierto en GitHub ya rellenado.
import { KIND_LABEL } from './osm.js';

export const REPO = 'MelAnubis/estodobajada-arte';
const PLACE = { city: 'ciudad', town: 'villa', village: 'pueblo', hamlet: 'aldea', poi: 'en el campo' };

export function osmUrl(id) {
  const m = /^([nwr])(\d+)$/.exec(id || '');
  if (!m) return null;
  return `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[m[1]]}/${m[2]}`;
}

const fmt = (n) => Number(n).toFixed(5);

/** Datos del monumento elegido (o candidatos, si aún no hay ninguno elegido). */
function monumentInfo(t) {
  if (t.choice === 'cat' && t.catalog) {
    const h = (t.heritage || []).find((x) => x.id === t.catalog.osmId);
    return { name: t.catalog.monumento, kind: t.catalog.tipo, osm: t.catalog.osmId, lat: t.catalog.lat, lon: t.catalog.lon,
      wikidata: (h && h.wikidata) || t.catalog.wikidata || null, wikipedia: h && h.wikipedia, current: `catálogo · «${t.catalog.ilustracion}»` };
  }
  const h = t.heritage.find((x) => x.id === t.choice);
  if (h) return { name: h.name, kind: h.kind, osm: h.id, lat: h.lat, lon: h.lon, wikidata: h.wikidata, wikipedia: h.wikipedia, current: `tipológico (${(KIND_LABEL[h.kind] || h.kind).toLowerCase()})` };
  return null;
}

function townBlock(t, routeName, i) {
  const m = monumentInfo(t);
  const lines = [];
  lines.push(`### ${i != null ? `${i}. ` : ''}${m ? m.name : '(monumento por decidir)'} — ${t.name}`);
  lines.push(`- **Población:** ${t.name} (${PLACE[t.place] || t.place}${t.place === 'poi' && t.nearTown ? `, cerca de ${t.nearTown}` : ''}) · km ${Math.round(t.along / 1000)} de «${routeName}»`);
  if (m) {
    lines.push(`- **Monumento:** ${m.name} (${KIND_LABEL[m.kind] || m.kind})${osmUrl(m.osm) ? ` · [OSM](${osmUrl(m.osm)})` : ''}${m.wikidata ? ` · [Wikidata](https://www.wikidata.org/wiki/${m.wikidata})` : ''}`);
    lines.push(`- **Coordenadas:** ${fmt(m.lat)}, ${fmt(m.lon)} · [ver en el mapa](https://www.openstreetmap.org/?mlat=${fmt(m.lat)}&mlon=${fmt(m.lon)}#map=17/${fmt(m.lat)}/${fmt(m.lon)})`);
    lines.push(`- **Dibujo actual:** ${m.current}`);
  } else {
    const cands = t.heritage.slice(0, 6).map((h) => `${h.name} (${(KIND_LABEL[h.kind] || h.kind).toLowerCase()})`);
    lines.push(`- **Candidatos en OSM:** ${cands.length ? cands.join(' · ') : 'ninguno con nombre: elige tú el más característico'}`);
    lines.push(`- **Coordenadas del pueblo:** ${fmt(t.lat)}, ${fmt(t.lon)}`);
  }
  const data = { poblacion: t.name, lugar: t.place, monumento: m ? m.name : null, tipo: m ? m.kind : null, osm: m ? m.osm : null, wikidata: m && m.wikidata ? m.wikidata : null, lat: m ? +fmt(m.lat) : +fmt(t.lat), lon: m ? +fmt(m.lon) : +fmt(t.lon) };
  return { text: lines.join('\n'), data };
}

/** Título y cuerpo de la petición (issue con etiqueta «dibujo»). */
export function requestIssue(towns, routeName) {
  const list = Array.isArray(towns) ? towns : [towns];
  const blocks = list.map((t, i) => townBlock(t, routeName, list.length > 1 ? i + 1 : null));
  const first = blocks[0].data;
  const title = list.length === 1
    ? `Dibujo: ${first.monumento || 'monumento'} (${first.poblacion})`
    : `Dibujos: ${list.length} monumentos de «${routeName}»`;
  const body = [
    'Petición de dibujo propio creada desde los mapas ilustrados de Trek.',
    '',
    ...blocks.map((b) => b.text + '\n'),
    '### Rasgos que no pueden faltar',
    '_(opcional: torres, cúpula, materiales, lo que lo hace reconocible)_',
    '',
    '### Fotos de referencia',
    '_(opcional: arrastra aquí una o varias fotos)_',
    '',
    `<!-- datos-peticion ${JSON.stringify(blocks.map((b) => b.data))} -->`,
  ].join('\n');
  return { title, body, labels: ['dibujo'] };
}

/** URL de «nuevo issue» en GitHub (alternativa cuando el servidor no envía peticiones). */
export function requestUrl(towns, routeName) {
  const { title, body } = requestIssue(towns, routeName);
  const q = new URLSearchParams({ title, body, labels: 'dibujo' });
  return `https://github.com/${REPO}/issues/new?${q.toString()}`;
}

/**
 * Envía la petición desde la app a través del servidor (api/peticion), sin salir de ella.
 * El servidor la acepta con la sesión de Trek (no hay clave aparte).
 * @returns {status:'ok', number, url} | {status:'token'} (el repositorio rechaza el token del servidor)
 *          | {status:'limite'} | {status:'off'} (no configurado o sin respuesta)
 */
export async function sendRequest(towns, routeName, notas = '', fetchFn = fetch) {
  const issue = requestIssue(towns, routeName);
  if (notas && notas.trim()) issue.body = issue.body.replace('_(opcional: torres, cúpula, materiales, lo que lo hace reconocible)_', notas.trim());
  let r;
  try {
    r = await fetchFn('api/peticion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issue),
    });
  } catch { return { status: 'off' }; }
  if (r.status === 201) { const j = await r.json(); return { status: 'ok', number: j.number, url: j.html_url }; }
  // 401/403/404: es el repositorio quien rechaza el token (caducado o sin permiso «Issues»)
  if (r.status === 401 || r.status === 403 || r.status === 404) return { status: 'token', code: r.status };
  if (r.status === 429) return { status: 'limite', code: 429 };
  return { status: 'off', code: r.status };
}

/** ¿Está el envío directo configurado en el servidor? */
export async function directAvailable(fetchFn = fetch) {
  try { const r = await fetchFn('api/peticion/estado', { cache: 'no-store' }); return r.status === 204; } catch { return false; }
}

/** ¿Merece la pena pedir dibujo? (no si ya tiene uno propio o una imagen del usuario) */
export function hasOwnDrawing(t, hasSpecific) {
  return t.choice === 'cat' && t.catalog && (t.catalog.imagen || hasSpecific(t.catalog.ilustracion));
}

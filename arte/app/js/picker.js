// Selector de dibujo: buscador con miniaturas y sugerencias ordenadas, en lugar de un
// desplegable con todos los dibujos (que crece sin fin a medida que se añaden).
import { haversine, normalizeName } from './geo.js';

const SHOW = 8;   // por sección sin buscar

/**
 * Opciones ordenadas para una población (función pura, se prueba en Node).
 * @param town   población de la lista (name, lat, lon, catalog, heritage, choice)
 * @param ctx    { metas: [{id,nombre,tipo,poblacion,lat,lon}], typologies: [id], kindLabel, kind, query }
 * @returns [{ title, items: [{ id, label, sub, kind, score }] , more }]
 */
export function pickerSections(town, { metas, typologies, kindLabel = {}, kind = null, query = '', images = [] }) {
  const here = { lat: town.lat, lon: town.lon };
  const tname = normalizeName(town.name);
  const catId = town.catalog && town.catalog.ilustracion;
  const catImg = town.catalog && town.catalog.imagen;
  const q = normalizeName(query).split(' ').filter(Boolean);
  // cada palabra buscada debe ser el comienzo de una palabra del texto («oña» no encuentra «monasterio»)
  const hit = (txt) => { const words = txt.split(' '); return q.every((w) => words.some((x) => x.startsWith(w))); };
  const km = (m) => (m.lat != null && m.lon != null ? haversine(here, m) / 1000 : null);
  const dist = (d) => (d != null ? `a ${d < 10 ? d.toFixed(1) : Math.round(d)} km` : null);
  const own = metas.map((m) => {
    const d = km(m);
    const local = m.id === catId || normalizeName(m.poblacion) === tname || (d != null && d < 3);
    return {
      id: m.id, label: m.nombre || m.id, kind: m.tipo || kind,
      sub: [m.poblacion, m.tipo ? (kindLabel[m.tipo] || m.tipo).toLowerCase() : null, !local ? dist(d) : null].filter(Boolean).join(' · '),
      d: d == null ? Infinity : d, local, sameKind: !!kind && m.tipo === kind,
      text: normalizeName(`${m.nombre} ${m.poblacion || ''} ${m.tipo || ''} ${kindLabel[m.tipo] || ''} dibujo`),
    };
  });
  // acuarelas del catálogo (PNG): las de este monumento van primero; las demás, como cualquier dibujo
  const pics = images.map((im) => {
    const d = km(im);
    const local = im.path === catImg || normalizeName(im.poblacion) === tname || (d != null && d < 3);
    return {
      id: `img:${im.path}`, label: `Acuarela: ${im.monumento || im.poblacion || 'ilustración'}`, kind: im.tipo || kind, isImage: true,
      sub: [im.poblacion, im.tipo ? (kindLabel[im.tipo] || im.tipo).toLowerCase() : null, !local ? dist(d) : null, im.ia ? 'generada a partir de una foto' : 'tu ilustración'].filter(Boolean).join(' · '),
      d: im.path === catImg ? -1 : d == null ? Infinity : d, local, sameKind: !!kind && im.tipo === kind,
      text: normalizeName(`${im.monumento || ''} ${im.poblacion || ''} ${im.tipo || ''} ${kindLabel[im.tipo] || ''} acuarela imagen ilustracion`),
    };
  });
  const all = pics.concat(own);
  const generic = typologies.map((id) => ({
    id, label: kindLabel[id] || id, sub: 'dibujo genérico (con variantes)', kind: id, d: Infinity,
    sameKind: id === kind, text: normalizeName(`${kindLabel[id] || id} ${id} generico`),
  }));
  const byNear = (a, b) => a.d - b.d || (b.isImage ? 1 : 0) - (a.isImage ? 1 : 0);
  if (q.length) {
    const found = all.filter((o) => hit(o.text)).sort((a, b) => b.local - a.local || byNear(a, b))
      .concat(generic.filter((g) => hit(g.text)));
    return [{ title: found.length ? `Resultados (${found.length})` : 'Sin resultados', items: found, more: 0 }];
  }
  const local = all.filter((o) => o.local).sort(byNear);
  const same = all.filter((o) => !o.local && o.sameKind).sort(byNear);
  const rest = all.filter((o) => !o.local && !o.sameKind).sort(byNear);
  const gen = generic.slice().sort((a, b) => b.sameKind - a.sameKind);
  const sec = [];
  if (local.length) sec.push({ title: `Para ${town.name}`, items: local, more: 0 });
  if (same.length) sec.push({ title: `Del mismo tipo (${(kindLabel[kind] || kind || '').toLowerCase()}), los más cercanos`, items: same.slice(0, SHOW), more: Math.max(0, same.length - SHOW) });
  sec.push({ title: 'Genéricos', items: gen.slice(0, kind ? 4 : SHOW), more: Math.max(0, gen.length - (kind ? 4 : SHOW)) });
  if (rest.length) sec.push({ title: 'Otros dibujos y acuarelas, por cercanía', items: rest.slice(0, SHOW), more: Math.max(0, rest.length - SHOW) });
  return sec;
}

/** Miniatura SVG de un dibujo (usa los filtros del documento, definidos en #thumb-defs). */
export function thumbSvg(drawing) {
  const { body, w, h } = drawing;
  return `<svg viewBox="${(-w / 2 - 6).toFixed(1)} ${(-h - 6).toFixed(1)} ${(w + 12).toFixed(1)} ${(h + 14).toFixed(1)}" aria-hidden="true">${body}</svg>`;
}

/**
 * Abre el selector para una población.
 * @param opts { town, title, autoLabel, current, sectionsFor(query), drawingFor(id, kind), onPick(id), defs }
 */
export function openPicker(opts) {
  const modal = document.getElementById('pick-modal');
  const list = document.getElementById('pick-list');
  const input = document.getElementById('pick-q');
  document.getElementById('pick-h').textContent = opts.title;
  let defs = document.getElementById('thumb-defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.id = 'thumb-defs';
    defs.setAttribute('width', '0'); defs.setAttribute('height', '0');
    defs.style.position = 'absolute';
    document.body.append(defs);
  }
  defs.innerHTML = opts.defs || '';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const card = (id, label, sub, kind) => {
    let th = '';
    try {
      if (id === 'auto') th = opts.autoThumb || '';
      else if (id.startsWith('img:')) th = `<img src="${esc(opts.imageHref ? opts.imageHref(id.slice(4)) : '')}" alt="">`;
      else th = thumbSvg(opts.drawingFor(id, kind));
    } catch { th = ''; }
    return `<button type="button" class="pick-item${id === opts.current ? ' on' : ''}" data-id="${esc(id)}"><span class="pick-th">${th}</span><span class="pick-tx"><b>${esc(label)}</b><small>${esc(sub || '')}</small></span></button>`;
  };
  const paint = () => {
    const secs = opts.sectionsFor(input.value);
    let html = input.value ? '' : `<div class="pick-sec">${card('auto', opts.autoLabel, 'lo que corresponde a este monumento', null)}</div>`;
    for (const s of secs) {
      html += `<div class="pick-sec"><h4>${esc(s.title)}</h4>${s.items.map((i) => card(i.id, i.label, i.sub, i.kind)).join('')}`;
      if (s.more) html += `<p class="pick-more">y ${s.more} más: escribe para buscarlos</p>`;
      html += '</div>';
    }
    list.innerHTML = html;
  };
  const close = () => { modal.hidden = true; input.removeEventListener('input', paint); };
  list.onclick = (e) => {
    const b = e.target.closest('.pick-item');
    if (!b) return;
    close();
    opts.onPick(b.dataset.id);
  };
  document.getElementById('pick-close').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  input.value = '';
  input.addEventListener('input', paint);
  paint();
  modal.hidden = false;
  input.focus();
}

import { VERSION } from './version.js';
import { parseGPX, allSegments, countPoints } from './gpx.js';
import { bboxOf, expandBbox, profileOf, haversine, nearestOnRoute, hashString } from './geo.js';
import { fetchOSM, KIND_LABEL } from './osm.js';
import { buildTowns, autoChoice, chosenMonument, setImageCredits } from './heritage.js';
import { pickerSections, openPicker, thumbSvg } from './picker.js';
import { renderMap, mapExtent, thumbDefs, FORMATS, ROUTE_COLORS, STYLES } from './render.js';
import { buildRelief } from './relief.js';
import { validate } from './integrity.js';
import { autoStageEnds, STAGE_COLORS } from './guide.js';
import { requestUrl, hasOwnDrawing, sendRequest, directAvailable } from './request.js';
import { hasSpecific, SPECIFIC_IDS, TYPOLOGICAL_IDS, loadDrawings, drawingMeta, allDrawingMeta, monumentDrawing } from './illustrations.js';
import { screenFontCss, embeddedFontCss, download, slug, svgToPng } from './export.js';
import { FONT_ROLES, FONT_SIZES } from './fonts.js';
import { snapshot, checkProject, applyTownState, saveProject, getProject, deleteProject, listProjects, filterProjects } from './projects.js';

const $ = (id) => document.getElementById(id);
const state = { raw: null, fileName: null, model: null, osm: null, towns: [], catalog: [], result: null, report: null, maxDist: 3000, abort: null };
const OPT_IDS = ['credits', 'style', 'layout', 'campina', 'showWater', 'showUrban', 'showRelief', 'format', 'routeColor', 'monumentScale', 'showWoods', 'showRivers', 'showRoads', 'showRails', 'showPeaks', 'showPasses', 'showProfile', 'showCompass', 'showKm', 'showArrows', 'showMonumentNames',
  ...Object.keys(FONT_ROLES).map((r) => 'font_' + r), ...Object.keys(FONT_SIZES)];

// selectores de tipografía y tamaños de letra
for (const [role, r] of Object.entries(FONT_ROLES)) {
  const lb = document.createElement('label');
  lb.className = 'field';
  lb.textContent = r.label;
  const sel = document.createElement('select');
  sel.id = 'font_' + role;
  for (const [k, o] of Object.entries(r.options)) {
    const op = new Option(o.label, k);
    op.style.fontFamily = `'${o.family}'`;
    sel.append(op);
  }
  sel.addEventListener('change', () => { sel.style.fontFamily = `'${r.options[sel.value].family}'`; });
  sel.style.fontFamily = `'${Object.values(r.options)[0].family}'`;
  lb.append(sel);
  $('font-selects').append(lb);
}
for (const [id, label] of Object.entries(FONT_SIZES)) {
  const row = document.createElement('label');
  row.className = 'size-row';
  row.innerHTML = `<span>${label}</span><input type="range" id="${id}" min="0.6" max="1.8" step="0.05" value="1"><output>100 %</output>`;
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.addEventListener('input', () => { out.textContent = Math.round(inp.value * 100) + ' %'; });
  $('font-sizes').append(row);
}

// ——— arranque ———
for (const [k, v] of Object.entries(STYLES)) $('style').append(new Option(v.label, k));
const showStyleDesc = () => { $('style-desc').textContent = STYLES[$('style').value].desc; };
$('style').addEventListener('change', showStyleDesc);
showStyleDesc();

// tipos de patrimonio que se tienen en cuenta al elegir el monumento de cada pueblo
const KIND_ORDER = ['castillo', 'muralla', 'puerta', 'acueducto', 'catedral', 'monasterio', 'iglesia', 'palacio', 'torre', 'puente', 'ermita', 'ruinas', 'yacimiento', 'museo', 'monumento'];
const kinds = new Set(KIND_ORDER.filter((k) => k !== 'monumento'));
function renderKinds() {
  const box = $('kinds');
  box.innerHTML = '';
  for (const k of KIND_ORDER) {
    const lb = document.createElement('label');
    lb.className = kinds.has(k) ? 'on' : '';
    lb.innerHTML = `<input type="checkbox" ${kinds.has(k) ? 'checked' : ''}>${KIND_LABEL[k]}`;
    lb.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) kinds.add(k); else kinds.delete(k);
      lb.classList.toggle('on', e.target.checked);
      for (const t of state.towns) if (!t.manual) t.choice = autoChoice(t, kinds);
      renderTowns();
      draw();
    });
    box.append(lb);
  }
}
// nombres legibles de los dibujos propios: vienen de data/dibujos/indice.json
const drawName = (id) => (drawingMeta(id) && drawingMeta(id).nombre) || KIND_LABEL[id] || id;

for (const [k, v] of Object.entries(FORMATS)) $('format').append(new Option(v.label, k));
for (const [k, v] of Object.entries(ROUTE_COLORS)) $('routeColor').append(new Option(v.label, k));

state.images = {};
// Dibujos propios: módulos en data/dibujos (llegan con la sincronización, sin reconstruir Docker).
state.drawingsReady = loadDrawings('data/dibujos/').catch((e) => { console.warn(e); return 0; }).then((n) => {
  if (state.model) { renderTowns(); draw(); }
  return n;
});
state.catalogReady = fetch('data/catalogo-patrimonio.json', { cache: 'no-cache' }).then((r) => r.json()).then((j) => {
  state.catalog = j.entradas || [];
  setImageCredits(state.catalog);
  loadCatalogImages();
}).catch(() => toast('No se pudo leer el catálogo de patrimonio'));

// Ilustraciones propias del catálogo («imagen»): se leen sus proporciones para maquetarlas.
async function loadCatalogImages() {
  const missing = [];
  await Promise.all(state.catalog.filter((c) => c.imagen).map((c) => new Promise((res) => {
    const href = 'data/' + encodeURI(c.imagen);
    const img = new Image();
    img.onload = () => { state.images[c.imagen] = { href, w: img.naturalWidth || 400, h: img.naturalHeight || 300 }; res(); };
    img.onerror = () => { missing.push(c.imagen); res(); };
    img.src = href;
  })));
  if (missing.length) toast(`No se encontró: ${missing.join(', ')}. Se usa el dibujo en su lugar.`, 6000);
  if (state.model) { renderTowns(); draw(); }
}

// Para exportar, las imágenes se incrustan como data: URL (el SVG/PNG queda autónomo).
const embeddedImages = {};
async function embedImages() {
  const out = {};
  for (const [k, v] of Object.entries(state.images)) {
    if (!embeddedImages[k]) {
      const blob = await (await fetch(v.href)).blob();
      embeddedImages[k] = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    }
    out[k] = { ...v, href: embeddedImages[k] };
  }
  return out;
}

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

function readOpts() {
  const o = {};
  for (const id of OPT_IDS) {
    const el = $(id);
    o[id] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
  }
  o.title = $('title').value.trim();
  o.subtitle = $('subtitle').value.trim();
  o.description = $('description').value.trim();
  o.motto = $('motto').value.trim();
  return o;
}

// ——— carga de GPX ———
async function loadGPX(text, name) {
  let model;
  try { model = parseGPX(text); } catch (e) { toast('No se pudo leer el GPX: ' + e.message, 5000); return; }
  state.raw = text; state.fileName = name; state.model = model; state.osm = null; state.towns = []; state.relief = null;
  comp.id = null; comp.nombre = null; comp.dirty = false;
  $('title').value = model.name;
  paintCompStatus();
  renderComps();
  showStats();
  draw(true);
  await loadOSM();
}

function showStats() {
  const m = state.model;
  const segs = allSegments(m);
  const prof = profileOf(segs);
  const pts = segs.flatMap((s) => s.points);
  const circ = haversine(pts[0], pts[pts.length - 1]) < 500;
  const st = $('stats');
  st.hidden = false;
  st.innerHTML = [
    ['Distancia', `${(prof.total / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`],
    ['Puntos', countPoints(m).toLocaleString('es-ES')],
    ['Segmentos', segs.length],
    ['Tipo', circ ? 'Circular' : 'Lineal'],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('stage-title').textContent = m.name;
}

async function loadOSM(saved = null) {
  if (!state.model) return;
  await state.catalogReady;
  if (state.abort) state.abort.abort();
  state.abort = new AbortController();
  const pts = allSegments(state.model).flatMap((s) => s.points);
  const bbox = expandBbox(bboxOf(pts), 6500);
  const status = $('osm-status');
  status.classList.remove('err');
  status.textContent = 'Consultando OpenStreetMap…';
  $('osm-actions').hidden = true;
  try {
    state.osm = saved && saved.osm ? saved.osm : await fetchOSM(bbox, { signal: state.abort.signal, onStatus: (s) => { status.textContent = s; } });
    const prof = profileOf(allSegments(state.model));
    state.towns = buildTowns(state.osm, prof, state.catalog);
    for (const t of state.towns) t.choice = autoChoice(t, kinds);
    const nH = state.osm.heritage.length;
    const nW = state.osm.waters.length + state.osm.wetlands.length;
    status.textContent = `${state.towns.length} poblaciones a menos de 6 km · ${nH} elementos patrimoniales · ${nW} láminas de agua y humedales en OSM${state.osm.timestamp ? ' · datos del ' + new Date(state.osm.timestamp).toLocaleDateString('es-ES') : ''}${saved && saved.osm ? ' (guardados con la composición; «Volver a consultar OSM» los actualiza)' : ''}.`;
  } catch (e) {
    if (e.name === 'AbortError') return;
    state.osm = null;
    state.towns = offlineTowns();
    status.classList.add('err');
    status.textContent = `${e.message}. Se muestran solo las poblaciones del catálogo curado cercanas a la ruta (posición aproximada); sin ríos ni bosques.`;
  }
  $('osm-actions').hidden = false;
  applyAutoStages();
  if (saved && saved.pueblos) {
    applyTownState(state.towns, saved.pueblos);
    for (const t of state.towns) if (!t.choice) t.choice = autoChoice(t, kinds);
  }
  $('towns-tools').hidden = !state.towns.length;
  $('kinds').hidden = !state.osm;
  $('kinds-h').hidden = !state.osm;
  renderKinds();
  renderTowns();
  draw(true);
}

// Sin conexión: solo localidades del catálogo curado próximas al trazado.
function offlineTowns() {
  const prof = profileOf(allSegments(state.model));
  return state.catalog.map((c) => {
    const near = nearestOnRoute(prof, c.lat, c.lon);
    return {
      id: 'cat-' + c.id, name: c.poblacion || c.rotulo || c.monumento, place: 'town', lat: c.lat, lon: c.lon, dist: near.dist, along: near.along, crossed: near.dist < 450,
      heritage: [], catalog: { ...c, positionSource: 'catálogo (aprox.)' }, choice: 'cat', selected: near.dist < 2500, label: c.poblacion || c.rotulo || c.monumento,
    };
  }).filter((t) => t.dist < 6000).sort((a, b) => a.along - b.along);
}

// ——— lista de poblaciones ———
const PLACE = { city: 'ciudad', town: 'villa', village: 'pueblo', hamlet: 'aldea', poi: 'en el campo' };
function renderTowns() {
  const ul = $('towns');
  ul.innerHTML = '';
  const visible = state.towns.filter((t) => t.dist <= state.maxDist || t.selected);
  if (!visible.length) { ul.innerHTML = '<li class="muted">No hay poblaciones dentro de esa distancia.</li>'; return; }
  for (const t of visible) {
    const li = document.createElement('li');
    li.className = 'town' + (t.selected ? '' : ' off');
    const dist = t.crossed ? 'la ruta pasa por aquí' : `a ${(t.dist / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
    const nearTxt = t.place === 'poi' && t.nearTown ? ` · cerca de ${t.nearTown}` : '';
    li.innerHTML = `<div class="town-head"><input type="checkbox" ${t.selected ? 'checked' : ''} aria-label="Incluir ${t.name}"><span class="town-name">${t.name}</span><span class="town-meta">km ${(t.along / 1000).toFixed(0)} · ${PLACE[t.place] || t.place}</span></div>
      <div class="src">${dist}${nearTxt}</div>`;
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `Monumento de ${t.name}`);
    if (t.catalog) sel.append(new Option(`★ ${t.catalog.monumento} — ${t.catalog.imagen && state.images[t.catalog.imagen] ? 'acuarela' : hasSpecific(t.catalog.ilustracion) ? 'dibujo propio' : 'dibujo tipológico'}`, 'cat'));
    for (const h of t.heritage.slice(0, 14)) sel.append(new Option(`${KIND_LABEL[h.kind] || h.kind} · ${h.name}${h.tags.heritage ? ' · protegido' : ''}`, h.id));
    sel.append(new Option('Solo caserío (sin monumento)', 'none'));
    sel.value = t.choice;
    const src = document.createElement('div');
    src.className = 'src';
    const setSrc = () => {
      if (t.choice === 'cat') src.innerHTML = `<span class="badge">catálogo</span> posición: ${t.catalog.positionSource}${t.catalog.nota ? ' · ' + t.catalog.nota : ''}`;
      else if (t.choice === 'none') src.textContent = t.heritage.length ? `${t.heritage.length} elemento(s) patrimonial(es) en OSM disponibles.` : 'OSM no registra patrimonio con nombre en este núcleo.';
      else {
        const h = t.heritage.find((x) => x.id === t.choice);
        src.innerHTML = `<span class="badge lt">OSM ${h.id}</span> dibujo tipológico (${(KIND_LABEL[h.kind] || h.kind).toLowerCase()})${h.wikidata ? ` · <a href="https://www.wikidata.org/wiki/${h.wikidata}" target="_blank" rel="noopener">Wikidata</a>` : ''}`;
      }
    };
    setSrc();
    // dibujo: botón con miniatura que abre el selector con buscador (no un desplegable infinito)
    const drw = document.createElement('button');
    drw.type = 'button';
    drw.className = 'draw-pick';
    const paintDrw = () => {
      const mon = chosenMonument({ ...t, drawing: 'auto' });
      const img = t.catalog && t.catalog.imagen && state.images[t.catalog.imagen];
      const manual = t.drawing && t.drawing !== 'auto';
      const manualImg = manual && t.drawing.startsWith('img:') ? state.images[t.drawing.slice(4)] : null;
      const imgEntry = manualImg && state.catalog.find((c) => c.imagen === t.drawing.slice(4));
      const name = manualImg ? `acuarela${imgEntry && imgEntry !== t.catalog ? ' de ' + imgEntry.monumento : ''}` : manual ? drawName(t.drawing) : img ? 'acuarela' : mon ? drawName(mon.illustration) : '—';
      let th = '';
      try {
        if (manualImg) th = `<img src="${manualImg.href}" alt="">`;
        else if (!manual && img) th = `<img src="${img.href}" alt="">`;
        else if (mon || manual) th = thumbSvg(monumentDrawing(manual ? t.drawing : mon.illustration, mon ? mon.kind : t.drawing, hashString(t.id), mon && mon.hint));
      } catch { th = ''; }
      drw.innerHTML = `<span class="pick-th">${th}</span><span>Dibujo: <b>${name}</b>${manual ? '' : ' <small>(automático)</small>'}</span><span class="caret">▾</span>`;
      drw.disabled = t.choice === 'none';
    };
    drw.addEventListener('click', () => {
      const mon = chosenMonument({ ...t, drawing: 'auto' });
      const img = t.catalog && t.catalog.imagen && state.images[t.catalog.imagen];
      const style = $('style').value;
      openPicker({
        title: `Dibujo para ${mon ? mon.name : t.name}`,
        defs: thumbDefs(style),
        current: t.drawing || 'auto',
        autoLabel: img ? 'Automático: acuarela' : `Automático: ${mon ? drawName(mon.illustration) : '—'}`,
        imageHref: (path) => (state.images[path] ? state.images[path].href : ''),
        autoThumb: img ? `<img src="${img.href}" alt="">` : (mon ? thumbSvg(monumentDrawing(mon.illustration, mon.kind, hashString(t.id), mon.hint)) : ''),
        sectionsFor: (q) => pickerSections(t, { metas: allDrawingMeta(), typologies: TYPOLOGICAL_IDS, kindLabel: KIND_LABEL, kind: mon ? mon.kind : null, query: q,
          images: state.catalog.filter((c) => c.imagen && state.images[c.imagen]).map((c) => ({ path: c.imagen, monumento: c.monumento, poblacion: c.poblacion, tipo: c.tipo, lat: c.lat, lon: c.lon, ia: !!c.ilustracion_ia })) }),
        drawingFor: (id, kind) => monumentDrawing(id, kind || (mon && mon.kind), hashString(t.id), mon && mon.hint),
        onPick: (id) => { t.drawing = id; paintDrw(); draw(); },
      });
    });
    paintDrw();
    sel.addEventListener('change', () => { t.choice = sel.value; t.manual = true; t.drawing = 'auto'; paintDrw(); setSrc(); draw(); });
    li.querySelector('input').addEventListener('change', (e) => { t.selected = e.target.checked; li.classList.toggle('off', !t.selected); draw(); });
    const se = document.createElement('label');
    if (t.place === 'poi') se.hidden = true;
    se.className = 'stage-end';
    se.innerHTML = `<input type="checkbox" ${t.stageEnd ? 'checked' : ''}> Fin de etapa aquí`;
    se.querySelector('input').addEventListener('change', (e) => { t.stageEnd = e.target.checked; if (t.stageEnd) t.selected = true; draw(); });
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'link ask';
    const setAsk = () => {
      ask.hidden = t.choice === 'none' && !t.heritage.length && t.place === 'poi';
      ask.textContent = hasOwnDrawing(t, hasSpecific) ? '✏️ Pedir mejora del dibujo' : '✏️ Pedir dibujo propio';
    };
    setAsk();
    sel.addEventListener('change', setAsk);
    ask.addEventListener('click', () => openRequest([t]));
    const pick = document.createElement('div');
    pick.className = 'pick';
    pick.append(sel, drw);
    li.append(pick, src, ask, se);
    ul.append(li);
  }
}

$('maxdist').addEventListener('input', (e) => {
  state.maxDist = Number(e.target.value) * 1000;
  $('maxdist-out').textContent = `${e.target.value.replace('.', ',')} km`;
  renderTowns();
});
// Peticiones de dibujo: se envían desde la app si el servidor lo tiene configurado;
// si no, se abre GitHub con la petición rellenada (como antes).
const KEY_STORE = 'etb-clave-peticiones';
const readKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const saveKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* sin almacenamiento */ } };
let directCheck = null;
let askList = null;
const routeName = () => $('title').value.trim() || state.model.name;

function openOnGithub(list) {
  window.open(requestUrl(list, routeName()), '_blank', 'noopener');
  toast('Se abre GitHub con la petición rellenada: pulsa «Submit new issue».', 6000);
}

async function openRequest(list) {
  if (!directCheck) directCheck = directAvailable();
  if (!(await directCheck)) { openOnGithub(list); return; }
  askList = list;
  const names = list.map((t) => t.name);
  $('ask-what').textContent = list.length === 1 ? `${names[0]}: el ilustrador lo busca, lo dibuja y lo añade al catálogo en unos minutos.` : `${list.length} poblaciones: ${names.slice(0, 6).join(', ')}${list.length > 6 ? '…' : ''}.`;
  $('ask-notes').value = '';
  $('ask-key').value = readKey();
  $('ask-key-wrap').hidden = !!readKey();
  $('ask-err').hidden = true;
  $('ask-modal').hidden = false;
  (readKey() ? $('ask-notes') : $('ask-key')).focus();
}
function closeAsk() { $('ask-modal').hidden = true; askList = null; }
$('ask-cancel').addEventListener('click', closeAsk);
$('ask-modal').addEventListener('click', (e) => { if (e.target === $('ask-modal')) closeAsk(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ask-modal').hidden) closeAsk(); });
$('ask-github').addEventListener('click', () => { const l = askList; closeAsk(); if (l) openOnGithub(l); });
$('ask-send').addEventListener('click', async () => {
  const key = $('ask-key').value.trim();
  if (!key) { $('ask-key-wrap').hidden = false; $('ask-err').textContent = 'Escribe la clave de peticiones.'; $('ask-err').hidden = false; $('ask-key').focus(); return; }
  $('ask-send').disabled = true;
  const res = await sendRequest(askList, routeName(), key, $('ask-notes').value);
  $('ask-send').disabled = false;
  if (res.status === 'ok') {
    if ($('ask-remember').checked) saveKey(key);
    closeAsk();
    toast(`✓ Petición nº ${res.number} enviada. En unos minutos la ilustración estará en el catálogo.`, 7000);
  } else if (res.status === 'clave') {
    saveKey('');
    $('ask-key-wrap').hidden = false;
    $('ask-err').textContent = 'Clave incorrecta.';
    $('ask-err').hidden = false;
    $('ask-key').select();
  } else if (res.status === 'token') {
    if ($('ask-remember').checked) saveKey(key);
    $('ask-err').textContent = `La clave es correcta, pero GitHub rechaza el token del servidor (error ${res.code}): revisa que PETICION_TOKEN no haya caducado y tenga el permiso «Issues: Read and write».`;
    $('ask-err').hidden = false;
  } else if (res.status === 'limite') {
    $('ask-err').textContent = 'Demasiadas peticiones seguidas: espera un minuto y vuelve a intentarlo.';
    $('ask-err').hidden = false;
  } else {
    $('ask-err').textContent = `El servidor no ha podido enviarla${res.code ? ` (error ${res.code})` : ''}. Puedes abrirla en GitHub.`;
    $('ask-err').hidden = false;
  }
});
$('ask-all').addEventListener('click', () => {
  const list = state.towns.filter((t) => t.selected && t.choice !== 'none' && !hasOwnDrawing(t, hasSpecific));
  if (!list.length) { toast('Todas las poblaciones seleccionadas ya tienen dibujo propio.'); return; }
  openRequest(list.slice(0, 25));
});
$('towns-tools').addEventListener('click', (e) => {
  const mode = e.target.dataset.sel;
  if (!mode) return;
  for (const t of state.towns) {
    if (mode === 'none') t.selected = false;
    else if (mode === 'all') t.selected = t.dist <= state.maxDist;
    else t.selected = t.dist <= ({ city: 3500, town: 2500, village: 1500, hamlet: 400 }[t.place] || 1500) && (t.place !== 'hamlet' || t.dist < 250);
  }
  renderTowns();
  draw();
});
$('osm-retry').addEventListener('click', () => {
  // conserva lo elegido en cada pueblo al refrescar los datos
  const pueblos = snapshot({ towns: state.towns, raw: '' }).pueblos;
  loadOSM({ pueblos });
});

// ——— dibujo ———
// El mapa NO se repinta con cada cambio (es lento con muchos datos): los cambios se acumulan y se
// aplican con «Regenerar mapa». Solo se pinta solo al cargar una ruta o datos de OSM nuevos.
let drawTimer = null;
let drawn = false;
function draw(force) {
  if (!state.model) return;
  if (force !== true) markDirty();
  if (force === true || !drawn) {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(drawNow, 60);
    return;
  }
  setPending(true);
}
function setPending(on) {
  $('regen').classList.toggle('pending', on);
  $('regen-note').hidden = !on;
}
$('regen').addEventListener('click', () => draw(true));
// deja que el navegador pinte el aviso «Generando…» antes del trabajo pesado
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
function busy(on) { $('busy').hidden = !on; }

// La vista previa es un mapa de bits pintado una sola vez por redibujado: el SVG lleva cientos de
// filtros de acuarela y, como elemento vivo, el navegador los recalculaba en cada fotograma de
// zoom o arrastre, dejando la página congelada. La exportación sigue usando el SVG.
let drawSeq = 0;
let preview = null; // { result, k }: último mapa compuesto y escala a la que está pintado
// escala de pintado necesaria para verse nítido con el zoom actual (o el de encaje, si es mayor)
function neededScale(w, h) {
  const vp = $('viewport').getBoundingClientRect();
  const fitS = Math.min((vp.width - 40) / w, (vp.height - 40) / h);
  const dpr = window.devicePixelRatio || 1;
  const cap = Math.sqrt(12e6 / (w * h));
  return Math.min(cap, 2.5, Math.max(1, Math.max(view.s, fitS) * dpr));
}
async function showPreview(result, opts, seq, k) {
  const { w, h } = result.layout;
  k = k || neededScale(w, h);
  const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo pintar la vista previa')); img.src = url; });
    if (seq !== drawSeq) return;
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (seq !== drawSeq) return;
    const box = $('canvas');
    const first = !box.firstElementChild;
    box.replaceChildren(c);
    box.dataset.w = w;
    box.dataset.h = h;
    preview = { result, k };
    if (opts && (first || box.dataset.fmt !== opts.format)) { box.dataset.fmt = opts.format; fit(); }
  } finally {
    URL.revokeObjectURL(url);
  }
}
// tras acercar el zoom, se repinta una vez con más resolución (sin recomponer el mapa)
let sharpTimer = null;
function sharpenLater() {
  clearTimeout(sharpTimer);
  sharpTimer = setTimeout(() => {
    if (!preview) return;
    const { w, h } = preview.result.layout;
    const k = neededScale(w, h);
    if (k <= preview.k * 1.6) return;
    const seq = drawSeq;
    busy(true);
    nextPaint().then(() => showPreview(preview.result, null, seq, k)).catch(() => {}).finally(() => busy(false));
  }, 600);
}

// Relieve real: se pide una vez por ruta/formato y se reutiliza mientras cubra el recuadro del mapa.
async function ensureRelief(opts) {
  if (!opts.showRelief || !state.model) return;
  const ext = mapExtent(state.model, opts);
  const r = state.relief;
  if (r && r.minLat <= ext.minLat && r.maxLat >= ext.maxLat && r.minLon <= ext.minLon && r.maxLon >= ext.maxLon) return;
  try {
    state.relief = await buildRelief(ext, { px: Math.round(ext.widthPx * 1.4) });
    if (!state.relief) toast('No se pudo descargar el relieve; el mapa sale sin sombreado del terreno.', 5000);
  } catch (e) {
    console.warn(e);
    state.relief = null;
  }
}

async function drawNow() {
  await state.drawingsReady;
  if (!state.model) return;
  const opts = readOpts();
  const seq = ++drawSeq;
  setPending(false);
  $('regen').disabled = true;
  busy(true);
  await nextPaint();
  // fuentes e imágenes incrustadas (en caché): la vista previa se pinta como imagen aislada
  const [fontCss, images] = await Promise.all([embeddedFontCss(opts), embedImages(), ensureRelief(opts)]);
  if (seq !== drawSeq) return;
  let result;
  try {
    result = renderMap(state.model, { osm: state.osm, towns: state.towns, opts, fontCss, images, relief: state.relief });
  } catch (e) {
    console.error(e);
    toast('Error al componer el mapa: ' + e.message, 6000);
    busy(false);
    $('regen').disabled = false;
    return;
  }
  state.result = result;
  try {
    await showPreview(result, opts, seq);
  } catch (e) {
    console.error(e);
    toast(e.message, 5000);
  }
  if (seq !== drawSeq) return;
  busy(false);
  drawn = true;
  $('regen').disabled = false;
  for (const b of ['ex-svg', 'ex-png', 'ex-gpx', 'ex-report']) $(b).disabled = false;
  state.report = await validate(state.model, state.raw, result.svg, result.projection);
  showChecks(state.report);
}

function showChecks(rep) {
  $('checks').innerHTML = rep.checks.map((c) => `<li class="${c.ok ? 'ok' : 'ko'}"><span class="mk">${c.ok ? '✓' : '✗'}</span><span>${c.label}<small>${c.detail}</small></span></li>`).join('')
    + `<li class="${rep.ok ? 'ok' : 'ko'}"><span class="mk">${rep.ok ? '✓' : '!'}</span><span><b>${rep.ok ? 'El mapa respeta el GPX original.' : 'Hay diferencias con el GPX.'}</b><small>SHA-256 ${rep.sha256}</small></span></li>`;
}

for (const id of [...OPT_IDS, 'title', 'subtitle', 'description', 'motto']) $(id).addEventListener('input', draw);

// etapas
function applyAutoStages() {
  if (!state.model) return;
  const total = profileOf(allSegments(state.model)).total;
  const ends = autoStageEnds(state.towns, total, Number($('nstages').value));
  for (const t of state.towns) t.stageEnd = ends.has(t.id);
}
$('nstages').addEventListener('change', () => { applyAutoStages(); renderTowns(); draw(); });
$('layout').addEventListener('change', () => {
  const g = $('layout').value === 'guia';
  $('guide-fields').hidden = !g;
  draw();
});

// ——— zoom y desplazamiento ———
const view = { s: 1, x: 0, y: 0 };
function apply() { $('canvas').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`; sharpenLater(); }
function fit() {
  const cv = $('canvas');
  if (!cv.firstElementChild) return;
  const vp = $('viewport').getBoundingClientRect();
  const w = Number(cv.dataset.w), h = Number(cv.dataset.h);
  view.s = Math.min((vp.width - 40) / w, (vp.height - 40) / h);
  view.x = (vp.width - w * view.s) / 2;
  view.y = (vp.height - h * view.s) / 2;
  apply();
}
function zoomAt(f, cx, cy) {
  const ns = Math.min(6, Math.max(0.08, view.s * f));
  view.x = cx - ((cx - view.x) * ns) / view.s;
  view.y = cy - ((cy - view.y) * ns) / view.s;
  view.s = ns;
  apply();
}
const vpEl = $('viewport');
vpEl.addEventListener('wheel', (e) => { e.preventDefault(); const r = vpEl.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
let drag = null;
vpEl.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; vpEl.classList.add('drag'); vpEl.setPointerCapture(e.pointerId); });
vpEl.addEventListener('pointermove', (e) => { if (!drag) return; view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; apply(); });
vpEl.addEventListener('pointerup', () => { drag = null; vpEl.classList.remove('drag'); });
$('z-in').addEventListener('click', () => { const r = vpEl.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); });
$('z-out').addEventListener('click', () => { const r = vpEl.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); });
$('z-fit').addEventListener('click', fit);
window.addEventListener('resize', fit);

// ——— entrada de ficheros ———
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) loadGPX(await f.text(), f.name);
});
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadGPX(await f.text(), f.name);
});
$('sample').addEventListener('click', async () => {
  const r = await fetch('samples/Arevalo_circular.gpx');
  loadGPX(await r.text(), 'Arevalo_circular.gpx');
});

// ——— exportación ———
async function finalSvg() {
  const opts = readOpts();
  const fontCss = await embeddedFontCss(opts);
  await ensureRelief(opts);
  const res = renderMap(state.model, { osm: state.osm, towns: state.towns, opts, fontCss, images: await embedImages(), relief: state.relief });
  const rep = await validate(state.model, state.raw, res.svg, res.projection);
  if (!rep.ok) throw new Error('La validación del GPX ha fallado; no se exporta.');
  return { res, rep };
}
const name = () => slug($('title').value || state.model.name);

$('ex-svg').addEventListener('click', async () => {
  try {
    const { res } = await finalSvg();
    download(`${name()}.svg`, new Blob([res.svg], { type: 'image/svg+xml' }));
  } catch (e) { toast(e.message, 5000); }
});
$('ex-png').addEventListener('click', async () => {
  try {
    toast('Generando PNG…', 8000);
    const { res } = await finalSvg();
    const { w, h } = res.layout;
    // escala para ~300 ppp en el formato físico de referencia (A3 = 297 mm de lado corto)
    const scale = Math.min(3.5, (297 / 25.4 * 300) / Math.min(w, h));
    const png = await svgToPng(res.svg, w, h, scale);
    download(`${name()}.png`, png);
    toast('PNG listo');
  } catch (e) { toast(e.message, 5000); }
});
$('ex-gpx').addEventListener('click', () => {
  download(state.fileName || `${name()}.gpx`, new Blob([state.raw], { type: 'application/gpx+xml' }));
});
$('ex-report').addEventListener('click', async () => {
  const { res, rep } = await finalSvg().catch((e) => { toast(e.message); return {}; });
  if (!rep) return;
  const out = { app: '#ESTODOBAJADA · Arte', fichero: state.fileName, ruta: state.model.name, ...rep, estadisticas: res.stats, monumentos: res.monuments, creditos: { cartografia: '© colaboradores de OpenStreetMap (ODbL)', relieve: state.relief ? 'Terrain Tiles (AWS Open Data / Mapzen)' : null, fotos_de_referencia: res.credits }, osm: state.osm ? { fuente: state.osm.source, fecha: state.osm.timestamp } : null };
  download(`${name()}-integridad.json`, new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
});

void screenFontCss; void STAGE_COLORS;

// ——— composiciones guardadas ———
// Se guarda el GPX literal (sin tocar), las opciones, lo elegido en cada pueblo y los datos de OSM.
const comp = { id: null, nombre: null, dirty: false };
function markDirty() {
  if (comp.dirty) return;
  comp.dirty = true;
  paintCompStatus();
}
function paintCompStatus() {
  const st = $('cp-status');
  $('cp-save').disabled = $('cp-saveas').disabled = !state.model;
  st.classList.toggle('dirty', !!(comp.id && comp.dirty));
  if (!state.model) st.textContent = 'Guarda un mapa para reabrirlo luego tal como lo dejaste.';
  else if (!comp.id) st.textContent = 'Composición nueva, sin guardar.';
  else st.textContent = comp.dirty ? `«${comp.nombre}»: cambios sin guardar.` : `«${comp.nombre}» guardada.`;
  $('cp-save').textContent = comp.id ? 'Guardar cambios' : 'Guardar';
}
function readExtra() {
  return { nstages: $('nstages').value, kinds: [...kinds], maxDist: state.maxDist };
}
function applyOpts(o, extra) {
  for (const [id, v] of Object.entries(o || {})) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT' && ![...el.options].some((op) => op.value === String(v))) continue;
    else el.value = v;
  }
  if (extra) {
    if (extra.nstages) $('nstages').value = extra.nstages;
    if (Array.isArray(extra.kinds)) { kinds.clear(); for (const k of extra.kinds) kinds.add(k); }
    if (extra.maxDist) {
      state.maxDist = extra.maxDist;
      $('maxdist').value = extra.maxDist / 1000;
      $('maxdist-out').textContent = `${String(extra.maxDist / 1000).replace('.', ',')} km`;
    }
  }
  $('guide-fields').hidden = $('layout').value !== 'guia';
  showStyleDesc();
}
async function saveComposition(asNew) {
  if (!state.model) return;
  const nombre = $('title').value.trim() || state.model.name || 'Sin título';
  const p = snapshot({ id: asNew ? null : comp.id, nombre, raw: state.raw, fileName: state.fileName, opts: readOpts(), extra: readExtra(), towns: state.towns, osm: state.osm, appVersion: VERSION, miniatura: thumbnail() });
  try {
    await saveProject(p);
    comp.id = p.id; comp.nombre = p.nombre; comp.dirty = false;
    paintCompStatus();
    renderComps();
    toast(`✓ Composición «${p.nombre}» guardada`);
  } catch (e) { toast('No se pudo guardar: ' + e.message, 6000); }
}
async function openComposition(p) {
  try { checkProject(p); } catch (e) { toast(e.message, 5000); return; }
  let model;
  try { model = parseGPX(p.gpx.texto); } catch (e) { toast('No se pudo leer el GPX de la composición: ' + e.message, 5000); return; }
  if (state.abort) state.abort.abort();
  state.raw = p.gpx.texto; state.fileName = p.gpx.nombre; state.model = model; state.osm = null; state.towns = []; state.relief = null;
  applyOpts(p.opciones, p.extra);
  comp.id = p.id; comp.nombre = p.nombre;
  showStats();
  await loadOSM({ osm: p.osm, pueblos: p.pueblos });
  comp.dirty = false;
  paintCompStatus();
  renderComps();
  toast(`Composición «${p.nombre}» abierta`);
}
// miniatura JPEG pequeña de la vista previa actual, para la galería de composiciones
function thumbnail() {
  const src = $('canvas').querySelector('canvas');
  if (!src || !src.width) return null;
  try {
    const W = 360, k = Math.min(1, W / src.width);
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const g = c.getContext('2d');
    g.fillStyle = '#f3ead6'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}
const SIDEBAR_COMPS = 3; // en el panel solo las últimas; el resto, en la galería
let compList = [];
const escHtml = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// elemento de una composición (fila del panel o tarjeta de la galería) con sus acciones
function compItem(it, card) {
  const li = document.createElement('li');
  if (it.id === comp.id) li.className = 'on';
  const when = new Date(it.guardado).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const thumb = card ? `<span class="cp-thumb">${it.miniatura ? `<img src="${escHtml(it.miniatura)}" alt="" loading="lazy">` : '<i>sin miniatura<br><small>(se crea al volver a guardarla)</small></i>'}</span>` : '';
  li.innerHTML = `<button type="button" class="cp-name" title="Abrir">${thumb}<b>${escHtml(it.nombre)}</b><small>${when}${it.gpx ? ' · ' + escHtml(it.gpx) : ''}</small></button>
    <span class="cp-acts"><button type="button" class="cp-act" data-a="file" title="Descargar como archivo (copia de seguridad u otro equipo)">⬇</button>
    <button type="button" class="cp-act" data-a="del" title="Eliminar">✕</button></span>`;
  li.querySelector('.cp-name').addEventListener('click', async () => {
    if (comp.dirty && comp.id && comp.id !== it.id && !confirm(`«${comp.nombre}» tiene cambios sin guardar. ¿Abrir otra igualmente?`)) return;
    const p = await getProject(it.id);
    if (p) { closeCompGallery(); openComposition(p); }
  });
  li.querySelector('[data-a="file"]').addEventListener('click', async () => {
    const p = await getProject(it.id);
    if (p) download(`${slug(p.nombre)}.estodobajada.json`, new Blob([JSON.stringify(p)], { type: 'application/json' }));
  });
  const del = li.querySelector('[data-a="del"]');
  del.addEventListener('click', async () => {
    // dos pulsaciones para borrar, sin ventanas emergentes
    if (!del.classList.contains('warn')) { del.classList.add('warn'); del.textContent = '¿Borrar?'; setTimeout(() => { del.classList.remove('warn'); del.textContent = '✕'; }, 3000); return; }
    await deleteProject(it.id);
    if (comp.id === it.id) { comp.id = null; comp.nombre = null; paintCompStatus(); }
    renderComps();
  });
  return li;
}
async function renderComps() {
  const ul = $('cp-list');
  try { compList = await listProjects(); } catch { compList = []; ul.innerHTML = '<li class="muted">Este navegador no permite guardar composiciones.</li>'; $('cp-all').hidden = true; return; }
  // las más recientes y, si no está entre ellas, la abierta
  const shown = compList.slice(0, SIDEBAR_COMPS);
  const open = compList.find((it) => it.id === comp.id);
  if (open && !shown.includes(open)) shown.push(open);
  ul.replaceChildren(...shown.map((it) => compItem(it, false)));
  const all = $('cp-all');
  all.hidden = compList.length <= SIDEBAR_COMPS;
  all.textContent = `Ver todas (${compList.length})`;
  if (!$('cp-modal').hidden) renderCompGallery();
}
function renderCompGallery() {
  const list = filterProjects(compList, $('cp-q').value, $('cp-sort').value);
  $('cp-count').textContent = list.length === compList.length ? `${compList.length} composiciones` : `${list.length} de ${compList.length}`;
  const grid = $('cp-grid');
  grid.replaceChildren(...list.map((it) => compItem(it, true)));
  if (!list.length) grid.innerHTML = '<li class="muted cp-none">Ninguna coincide con la búsqueda.</li>';
}
function openCompGallery() {
  $('cp-modal').hidden = false;
  renderCompGallery();
  $('cp-q').focus();
}
function closeCompGallery() { $('cp-modal').hidden = true; }
$('cp-all').addEventListener('click', openCompGallery);
$('cp-close').addEventListener('click', closeCompGallery);
$('cp-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeCompGallery(); });
$('cp-q').addEventListener('input', renderCompGallery);
$('cp-sort').addEventListener('change', renderCompGallery);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('cp-modal').hidden) closeCompGallery(); });
$('cp-save').addEventListener('click', () => saveComposition(false));
$('cp-saveas').addEventListener('click', () => saveComposition(true));
$('cp-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const p = checkProject(JSON.parse(await f.text()));
    await saveProject(p);
    await openComposition(p);
  } catch (err) { toast(err instanceof SyntaxError ? 'El archivo no es una composición válida' : err.message, 5000); }
});
window.addEventListener('beforeunload', (e) => { if (comp.id && comp.dirty) { e.preventDefault(); e.returnValue = ''; } });
paintCompStatus();
renderComps();

// versión visible (fuente única: version.js)
for (const id of ['version']) { const el = document.getElementById(id); if (el) el.textContent = 'v' + VERSION; }
{ const f = document.getElementById('version-foot'); if (f) f.textContent = '#ESTODOBAJADA · Arte v' + VERSION; }
document.title = '#ESTODOBAJADA · Arte v' + VERSION;

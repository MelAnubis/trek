/**
 * routeAssistantService.ts — Asistente de IA para crear rutas de cicloturismo.
 *
 * Reparto de tareas (a propósito):
 *   1. La IA SOLO interpreta la petición y propone una lista ordenada de lugares
 *      (nombres, no coordenadas: un LLM inventa coordenadas con total seguridad).
 *   2. Cada lugar se geocodifica con el buscador de lugares de Trek.
 *   3. Un enrutador de bici (BRouter) calcula el trazado real por carreteras y caminos.
 * Así el track siempre existe en el mapa; la IA nunca lo dibuja.
 */
import { askAIText } from './aiTextService';
import { searchPlaces } from './mapsService';
import {
  dedupeNearby, dropOutliers, orderByShortestPath, trackQuality, cumulativeKm, legStats,
  haversineKm, dropDetourStops, detourCostKm, retraceKm, type StageCut,
} from './routeGeometry';
import { planStageCuts } from './stageCutService';
import { routeWithBrouter, isBrouterProfile, type BrouterProfile } from './brouterService';

export type TripType = 'one_way' | 'loop' | 'out_and_back';

export interface AssistantPlan {
  name: string;
  summary: string;
  profile: BrouterProfile;
  kmPerDay: number | null;
  days: number | null;
  /** El usuario nombró el origen / el destino: no se reordenan. */
  startFixed: boolean;
  endFixed: boolean;
  /** one_way: de A a B · loop: circular, vuelve al inicio por otro camino · out_and_back: ida y vuelta por el mismo camino. */
  tripType: TripType;
  places: string[];
}

export interface ResolvedPlace { query: string; name: string; lat: number; lng: number }

export interface AssistantResult {
  plan: AssistantPlan;
  /** Paradas en el orden en que se recorren (no necesariamente el que propuso la IA). */
  waypoints: ResolvedPlace[];
  points: [number, number, number | null][];
  distanceKm: number;
  ascentM: number | null;
  /** Fin de cada etapa en km de recorrido, elegido junto a alojamientos cuando los hay. */
  stageEnds: StageCut[];
  quality: { lengthKm: number; detourRatio: number; maxGapKm: number; retraceKm: number };
  tripType: TripType;
  warnings: string[];
}

const MAX_PLACES = 12;
const MAX_ROUTE_KM = 3000;

const SYSTEM_PROMPT = `You are a cycle-touring route planner. The user describes a bike trip. Reply with ONLY a JSON object, no prose and no markdown, with this exact shape:
{
  "name": "short route title in the user's language",
  "summary": "1-2 sentences in the user's language explaining the idea of the route and why these places",
  "profile": "trekking" | "fastbike" | "safety" | "gravel" | "MTB",
  "km_per_day": number or null,
  "days": number or null,
  "start_fixed": true | false,
  "end_fixed": true | false,
  "trip_type": "one_way" | "loop" | "out_and_back",
  "places": ["Place, Region/Country", ...]
}
Rules:
- "places" is the list of towns/cities the route should pass through. Between 2 and ${MAX_PLACES} entries. Always add the region or country to each place so it can be geocoded unambiguously.
- Each entry must be a DIFFERENT municipality: if several monuments are in the same town, list the town once. Use real, well-known places only.
- The ORDER of "places" does not matter unless the user named a start and/or an end: the server reorders the stops geographically. Set "start_fixed": true only if the user explicitly named where to start (then put it FIRST), and "end_fixed": true only if the user explicitly named where to finish (then put it LAST). Otherwise both false.
- "trip_type": "one_way" (default: from A to B, or a tour that ends elsewhere), "loop" (circular route that comes back to the start by a DIFFERENT way), "out_and_back" (the user wants to go to a destination and come back along the SAME way: "ida y vuelta", "volviendo por el mismo camino"). For "out_and_back" list only the way OUT (start first, destination last); never list the way back.
- When the user names a start AND an end, include only intermediate towns that lie ON THE WAY between them (they will be the stage ends). Never add a town that needs a detour away from that line.
- If the user asks for stage ends in towns with accommodation, just choose towns large enough to have it; do not describe stages.
- NEVER output coordinates. Only place names.
- "profile": "trekking" for normal cycle touring (default), "fastbike" for road bikes, "safety" to avoid busy roads, "gravel" or "MTB" for unpaved routes.
- "km_per_day": the daily distance the user asked for, otherwise null. "days": the number of days the user asked for, otherwise null. Never invent either: copy only what the user said.
- If the request is not about a bike route, return {"name":"","summary":"","profile":"trekking","km_per_day":null,"days":null,"start_fixed":false,"end_fixed":false,"trip_type":"one_way","places":[]}.`;

/** Extrae y valida el JSON de la respuesta del modelo (admite ```json … ```). */
export function parsePlan(raw: string): AssistantPlan {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(new Error('AI response was not JSON'), { status: 502 });
  let obj: any;
  try { obj = JSON.parse(text.slice(start, end + 1)); }
  catch { throw Object.assign(new Error('AI response was not valid JSON'), { status: 502 }); }

  const places = Array.isArray(obj.places)
    ? obj.places.filter((p: unknown) => typeof p === 'string' && p.trim()).map((p: string) => p.trim().slice(0, 120)).slice(0, MAX_PLACES)
    : [];
  const kmRaw = Number(obj.km_per_day);
  const daysRaw = Number(obj.days);
  return {
    name: typeof obj.name === 'string' ? obj.name.trim().slice(0, 160) : '',
    summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 600) : '',
    profile: isBrouterProfile(obj.profile) ? obj.profile : 'trekking',
    kmPerDay: Number.isFinite(kmRaw) && kmRaw >= 10 && kmRaw <= 400 ? Math.round(kmRaw) : null,
    days: Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 60 ? daysRaw : null,
    startFixed: obj.start_fixed === true,
    endFixed: obj.end_fixed === true,
    tripType: obj.trip_type === 'loop' || obj.trip_type === 'out_and_back' ? obj.trip_type : 'one_way',
    places,
  };
}

const MAX_GAP_KM = 5;
const DETOUR_WARN = 2.2;
const OFF_TRACK_WARN_M = 800;
const RETRACE_MIN_KM = 10;
const RETRACE_RATIO = 0.12;
const BAD_LEG_RATIO = 1.6;      // el trazado recorre > 1,6× la distancia en línea recta entre dos paradas…
const BAD_LEG_EXTRA_KM = 25;    // …y eso son más de 25 km de más
const MAX_REPAIRS = 3;

const strip = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ¿Nombra el usuario este lugar en su petición? (sin acentos ni mayúsculas, palabra completa) */
export function mentionsPlace(prompt: string, place: { query: string; name: string }): boolean {
  const hay = ' ' + strip(prompt).replace(/[^a-z0-9]+/g, ' ') + ' ';
  return [place.query.split(',')[0], place.name]
    .map(x => strip(x).replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(x => x.length >= 3)
    .some(x => hay.includes(' ' + x + ' '));
}

export async function generateRoute(userId: number, prompt: string, lang = 'es'): Promise<AssistantResult> {
  const raw = await askAIText(SYSTEM_PROMPT, `Language: ${lang}\nTrip request: ${prompt}`, { maxTokens: 700, temperature: 0.3 });
  const plan = parsePlan(raw);
  if (plan.places.length < 2) {
    throw Object.assign(new Error('The request does not describe a route between at least two places'), { status: 422, code: 'NO_PLAN' });
  }

  // 1. Geocodificar cada lugar propuesto.
  const warnings: string[] = [];
  const resolved: ResolvedPlace[] = [];
  const unresolved: string[] = [];
  for (const query of plan.places) {
    try {
      const { places } = await searchPlaces(userId, query, lang);
      const hit = (places as any[]).find(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (hit) resolved.push({ query, name: String(hit.name || query), lat: Number(hit.lat), lng: Number(hit.lng) });
      else unresolved.push(query);
    } catch {
      unresolved.push(query);
    }
  }
  if (unresolved.length) warnings.push(`unresolved:${unresolved.join(' | ')}`);

  // 2. Lugares aislados (casi seguro un homónimo en otro país): se descartan antes de decidir nada más.
  //    Un lugar que el usuario nombra solo se descarta si está a > 800 km de todos los demás.
  const tripType = plan.tripType;
  const named = new Set<ResolvedPlace>(resolved.filter(p => mentionsPlace(prompt, p)));
  const nnKm = (p: ResolvedPlace) => Math.min(...resolved.filter(x => x !== p).map(x => haversineKm(p, x)));
  const outliers = dropOutliers(resolved).dropped.filter(p => !named.has(p) || nnKm(p) > 800);
  const base = resolved.filter(p => !outliers.includes(p));
  if (outliers.length) warnings.push(`outliers:${outliers.map(m => m.name).join(' | ')}`);

  // 3. Qué fijó el usuario. Los lugares que NOMBRA son obligatorios; los que añade la IA son opcionales y
  //    se pueden quitar si obligan a un rodeo. Si nombra origen y destino, quedan fijos aunque la IA no lo marque.
  const bothNamed = tripType !== 'loop' && base.length >= 2
    && mentionsPlace(prompt, base[0]) && mentionsPlace(prompt, base[base.length - 1]);
  const first = (plan.startFixed || bothNamed) ? base[0] : undefined;
  const last = tripType !== 'loop' && (plan.endFixed || bothNamed) && base.length > 1 ? base[base.length - 1] : undefined;
  const mandatory = new Set<ResolvedPlace>(base.filter(p => named.has(p)));
  if (first) mandatory.add(first);
  if (last) mandatory.add(last);

  // 4. Limpiar municipios repetidos (varios monumentos del mismo pueblo = una parada). Los extremos fijados se respetan.
  const dd = dedupeNearby(base.filter(p => p !== last));
  const mergedAway = [...dd.merged];
  let stops = dd.kept.filter(p => {
    const clash = !!last && p !== first && haversineKm(p, last) < 1.5;
    if (clash) mergedAway.push(p);
    return !clash;
  });
  if (last) stops = [...stops, last];
  if (mergedAway.length) warnings.push(`merged:${mergedAway.map(m => m.name).join(' | ')}`);

  if (stops.length < 2) {
    throw Object.assign(new Error('Could not locate enough places on the map'), { status: 422, code: 'GEOCODE_FAILED', unresolved });
  }

  // 5. Orden geográfico (un LLM no ordena bien) y recorte de desvíos en línea recta.
  const startFixed = !!first && stops[0] === first;
  const endFixed = !!last && stops[stops.length - 1] === last;
  let ordered = tripType === 'loop'
    ? orderByShortestPath(stops, { closed: true })
    : orderByShortestPath(stops, { startFixed, endFixed });

  if (startFixed && endFixed) {
    const dd2 = dropDetourStops(ordered.filter(p => true));
    const reallyDropped = dd2.dropped.filter(p => !mandatory.has(p));
    if (reallyDropped.length) {
      warnings.push(`detourstop:${reallyDropped.map(d => d.name).join(' | ')}`);
      ordered = ordered.filter(p => !reallyDropped.includes(p));
    }
  }

  // 6. Trazado real con BRouter. Se comprueba contra lo que de verdad recorre, no contra la línea recta:
  //    un tramo que da la vuelta a una sierra o un ramal de ida y vuelta se detectan aquí.
  const viaOf = (xs: ResolvedPlace[]) => (tripType === 'loop' ? [...xs, xs[0]] : xs);
  let route = await routeWithBrouter(viaOf(ordered), plan.profile);
  let q = trackQuality(route.points, viaOf(ordered));
  let rt = retraceKm(route.points);
  const retraceLimit = () => Math.max(RETRACE_MIN_KM, RETRACE_RATIO * q.lengthKm);
  const computeLegs = () => legStats(route.points, cumulativeKm(route.points), viaOf(ordered));
  let legs = computeLegs();
  const badLegs = () => legs.map((l, i) => ({ ...l, i })).filter(l => l.ratio > BAD_LEG_RATIO && l.extraKm > BAD_LEG_EXTRA_KM);

  for (let attempt = 0; attempt < MAX_REPAIRS && ordered.length > 2; attempt++) {
    const bad = badLegs();
    const retraced = tripType !== 'loop' && rt > retraceLimit();
    if (!bad.length && !retraced) break;

    // Candidata: parada opcional (no nombrada por el usuario) que más desvía. Con un tramo malo, una de sus dos paradas.
    let cand = -1, candCost = -1;
    const consider = (i: number) => {
      if (i < 1 || i > ordered.length - 2 || mandatory.has(ordered[i])) return;
      const c = detourCostKm(ordered, i);
      if (c > candCost) { candCost = c; cand = i; }
    };
    if (bad.length) {
      const w = bad.reduce((a, b) => (b.extraKm > a.extraKm ? b : a));
      consider(w.i); consider(w.i + 1);
    } else {
      for (let i = 1; i < ordered.length - 1; i++) consider(i);
    }
    if (cand < 0) break;

    const trial = ordered.filter((_, i) => i !== cand);
    let tr;
    try { tr = await routeWithBrouter(viaOf(trial), plan.profile); } catch { break; }
    const tq = trackQuality(tr.points, viaOf(trial));
    const trt = retraceKm(tr.points);
    if (tq.lengthKm < q.lengthKm * 0.9 || trt < rt * 0.6) {
      warnings.push(`droppedstop:${ordered[cand].name}`);
      ordered = trial; route = tr; q = tq; rt = trt;
      legs = computeLegs();
    } else break;
  }
  if (tripType !== 'loop' && rt > retraceLimit()) warnings.push(`retrace:${Math.round(rt)}`);
  const stillBad = badLegs();
  if (stillBad.length) {
    const via = viaOf(ordered);
    warnings.push(`badleg:${stillBad.map(l => `${via[l.i].name} → ${via[l.i + 1].name} (${Math.round(l.roadKm)} km vs ${Math.round(l.straightKm)} km)`).join(' | ')}`);
  }

  if (q.maxGapKm > MAX_GAP_KM) {
    console.error('[planner-ai] discontinuous track', JSON.stringify({ maxGapKm: q.maxGapKm, stops: ordered.map(o => o.name) }));
    throw Object.assign(new Error(`The router returned a broken track (gap of ${q.maxGapKm.toFixed(1)} km)`), { status: 422, code: 'DISCONTINUOUS' });
  }
  const mirror = tripType === 'out_and_back';
  const totalLengthKm = q.lengthKm * (mirror ? 2 : 1);
  if (totalLengthKm > MAX_ROUTE_KM) {
    throw Object.assign(new Error(`Route too long (${Math.round(totalLengthKm)} km)`), { status: 422, code: 'TOO_LONG' });
  }
  if (q.detourRatio > DETOUR_WARN) warnings.push(`detour:${q.detourRatio.toFixed(1)}`);
  const checked = viaOf(ordered);
  const off = checked.map((w, i) => ({ name: w.name, offM: q.waypointOffM[i] })).filter((x, i) => x.offM > OFF_TRACK_WARN_M && i < ordered.length);
  if (off.length) warnings.push(`offtrack:${off.map(x => `${x.name} (${(x.offM / 1000).toFixed(1)} km)`).join(' | ')}`);

  // Ida y vuelta por el mismo camino: el regreso es la ida al revés.
  const track: [number, number, number | null][] = mirror
    ? [...route.points, ...route.points.slice(0, -1).reverse()]
    : route.points;

  // 7. Etapas: cada corte se mueve (hasta ~7 km) a una población con alojamiento.
  const oneWayKm = cumulativeKm(route.points).slice(-1)[0] ?? 0;
  const total = mirror ? oneWayKm * 2 : oneWayKm;
  const stageCount = plan.kmPerDay ? Math.round(total / plan.kmPerDay) : plan.days ?? 0;
  const n = Math.min(40, Math.max(0, stageCount));
  let stageEnds: StageCut[] = [];
  if (n >= 2) {
    const sp = await planStageCuts(track, cumulativeKm(track), { stageCount: n, mirrorKm: mirror ? oneWayKm : undefined });
    stageEnds = sp.cuts;
    if (!sp.lodgingChecked) warnings.push('nolodgingdata');
    else {
      if (sp.failed > 0) warnings.push(`lodgingpartial:${sp.failed}/${sp.queries}`);
      const none = stageEnds.map((c, i) => (c.lodged ? 0 : i + 1)).filter(Boolean);
      if (none.length) warnings.push(`nolodging:${none.join(', ')}`);
      const far = stageEnds.map((c, i) => ({ c, i })).filter(x => x.c.lodged && Math.abs(x.c.shiftKm) > 7.5);
      if (far.length) warnings.push(`farlodging:${far.map(x => `${x.i + 1} (${x.c.shiftKm > 0 ? '+' : '−'}${Math.round(Math.abs(x.c.shiftKm))} km)`).join(' | ')}`);
    }
  }

  // Un resumen en el log permite diagnosticar una ruta rara sin reproducirla.
  console.info('[planner-ai]', JSON.stringify({
    prompt: prompt.slice(0, 120), profile: plan.profile, tripType,
    asked: plan.places, named: [...mandatory].map(m => m.name),
    ordered: ordered.map(o => `${o.name} @${o.lat.toFixed(3)},${o.lng.toFixed(3)}`),
    legs: legs.map(l => ({ road: Math.round(l.roadKm), straight: Math.round(l.straightKm), ratio: Math.round(l.ratio * 100) / 100 })),
    km: Math.round(totalLengthKm), detour: Math.round(q.detourRatio * 100) / 100, maxGapKm: Math.round(q.maxGapKm * 10) / 10,
    retraceKm: Math.round(rt), offM: q.waypointOffM, stageEnds, warnings,
  }));

  return {
    plan, waypoints: ordered, points: track, distanceKm: route.distanceKm * (mirror ? 2 : 1), ascentM: route.ascentM,
    stageEnds, tripType,
    quality: { lengthKm: totalLengthKm, detourRatio: q.detourRatio, maxGapKm: q.maxGapKm, retraceKm: rt },
    warnings,
  };
}

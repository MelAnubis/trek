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
import { searchPlaces, searchOverpassPoisAlongRoute } from './mapsService';
import {
  dedupeNearby, dropOutliers, orderByShortestPath, trackQuality, cumulativeKm, nearestOnTrack, indexAtKm,
  simplifyLine, chooseStageCuts, haversineKm, dropDetourStops, detourCostKm, retraceKm, type StageCut,
} from './routeGeometry';
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
const LODGING_CHUNK_KM = 40;
const LODGING_MAX_CHUNKS = 12;
const LODGING_RADIUS_M = 1500;
const LODGING_BUDGET_MS = 45000;
const RETRACE_MIN_KM = 10;
const RETRACE_RATIO = 0.12;

/**
 * Alojamientos (km de recorrido) a menos de ~2 km del track. Consulta tramos de 40 km
 * (consultas pequeñas, que Overpass resuelve sin agotar el tiempo) y tolera fallos
 * parciales: devuelve cuántos tramos fallaron para que quien llama decida qué avisar.
 */
async function findLodgingKm(points: [number, number, number | null][], cum: number[]): Promise<{ kms: number[]; failed: number; chunks: number }> {
  const total = cum[cum.length - 1];
  const chunks = Math.max(1, Math.ceil(total / LODGING_CHUNK_KM));
  if (chunks > LODGING_MAX_CHUNKS) return { kms: [], failed: chunks, chunks };
  const found = new Map<string, number>();
  let failed = 0, lastErr: unknown = null;
  const t0 = Date.now();
  for (let c = 0; c < chunks; c++) {
    if (Date.now() - t0 > LODGING_BUDGET_MS) { failed += chunks - c; break; }
    const a = indexAtKm(cum, c * LODGING_CHUNK_KM);
    const b = c === chunks - 1 ? points.length - 1 : indexAtKm(cum, (c + 1) * LODGING_CHUNK_KM);
    if (b <= a) continue;
    try {
      const res = await searchOverpassPoisAlongRoute('hotel', simplifyLine(points.slice(a, b + 1), 200), LODGING_RADIUS_M, 200);
      for (const p of res.pois as { osm_id: string; lat: number; lng: number }[]) {
        if (found.has(p.osm_id)) continue;
        const near = nearestOnTrack(points, cum, p);
        if (near.offM <= 2000) found.set(p.osm_id, near.km);
      }
    } catch (err) {
      failed++;
      lastErr = err;
    }
  }
  if (lastErr) console.warn('[planner-ai] lodging lookup failed:', (lastErr as Error)?.message);
  return { kms: [...found.values()], failed, chunks };
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

  // 2. Limpiar: municipios repetidos y lugares fuera de zona (homónimos). Los extremos nombrados por el usuario se respetan.
  const first = plan.startFixed ? resolved[0] : undefined;
  const last = plan.endFixed && resolved.length > 1 ? resolved[resolved.length - 1] : undefined;

  const dd = dedupeNearby(resolved.filter(p => p !== last));
  const mergedAway = [...dd.merged];
  let working = dd.kept.filter(p => {
    const clash = !!last && p !== first && haversineKm(p, last) < 1.5;
    if (clash) mergedAway.push(p);
    return !clash;
  });
  if (last) working = [...working, last];
  if (mergedAway.length) warnings.push(`merged:${mergedAway.map(m => m.name).join(' | ')}`);

  const out = dropOutliers(working);
  const dropped = out.dropped.filter(p => p !== first && p !== last);
  const stops = working.filter(p => !dropped.includes(p));
  if (dropped.length) warnings.push(`outliers:${dropped.map(m => m.name).join(' | ')}`);

  if (stops.length < 2) {
    throw Object.assign(new Error('Could not locate enough places on the map'), { status: 422, code: 'GEOCODE_FAILED', unresolved });
  }

  // 3. Orden geográfico (un LLM no ordena bien) y recorte de desvíos.
  const tripType = plan.tripType;
  const startFixed = !!first && stops[0] === first;
  const endFixed = tripType !== 'loop' && !!last && stops[stops.length - 1] === last;
  let ordered = tripType === 'loop'
    ? orderByShortestPath(stops, { closed: true })
    : orderByShortestPath(stops, { startFixed, endFixed });

  // Con origen y destino nombrados, una parada que obliga a un ramal largo es un error de la IA, no un deseo del usuario.
  if (startFixed && endFixed) {
    const dd2 = dropDetourStops(ordered);
    if (dd2.dropped.length) {
      warnings.push(`detourstop:${dd2.dropped.map(d => d.name).join(' | ')}`);
      ordered = dd2.kept;
    }
  }

  // 4. Trazado real con BRouter y comprobación de que es coherente.
  const viaOf = (xs: ResolvedPlace[]) => (tripType === 'loop' ? [...xs, xs[0]] : xs);
  let route = await routeWithBrouter(viaOf(ordered), plan.profile);
  let q = trackQuality(route.points, viaOf(ordered));
  let rt = retraceKm(route.points);
  const retraceLimit = () => Math.max(RETRACE_MIN_KM, RETRACE_RATIO * q.lengthKm);

  // Si el trazado repasa sus propios pasos (un ramal de ida y vuelta), se prueba sin la parada que más desvía.
  if (tripType !== 'loop' && rt > retraceLimit()) {
    for (let attempt = 0; attempt < 2 && ordered.length > 2; attempt++) {
      let wi = -1, wc = 0;
      for (let i = 1; i < ordered.length - 1; i++) {
        const c = detourCostKm(ordered, i);
        if (c > wc) { wc = c; wi = i; }
      }
      if (wi < 0) break;
      const trial = ordered.filter((_, i) => i !== wi);
      let tr;
      try { tr = await routeWithBrouter(trial, plan.profile); } catch { break; }
      const tq = trackQuality(tr.points, trial);
      const trt = retraceKm(tr.points);
      if (trt < rt * 0.6 || tq.lengthKm < q.lengthKm * 0.85) {
        warnings.push(`droppedstop:${ordered[wi].name}`);
        ordered = trial; route = tr; q = tq; rt = trt;
        if (rt <= retraceLimit()) break;
      } else break;
    }
  }
  if (tripType !== 'loop' && rt > retraceLimit()) warnings.push(`retrace:${Math.round(rt)}`);

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
  const stopsToCheck = viaOf(ordered);
  const off = stopsToCheck.map((w, i) => ({ name: w.name, offM: q.waypointOffM[i] })).filter((x, i) => x.offM > OFF_TRACK_WARN_M && i < ordered.length);
  if (off.length) warnings.push(`offtrack:${off.map(x => `${x.name} (${(x.offM / 1000).toFixed(1)} km)`).join(' | ')}`);

  // Ida y vuelta por el mismo camino: el regreso es la ida al revés.
  const track: [number, number, number | null][] = mirror
    ? [...route.points, ...route.points.slice(0, -1).reverse()]
    : route.points;

  // 5. Etapas: terminar donde se pueda dormir.
  const cumOne = cumulativeKm(route.points);
  const oneWayKm = cumOne[cumOne.length - 1];
  const total = mirror ? oneWayKm * 2 : oneWayKm;
  const stageCount = plan.kmPerDay ? Math.round(total / plan.kmPerDay) : plan.days ?? 0;
  const n = Math.min(40, Math.max(0, stageCount));
  let stageEnds: StageCut[] = [];
  if (n >= 2) {
    const lod = await findLodgingKm(route.points, cumOne);
    if (lod.failed >= lod.chunks) warnings.push('nolodgingdata');
    else if (lod.failed > 0) warnings.push(`lodgingpartial:${lod.failed}/${lod.chunks}`);
    // en la vuelta se pasa por los mismos alojamientos, a 2L − km
    const kms = mirror ? [...lod.kms, ...lod.kms.map(k => 2 * oneWayKm - k)] : lod.kms;
    stageEnds = chooseStageCuts(total, n, kms);
    if (lod.failed < lod.chunks) {
      const bad = stageEnds.map((c, i) => (c.lodged ? 0 : i + 1)).filter(Boolean);
      if (bad.length) warnings.push(`nolodging:${bad.join(', ')}`);
    }
  }

  // Un resumen en el log permite diagnosticar una ruta rara sin reproducirla.
  console.info('[planner-ai]', JSON.stringify({
    prompt: prompt.slice(0, 120), profile: plan.profile, tripType,
    asked: plan.places, ordered: ordered.map(o => `${o.name} @${o.lat.toFixed(3)},${o.lng.toFixed(3)}`),
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

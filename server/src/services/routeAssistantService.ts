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
  simplifyLine, chooseStageCuts, haversineKm, type StageCut,
} from './routeGeometry';
import { routeWithBrouter, isBrouterProfile, type BrouterProfile } from './brouterService';

export interface AssistantPlan {
  name: string;
  summary: string;
  profile: BrouterProfile;
  kmPerDay: number | null;
  days: number | null;
  /** El usuario nombró el origen / el destino: no se reordenan. */
  startFixed: boolean;
  endFixed: boolean;
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
  quality: { lengthKm: number; detourRatio: number; maxGapKm: number };
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
  "places": ["Place, Region/Country", ...]
}
Rules:
- "places" is the list of towns/cities the route should pass through. Between 2 and ${MAX_PLACES} entries. Always add the region or country to each place so it can be geocoded unambiguously.
- Each entry must be a DIFFERENT municipality: if several monuments are in the same town, list the town once. Use real, well-known places only.
- The ORDER of "places" does not matter unless the user named a start and/or an end: the server reorders the stops geographically. Set "start_fixed": true only if the user explicitly named where to start (then put it FIRST), and "end_fixed": true only if the user explicitly named where to finish (then put it LAST). Otherwise both false.
- If the user asks for stage ends in towns with accommodation, just choose towns large enough to have it; do not describe stages.
- NEVER output coordinates. Only place names.
- "profile": "trekking" for normal cycle touring (default), "fastbike" for road bikes, "safety" to avoid busy roads, "gravel" or "MTB" for unpaved routes.
- "km_per_day": the daily distance the user asked for, otherwise null. "days": the number of days the user asked for, otherwise null. Never invent either: copy only what the user said.
- If the request is not about a bike route, return {"name":"","summary":"","profile":"trekking","km_per_day":null,"days":null,"start_fixed":false,"end_fixed":false,"places":[]}.`;

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
    places,
  };
}

const MAX_GAP_KM = 5;
const DETOUR_WARN = 2.2;
const OFF_TRACK_WARN_M = 800;
const LODGING_CHUNK_KM = 80;
const LODGING_MAX_CHUNKS = 5;
const LODGING_RADIUS_M = 1500;

/** Alojamientos (km de recorrido) a menos de ~2 km del track. null si no se pudo consultar. */
async function findLodgingKm(points: [number, number, number | null][], cum: number[]): Promise<number[] | null> {
  const total = cum[cum.length - 1];
  const chunks = Math.max(1, Math.ceil(total / LODGING_CHUNK_KM));
  if (chunks > LODGING_MAX_CHUNKS) return null;
  const found = new Map<string, number>();
  try {
    for (let c = 0; c < chunks; c++) {
      const a = indexAtKm(cum, c * LODGING_CHUNK_KM);
      const b = c === chunks - 1 ? points.length - 1 : indexAtKm(cum, (c + 1) * LODGING_CHUNK_KM);
      if (b <= a) continue;
      const res = await searchOverpassPoisAlongRoute('hotel', simplifyLine(points.slice(a, b + 1), 300), LODGING_RADIUS_M, 300);
      for (const p of res.pois as { osm_id: string; lat: number; lng: number }[]) {
        if (found.has(p.osm_id)) continue;
        const near = nearestOnTrack(points, cum, p);
        if (near.offM <= 2000) found.set(p.osm_id, near.km);
      }
    }
  } catch {
    return null;
  }
  return [...found.values()];
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

  // 3. Orden geográfico (un LLM no ordena bien).
  const ordered = orderByShortestPath(stops, {
    startFixed: !!first && stops[0] === first,
    endFixed: !!last && stops[stops.length - 1] === last,
  });

  // 4. Trazado real con BRouter y comprobación de que es coherente.
  const route = await routeWithBrouter(ordered, plan.profile);
  const q = trackQuality(route.points, ordered);
  if (q.maxGapKm > MAX_GAP_KM) {
    console.error('[planner-ai] discontinuous track', JSON.stringify({ maxGapKm: q.maxGapKm, stops: ordered.map(o => o.name) }));
    throw Object.assign(new Error(`The router returned a broken track (gap of ${q.maxGapKm.toFixed(1)} km)`), { status: 422, code: 'DISCONTINUOUS' });
  }
  if (q.lengthKm > MAX_ROUTE_KM) {
    throw Object.assign(new Error(`Route too long (${Math.round(q.lengthKm)} km)`), { status: 422, code: 'TOO_LONG' });
  }
  if (q.detourRatio > DETOUR_WARN) warnings.push(`detour:${q.detourRatio.toFixed(1)}`);
  const off = ordered.map((w, i) => ({ name: w.name, offM: q.waypointOffM[i] })).filter(x => x.offM > OFF_TRACK_WARN_M);
  if (off.length) warnings.push(`offtrack:${off.map(x => `${x.name} (${(x.offM / 1000).toFixed(1)} km)`).join(' | ')}`);

  // 5. Etapas: terminar donde se pueda dormir.
  const cum = cumulativeKm(route.points);
  const total = cum[cum.length - 1];
  const stageCount = plan.kmPerDay ? Math.round(total / plan.kmPerDay) : plan.days ?? 0;
  const n = Math.min(40, Math.max(0, stageCount));
  let stageEnds: StageCut[] = [];
  if (n >= 2) {
    const lodging = await findLodgingKm(route.points, cum);
    if (lodging === null) warnings.push('nolodgingdata');
    stageEnds = chooseStageCuts(total, n, lodging ?? []);
    if (lodging !== null) {
      const bad = stageEnds.map((c, i) => (c.lodged ? 0 : i + 1)).filter(Boolean);
      if (bad.length) warnings.push(`nolodging:${bad.join(', ')}`);
    }
  }

  // Un resumen en el log permite diagnosticar una ruta rara sin reproducirla.
  console.info('[planner-ai]', JSON.stringify({
    prompt: prompt.slice(0, 120), profile: plan.profile,
    asked: plan.places, ordered: ordered.map(o => `${o.name} @${o.lat.toFixed(3)},${o.lng.toFixed(3)}`),
    km: Math.round(q.lengthKm), detour: Math.round(q.detourRatio * 100) / 100, maxGapKm: Math.round(q.maxGapKm * 10) / 10,
    offM: q.waypointOffM, stageEnds, warnings,
  }));

  return {
    plan, waypoints: ordered, points: route.points, distanceKm: route.distanceKm, ascentM: route.ascentM,
    stageEnds, quality: { lengthKm: q.lengthKm, detourRatio: q.detourRatio, maxGapKm: q.maxGapKm }, warnings,
  };
}

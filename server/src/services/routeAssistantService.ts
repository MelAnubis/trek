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
import { routeWithBrouter, isBrouterProfile, type BrouterProfile } from './brouterService';

export interface AssistantPlan {
  name: string;
  summary: string;
  profile: BrouterProfile;
  kmPerDay: number | null;
  days: number | null;
  places: string[];
}

export interface ResolvedPlace { query: string; name: string; lat: number; lng: number }

export interface AssistantResult {
  plan: AssistantPlan;
  waypoints: ResolvedPlace[];
  points: [number, number, number | null][];
  distanceKm: number;
  ascentM: number | null;
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
  "places": ["Place, Region/Country", ...]
}
Rules:
- "places" is the ordered list of towns/cities/landmarks the route passes through, start first and end last. Between 2 and ${MAX_PLACES} entries. Always add the region or country to each place so it can be geocoded unambiguously.
- Choose intermediate places only to shape the route (so it follows the corridor the user asked for); do NOT try to list every village.
- NEVER output coordinates. Only place names.
- "profile": "trekking" for normal cycle touring (default), "fastbike" for road bikes, "safety" to avoid busy roads, "gravel" or "MTB" for unpaved routes.
- "km_per_day": the daily distance the user asked for, otherwise null. "days": the number of days the user asked for, otherwise null. Never invent either: copy only what the user said.
- If the request is not about a bike route, return {"name":"","summary":"","profile":"trekking","km_per_day":null,"places":[]}.`;

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
    places,
  };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function generateRoute(userId: number, prompt: string, lang = 'es'): Promise<AssistantResult> {
  const raw = await askAIText(SYSTEM_PROMPT, `Language: ${lang}\nTrip request: ${prompt}`, { maxTokens: 700, temperature: 0.3 });
  const plan = parsePlan(raw);
  if (plan.places.length < 2) {
    throw Object.assign(new Error('The request does not describe a route between at least two places'), { status: 422, code: 'NO_PLAN' });
  }

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
  if (resolved.length < 2) {
    throw Object.assign(new Error('Could not locate enough places on the map'), { status: 422, code: 'GEOCODE_FAILED', unresolved });
  }

  // Un geocodificado equivocado (otra población homónima) se nota como un salto enorme entre
  // lugares consecutivos: se avisa en vez de tirar la ruta, porque el usuario puede corregirlo.
  for (let i = 1; i < resolved.length; i++) {
    const d = haversineKm(resolved[i - 1], resolved[i]);
    if (d > 900) warnings.push(`far:${resolved[i - 1].name} → ${resolved[i].name} (${Math.round(d)} km)`);
  }

  const route = await routeWithBrouter(resolved, plan.profile);
  if (route.distanceKm > MAX_ROUTE_KM) {
    throw Object.assign(new Error(`Route too long (${Math.round(route.distanceKm)} km)`), { status: 422, code: 'TOO_LONG' });
  }
  return { plan, waypoints: resolved, points: route.points, distanceKm: route.distanceKm, ascentM: route.ascentM, warnings };
}

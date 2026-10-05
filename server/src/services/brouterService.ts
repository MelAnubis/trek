/**
 * brouterService.ts — Cálculo de rutas ciclistas con BRouter.
 *
 * BRouter (https://github.com/abrensch/brouter) es un enrutador pensado para bici
 * y senderismo con perfiles como "trekking" (cicloturismo) o "fastbike".
 * La URL base sale de BROUTER_URL (nunca de la petición del usuario, para evitar
 * SSRF). Por defecto se usa la instancia pública; para uso intensivo conviene
 * autoalojarlo y apuntar BROUTER_URL a tu contenedor (p. ej. http://brouter:17777/brouter).
 */

export const BROUTER_PROFILES = ['trekking', 'fastbike', 'safety', 'gravel', 'MTB'] as const;
export type BrouterProfile = typeof BROUTER_PROFILES[number];

export interface LatLng { lat: number; lng: number }
export interface BrouterResult {
  /** [lat, lng, ele|null] */
  points: [number, number, number | null][];
  distanceKm: number;
  ascentM: number | null;
}

const MAX_WAYPOINTS_PER_REQUEST = 15;
const TIMEOUT_MS = 45000;

function baseUrl(): string {
  return (process.env.BROUTER_URL || 'https://brouter.de/brouter').replace(/\/+$/, '');
}

export function isBrouterProfile(v: unknown): v is BrouterProfile {
  return typeof v === 'string' && (BROUTER_PROFILES as readonly string[]).includes(v);
}

async function routeChunk(wps: LatLng[], profile: BrouterProfile): Promise<BrouterResult> {
  const lonlats = wps.map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join('|');
  const url = `${baseUrl()}?lonlats=${encodeURIComponent(lonlats)}&profile=${profile}&alternativeidx=0&format=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'TREK-planner' } });
  } catch (err) {
    throw Object.assign(new Error(`BRouter unreachable: ${(err as Error).message}`), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    // BRouter responde 400 con texto plano cuando un punto no está en zona de datos o no hay ruta.
    throw Object.assign(new Error(`BRouter ${res.status}: ${text}`), { status: res.status === 400 ? 422 : 502 });
  }
  const data = await res.json() as {
    features?: { geometry?: { coordinates?: number[][] }; properties?: Record<string, string | number> }[];
  };
  const feat = data.features?.[0];
  const coords = feat?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    throw Object.assign(new Error('BRouter returned no geometry'), { status: 502 });
  }
  const points: [number, number, number | null][] = [];
  for (const c of coords) {
    const lng = Number(c[0]), lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const ele = c.length > 2 && Number.isFinite(Number(c[2])) ? Number(c[2]) : null;
    points.push([lat, lng, ele]);
  }
  const props = feat?.properties ?? {};
  const lenM = Number(props['track-length']);
  const ascend = Number(props['filtered ascend']);
  return {
    points,
    distanceKm: Number.isFinite(lenM) ? lenM / 1000 : 0,
    ascentM: Number.isFinite(ascend) ? ascend : null,
  };
}

/**
 * Ruta que pasa por todos los waypoints en orden. Si hay muchos, se pide por
 * tramos solapados en un punto y se concatenan.
 */
export async function routeWithBrouter(waypoints: LatLng[], profile: BrouterProfile = 'trekking'): Promise<BrouterResult> {
  if (waypoints.length < 2) throw Object.assign(new Error('At least 2 waypoints required'), { status: 400 });
  for (const w of waypoints) {
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng) || Math.abs(w.lat) > 90 || Math.abs(w.lng) > 180) {
      throw Object.assign(new Error('Invalid waypoint'), { status: 400 });
    }
  }
  const step = MAX_WAYPOINTS_PER_REQUEST - 1;
  const all: [number, number, number | null][] = [];
  let distanceKm = 0;
  let ascentM: number | null = 0;
  for (let i = 0; i < waypoints.length - 1; i += step) {
    const chunk = waypoints.slice(i, i + step + 1);
    if (chunk.length < 2) break;
    const r = await routeChunk(chunk, profile);
    // El primer punto de cada tramo repite el último del anterior.
    all.push(...(all.length ? r.points.slice(1) : r.points));
    distanceKm += r.distanceKm;
    ascentM = ascentM != null && r.ascentM != null ? ascentM + r.ascentM : null;
  }
  return { points: all, distanceKm, ascentM };
}

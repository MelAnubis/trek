/**
 * googleLodgingService.ts — Alojamientos de Google Places como fuente adicional.
 *
 * OpenStreetMap solo tiene lo que alguien ha mapeado y en muchos pueblos faltan hoteles, casas rurales o
 * campings que sí están en Google (y en Booking). Si el usuario tiene una clave de Google Maps en Trek, se usa
 * Places «Nearby Search» como complemento, SOLO para los cortes de etapa donde OpenStreetMap no ha dado nada
 * (ver stageCutService) para no gastar cuota de más.
 *
 * Qué no se hace, a propósito:
 *  · No se hace scraping de Booking ni de ninguna otra web: sus condiciones lo prohíben, lo bloquean activamente
 *    y no tienen API pública de búsqueda (la «Demand API» es solo para socios aprobados).
 *  · Los resultados de Google no se guardan en la base de datos ni se dibujan en el mapa: solo se usan, en el
 *    momento, para elegir dónde cortar una etapa (los términos de Google restringen guardar y mostrar sus datos).
 */
import { getMapsKey, googleFetch } from './mapsService';

export interface GoogleLodging { id: string; name: string; lat: number; lng: number }

/** Tipos de la Tabla A de Places (New) que cubren dónde dormir. */
const LODGING_TYPES = [
  'lodging', 'hotel', 'motel', 'hostel', 'guest_house', 'bed_and_breakfast', 'inn', 'cottage', 'farmstay',
  'campground', 'camping_cabin', 'rv_park', 'resort_hotel', 'extended_stay_hotel',
];
const MAX_RADIUS_M = 50000;
const CACHE_TTL_MS = 60 * 60 * 1000;      // solo en memoria y una hora: no se persisten datos de Google
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; value: GoogleLodging[] }>();

export function googleLodgingAvailable(userId: number): boolean {
  return !!getMapsKey(userId);
}

/** Vacía la caché en memoria (tests). */
export function resetGoogleLodgingCache(): void { cache.clear(); }

async function nearby(apiKey: string, lat: number, lng: number, radiusM: number, types: string[]): Promise<Response> {
  return googleFetch('https://places.googleapis.com/v1/places:searchNearby', 'searchNearby(lodging)', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      // Solo campos del nivel básico: el coste por petición no sube
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
    }),
  });
}

/**
 * Los 20 alojamientos más cercanos al punto (radio ≤ 50 km). Lanza un error con `status` si Google rechaza la
 * petición (clave sin la API «Places API (New)» activada, cuota agotada…).
 */
export async function searchGoogleLodgingNear(userId: number, lat: number, lng: number, radiusM: number): Promise<GoogleLodging[]> {
  const apiKey = getMapsKey(userId);
  if (!apiKey) throw Object.assign(new Error('No Google Maps API key configured'), { status: 412, code: 'NO_KEY' });
  const radius = Math.min(MAX_RADIUS_M, Math.max(100, Math.round(radiusM)));
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${radius}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let res = await nearby(apiKey, lat, lng, radius, LODGING_TYPES);
  let data = await res.json().catch(() => ({})) as { places?: { id: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number } }[]; error?: { message?: string; status?: string } };
  // Si Google no reconoce algún tipo (la lista cambia entre versiones) se reintenta con el tipo genérico.
  if (!res.ok && res.status === 400 && /type/i.test(data.error?.message ?? '')) {
    res = await nearby(apiKey, lat, lng, radius, ['lodging']);
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.error?.message || `Google Places error ${res.status}`), { status: res.status, code: data.error?.status });
  }
  const value: GoogleLodging[] = (data.places ?? [])
    .filter(p => p.location && Number.isFinite(p.location.latitude) && Number.isFinite(p.location.longitude))
    .map(p => ({ id: p.id, name: p.displayName?.text ?? '', lat: p.location!.latitude, lng: p.location!.longitude }));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}

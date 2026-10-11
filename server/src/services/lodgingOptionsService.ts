/**
 * lodgingOptionsService.ts — Alojamientos de una localidad (para elegir uno en un día del viaje).
 *
 * Reúne dos fuentes y las funde en una lista: OpenStreetMap (caché por teselas, con Nominatim si Overpass no
 * responde) y Google Places (si el usuario tiene clave de Google Maps en Trek). NO trae precio ni disponibilidad:
 * eso solo lo da una API de reservas (Booking solo la ofrece a socios aprobados) y no se hace scraping. La lista
 * sirve para elegir el alojamiento; el precio y las plazas se comprueban después en Booking con las fechas del día.
 */
import { getTilePois } from './lodgingTileService';
import { googleLodgingAvailable, searchGoogleLodgingNear } from './googleLodgingService';
import { haversineKm } from './routeGeometry';

export interface LodgingOption {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
  sources: ('osm' | 'google')[];
  osm_id?: string;
  google_place_id?: string;
}

export interface LodgingOptionsResult {
  options: LodgingOption[];
  sources: {
    osm: 'ok' | 'partial' | 'failed';
    /** `no-key`: no hay clave de Google Maps en Trek; `failed`: Google no respondió (API no activada, cuota…). */
    google: 'used' | 'no-key' | 'failed';
    errors: string[];
  };
  center: { lat: number; lng: number };
  radius_m: number;
}

const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** ¿Son el mismo alojamiento visto por dos fuentes? Nombre igual, uno contenido en el otro, o muy parecido por palabras. */
export function similarNames(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && long.includes(short)) return true;
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  const inter = [...tx].filter(t => ty.has(t)).length;
  return inter / (tx.size + ty.size - inter) >= 0.6;
}

const SAME_PLACE_M = 150;

export async function findLodgingOptions(userId: number, lat: number, lng: number, radiusM = 2500, limit = 40): Promise<LodgingOptionsResult> {
  const radius = Math.min(5000, Math.max(200, Math.round(radiusM)));
  const center = { lat, lng };
  const distM = (p: { lat: number; lng: number }) => Math.round(haversineKm(center, p) * 1000);

  const hasGoogle = googleLodgingAvailable(userId);
  const [osmRes, googleRes] = await Promise.allSettled([
    // Una «línea» de un punto: el caché por teselas busca a menos de `radius` de ella.
    getTilePois('lodging', [[lat, lng], [lat + 0.00005, lng]], radius),
    hasGoogle ? searchGoogleLodgingNear(userId, lat, lng, radius) : Promise.resolve(null),
  ]);

  const errors: string[] = [];
  const options: LodgingOption[] = [];
  let osm: LodgingOptionsResult['sources']['osm'] = 'ok';

  if (osmRes.status === 'fulfilled') {
    const r = osmRes.value;
    for (const p of r.pois) {
      if (!p.name) continue;                                  // sin nombre no se puede elegir
      options.push({ id: `osm:${p.osm_id}`, name: p.name, lat: p.lat, lng: p.lng, distance_m: distM(p), sources: ['osm'], osm_id: p.osm_id });
    }
    errors.push(...r.errors);
    if (r.failedBuckets > 0) osm = options.length ? 'partial' : 'failed';
  } else {
    osm = 'failed';
    errors.push((osmRes.reason as Error)?.message ?? 'OpenStreetMap');
  }

  let google: LodgingOptionsResult['sources']['google'] = hasGoogle ? 'used' : 'no-key';
  if (googleRes.status === 'rejected') {
    google = 'failed';
    errors.push(`Google: ${(googleRes.reason as Error)?.message ?? 'error'}`);
  } else if (googleRes.value) {
    for (const g of googleRes.value) {
      if (!g.name) continue;
      const dup = options.find(o => similarNames(o.name, g.name) && haversineKm(o, g) * 1000 < SAME_PLACE_M);
      if (dup) {
        if (!dup.sources.includes('google')) dup.sources.push('google');
        dup.google_place_id = g.id;
      } else {
        options.push({ id: `google:${g.id}`, name: g.name, lat: g.lat, lng: g.lng, distance_m: distM(g), sources: ['google'], google_place_id: g.id });
      }
    }
  }

  options.sort((a, b) => a.distance_m - b.distance_m);
  return { options: options.slice(0, limit), sources: { osm, google, errors: errors.slice(0, 3) }, center, radius_m: radius };
}

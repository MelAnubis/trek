/**
 * stageCutService.ts — Cortes de etapa en poblaciones con alojamiento.
 *
 * Los cortes ideales (equiespaciados, o los que ya tenga la ruta) se mueven al núcleo con
 * alojamiento más adecuado dentro de ±7 km (hoteles, hostales, casas rurales, apartamentos,
 * campings…, datos de OpenStreetMap). Solo se consulta el entorno de cada corte, no toda la
 * ruta, así que el coste es una consulta pequeña por etapa, sea cual sea la longitud.
 */
import { getTilePois } from './lodgingTileService';
import { googleLodgingAvailable, searchGoogleLodgingNear } from './googleLodgingService';
import {
  simplifyLine, indexAtKm, nearestOnTrack, clusterLodging, chooseStageCuts,
  DEFAULT_MAX_SHIFT_KM, type TrackPoint, type StageCut, type LodgingSpot, type TownSpot,
} from './routeGeometry';

const RADIUS_M = 1500;
const MAX_OFF_TRACK_M = 1600;
const TOWN_RADIUS_M = 2000;                    // un pueblo cuyo casco queda a ≤ 2 km del track
const TOWN_WEIGHT: Record<string, number> = { city: 4, town: 3, village: 2 };
const BUDGET_MS = 45000;
export const MAX_CUTS_PER_REQUEST = 40;
const GOOGLE_RADIUS_M = 5000;                   // círculo de búsqueda; se piden tres centros por corte (−6, 0, +6 km)
const GOOGLE_STEP_KM = 6;
const MAX_GOOGLE_CALLS = 15;

export interface StageCutPlan {
  cuts: StageCut[];
  /** Consultas a OpenStreetMap hechas (las teselas ya en caché no cuentan) y cuántas fallaron. */
  queries: number;
  failed: number;
  /** false si no se obtuvo ningún dato de alojamientos (los cortes quedan a distancias iguales). */
  lodgingChecked: boolean;
  sources: {
    /**
     * Google Places como complemento de OpenStreetMap, solo para los cortes sin alojamiento en OSM:
     * `used` (se consultó), `not-needed` (OSM bastó), `no-key` (hay cortes sin alojamiento pero no hay clave de
     * Google en Trek) o `failed` (la consulta falló: clave sin Places API activada, cuota…).
     */
    google: 'used' | 'not-needed' | 'no-key' | 'failed';
    googleQueries: number;
    googleFound: number;
  };
}

export interface PlanStageCutsOptions {
  stageCount?: number;
  /** Cortes ideales en km (p. ej. los actuales de la ruta). Tienen prioridad sobre stageCount. */
  marks?: number[];
  maxShiftKm?: number;
  /**
   * El track es una ida y vuelta por el mismo camino y `mirrorKm` es la longitud de la ida: los
   * cortes de la vuelta se buscan en la ida (misma carretera) en vez de repetir las consultas.
   */
  mirrorKm?: number;
  /** Usuario cuya clave de Google Maps (si la tiene) se usa como fuente adicional. */
  userId?: number;
}

export async function planStageCuts(points: TrackPoint[], cum: number[], opts: PlanStageCutsOptions): Promise<StageCutPlan> {
  const total = cum[cum.length - 1] ?? 0;
  const maxShift = opts.maxShiftKm ?? DEFAULT_MAX_SHIFT_KM;
  const marks = opts.marks && opts.marks.length
    ? opts.marks.slice().sort((a, b) => a - b)
    : (opts.stageCount ?? 0) >= 2 && total > 0
      ? Array.from({ length: (opts.stageCount as number) - 1 }, (_, k) => ((k + 1) * total) / (opts.stageCount as number))
      : [];
  if (!marks.length) return { cuts: [], queries: 0, failed: 0, lodgingChecked: true, sources: { google: 'not-needed', googleQueries: 0, googleFound: 0 } };

  const half = maxShift * 3 + 2;                         // el margen más amplio de chooseStageCuts, más un pueblo
  const limitKm = opts.mirrorKm ?? total;                // dónde se busca de verdad
  const found = new Map<string, number>();               // osm_id → km (en la parte consultada)
  const townsFound = new Map<string, TownSpot>();         // osm_id → población
  const slices = new Map<number, boolean>();             // zona (km redondeado) → ¿alguna consulta falló?
  const keyOf = (mark: number) => Math.round(opts.mirrorKm && mark > opts.mirrorKm ? 2 * opts.mirrorKm - mark : mark);
  let queries = 0, failed = 0;
  const deadline = Date.now() + BUDGET_MS;

  for (const mark of marks) {
    const q = opts.mirrorKm && mark > opts.mirrorKm ? 2 * opts.mirrorKm - mark : mark;
    const key = Math.round(q);
    if (slices.has(key)) continue;
    const a = indexAtKm(cum, Math.max(0, q - half));
    const b = indexAtKm(cum, Math.min(limitKm, q + half));
    if (b <= a) { slices.set(key, false); continue; }
    const line = simplifyLine(points.slice(a, b + 1), 200);
    const res = await getTilePois('lodging', line, RADIUS_M, { deadline });
    queries += res.buckets;
    failed += res.failedBuckets;
    slices.set(key, res.failedBuckets > 0);
    for (const p of res.pois) {
      if (found.has(p.osm_id)) continue;
      const near = nearestOnTrack(points, cum, p);
      if (near.offM <= MAX_OFF_TRACK_M) found.set(p.osm_id, near.km);
    }
    // Poblaciones de la misma zona: sirven de fin de etapa cuando no hay alojamiento mapeado. Si esta consulta
    // falla no se pierde el alojamiento ya obtenido; solo se queda sin la alternativa.
    const tr = await getTilePois('settlement', line, TOWN_RADIUS_M, { deadline });
    queries += tr.buckets;
    failed += tr.failedBuckets;
    if (tr.failedBuckets > 0) slices.set(key, true);
    for (const p of tr.pois) {
      if (townsFound.has(p.osm_id)) continue;
      const near = nearestOnTrack(points, cum, p);
      if (near.offM <= TOWN_RADIUS_M) townsFound.set(p.osm_id, { km: near.km, weight: TOWN_WEIGHT[p.type ?? 'village'] ?? 2, name: p.name });
    }
  }

  const mirrored = (xs: number[]) => (opts.mirrorKm ? [...xs, ...xs.map(k => 2 * opts.mirrorKm! - k)] : xs);
  const osmSpots = clusterLodging(mirrored([...found.values()]), 1.5, 'osm');

  // Google solo donde OpenStreetMap no ha dado ningún alojamiento dentro del margen: es un complemento, no el sustituto.
  const needGoogle = marks.filter(m => !osmSpots.some(sp => Math.abs(sp.km - m) <= maxShift));
  const sources: StageCutPlan['sources'] = { google: 'not-needed', googleQueries: 0, googleFound: 0 };
  let googleSpots: LodgingSpot[] = [];
  if (needGoogle.length && opts.userId != null) {
    if (!googleLodgingAvailable(opts.userId)) sources.google = 'no-key';
    else {
      sources.google = 'used';
      const gKms: number[] = [];
      outer: for (const mark of needGoogle) {
        const q = opts.mirrorKm && mark > opts.mirrorKm ? 2 * opts.mirrorKm - mark : mark;     // en una ida y vuelta se busca en la ida
        for (const center of [q, q - GOOGLE_STEP_KM, q + GOOGLE_STEP_KM]) {
          if (center < 0 || center > limitKm) continue;
          if (sources.googleQueries >= MAX_GOOGLE_CALLS) break outer;
          const pt = points[indexAtKm(cum, center)];
          sources.googleQueries++;
          try {
            for (const g of await searchGoogleLodgingNear(opts.userId, pt[0], pt[1], GOOGLE_RADIUS_M)) {
              const near = nearestOnTrack(points, cum, g);
              if (near.offM <= MAX_OFF_TRACK_M) gKms.push(near.km);
            }
          } catch (err) {
            // Un fallo de Google (clave sin la API activada, cuota…) no tira el resto: se deja de insistir.
            console.warn('[stage-cuts] Google lodging lookup failed:', (err as Error)?.message);
            sources.google = 'failed';
            break outer;
          }
        }
      }
      sources.googleFound = gKms.length;
      googleSpots = clusterLodging(mirrored(gKms), 1.5, 'google');
    }
  }
  const spots: LodgingSpot[] = [...osmSpots, ...googleSpots];

  const townList = [...townsFound.values()];
  const towns: TownSpot[] = opts.mirrorKm
    ? [...townList, ...townList.map(t => ({ ...t, km: 2 * opts.mirrorKm! - t.km }))]
    : townList;
  const cuts = chooseStageCuts(total, opts.stageCount ?? 0, spots, { maxShiftKm: maxShift, marks, towns })
    .map((c, i) => (!c.lodged && slices.get(keyOf(marks[i])) ? { ...c, unchecked: true } : c));
  return { cuts, queries, failed, lodgingChecked: queries === 0 || failed < queries || spots.length > 0, sources };
}

/**
 * stageCutService.ts — Cortes de etapa en poblaciones con alojamiento.
 *
 * Los cortes ideales (equiespaciados, o los que ya tenga la ruta) se mueven al núcleo con
 * alojamiento más adecuado dentro de ±7 km (hoteles, hostales, casas rurales, apartamentos,
 * campings…, datos de OpenStreetMap). Solo se consulta el entorno de cada corte, no toda la
 * ruta, así que el coste es una consulta pequeña por etapa, sea cual sea la longitud.
 */
import { searchOverpassPoisAlongRoute } from './mapsService';
import {
  simplifyLine, indexAtKm, nearestOnTrack, clusterLodging, chooseStageCuts,
  DEFAULT_MAX_SHIFT_KM, type TrackPoint, type StageCut, type LodgingSpot,
} from './routeGeometry';

const RADIUS_M = 1500;
const MAX_OFF_TRACK_M = 1600;
const BUDGET_MS = 45000;
export const MAX_CUTS_PER_REQUEST = 40;

export interface StageCutPlan {
  cuts: StageCut[];
  /** Consultas a OpenStreetMap hechas y cuántas fallaron. */
  queries: number;
  failed: number;
  /** false si no se obtuvo ningún dato de alojamientos (los cortes quedan a distancias iguales). */
  lodgingChecked: boolean;
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
}

export async function planStageCuts(points: TrackPoint[], cum: number[], opts: PlanStageCutsOptions): Promise<StageCutPlan> {
  const total = cum[cum.length - 1] ?? 0;
  const maxShift = opts.maxShiftKm ?? DEFAULT_MAX_SHIFT_KM;
  const marks = opts.marks && opts.marks.length
    ? opts.marks.slice().sort((a, b) => a - b)
    : (opts.stageCount ?? 0) >= 2 && total > 0
      ? Array.from({ length: (opts.stageCount as number) - 1 }, (_, k) => ((k + 1) * total) / (opts.stageCount as number))
      : [];
  if (!marks.length) return { cuts: [], queries: 0, failed: 0, lodgingChecked: true };

  const half = maxShift * 3 + 2;                         // el margen más amplio de chooseStageCuts, más un pueblo
  const limitKm = opts.mirrorKm ?? total;                // dónde se busca de verdad
  const found = new Map<string, number>();               // osm_id → km (en la parte consultada)
  const done = new Set<number>();
  let queries = 0, failed = 0, lastErr: unknown = null;
  const t0 = Date.now();

  for (const mark of marks) {
    const q = opts.mirrorKm && mark > opts.mirrorKm ? 2 * opts.mirrorKm - mark : mark;
    const key = Math.round(q);
    if (done.has(key)) continue;
    done.add(key);
    if (Date.now() - t0 > BUDGET_MS) { failed++; queries++; continue; }
    const a = indexAtKm(cum, Math.max(0, q - half));
    const b = indexAtKm(cum, Math.min(limitKm, q + half));
    if (b <= a) continue;
    queries++;
    try {
      const res = await searchOverpassPoisAlongRoute('lodging', simplifyLine(points.slice(a, b + 1), 200), RADIUS_M, 300);
      for (const p of res.pois as { osm_id: string; lat: number; lng: number }[]) {
        if (found.has(p.osm_id)) continue;
        const near = nearestOnTrack(points, cum, p);
        if (near.offM <= MAX_OFF_TRACK_M) found.set(p.osm_id, near.km);
      }
    } catch (err) {
      failed++;
      lastErr = err;
    }
  }
  if (lastErr) console.warn('[stage-cuts] lodging lookup failed:', (lastErr as Error)?.message);

  const kms = [...found.values()];
  const all = opts.mirrorKm ? [...kms, ...kms.map(k => 2 * opts.mirrorKm! - k)] : kms;
  const spots: LodgingSpot[] = clusterLodging(all);
  const cuts = chooseStageCuts(total, opts.stageCount ?? 0, spots, { maxShiftKm: maxShift, marks });
  return { cuts, queries, failed, lodgingChecked: queries === 0 || failed < queries };
}

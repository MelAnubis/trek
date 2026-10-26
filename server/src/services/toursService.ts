/**
 * Tours (de liketrek/TREK v5.0.0): excursiones a pie, en bici o corriendo.
 *
 * Igual que en la v5, una excursión es un lugar del viaje — su línea en
 * places.route_geometry, sus días por day_assignments — más la faceta `tours`
 * y sus puntos de control (`tour_waypoints`). El planificador del navegador
 * traza la ruta (Valhalla) y manda la línea entera con sus alturas; aquí se
 * guardan los puntos y la línea, y las cifras (distancia, desnivel) se sacan
 * de la línea con la misma función que usa el cliente (tours/core.ts).
 */
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { db, getPlaceWithTags } from '../db/database';
import {
  computeTourMetrics, hikingPreferencesOf, maxTourMinutesFor, runPaceSecondsPerKmSchema, tourStageCountOf,
  tourStageIssues, tourStageStopsOf, tourTimeEstimate, type GeometryPoint,
} from '../tours/core';

// ── Contrato (subconjunto de shared/src/tours/tours.schema.ts) ───────────────

export const PLANNABLE_TOUR_TYPES = ['hike', 'bike', 'run'] as const;
export const TOUR_REVISION_CONFLICT = 'tour_revision_conflict';
const TOUR_FIXED_LEG_MAX_POINTS = 5000;
const TOUR_FIXED_LEG_END_TOLERANCE_M = 60;

const latLng = z.tuple([z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180)]);
const stationKeySchema = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
const fixedLegSchema = z.object({ kind: z.literal('free'), geometry: z.array(latLng).min(2).max(TOUR_FIXED_LEG_MAX_POINTS) });
const plannedMinutes = z.number().int().min(0).max(24 * 60).nullable();

export const tourWaypointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  role: z.enum(['start', 'via', 'end']),
  sequence: z.number().int().nonnegative(),
  fixed_leg: fixedLegSchema.nullable().optional(),
  shaping: z.boolean().optional(),
  linked_place_id: z.number().int().positive().nullable().optional(),
  key: stationKeySchema.optional(),
  name: z.string().trim().max(200).nullable().optional(),
  poi_category: z.string().max(40).nullable().optional(),
  stage_end: z.boolean().optional(),
});
export type TourWaypointInput = z.infer<typeof tourWaypointSchema>;

function gapM(a: readonly number[], b: readonly number[]): number {
  const rad = Math.PI / 180;
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
  const y = (b[0] - a[0]) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

export const tourWriteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  tour_type: z.enum(PLANNABLE_TOUR_TYPES).default('hike'),
  route_geometry: z.array(z.tuple([z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180), z.number().finite()])).min(2).max(50_000),
  waypoints: z.array(tourWaypointSchema).min(2).max(500),
  max_hiking_difficulty: z.number().int().min(1).max(6).nullable().optional(),
  hiking_preferences: z.object({ avoid_climbs: z.boolean().optional(), avoid_steps: z.boolean().optional(), avoid_ferries: z.boolean().optional() }).strict().nullable().optional(),
  bike_profile: z.enum(['touring', 'road', 'gravel', 'mtb']).nullable().optional(),
  run_profile: z.enum(['running', 'trail']).nullable().optional(),
  run_pace_seconds_per_km: runPaceSecondsPerKmSchema.nullable().optional(),
  duration_seconds: z.number().finite().nonnegative().nullable().optional(),
  planned_duration_minutes: plannedMinutes.optional(),
  break_additional_minutes: plannedMinutes.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().trim().max(500).url().refine(v => v.startsWith('https://'), 'must be an HTTPS URL').nullable().optional(),
  derived_from_place_id: z.number().int().positive().nullable().optional(),
  expected_revision: z.number().int().min(1).nullable().optional(),
}).superRefine((value, ctx) => {
  const stages = tourStageCountOf(value.waypoints);
  if (value.planned_duration_minutes == null && value.duration_seconds != null && value.break_additional_minutes != null
    && Math.round(value.duration_seconds / 60) + value.break_additional_minutes > maxTourMinutesFor(stages)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_additional_minutes'], message: 'walking time plus breaks must fit the days of the tour' });
  }
  if (value.tour_type !== 'bike' && value.bike_profile) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bike_profile'], message: 'only a bike tour has a bike profile' });
  if (value.tour_type !== 'run' && (value.run_profile || value.run_pace_seconds_per_km)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['run_profile'], message: 'only a run has a run profile and pace' });
  tourStageIssues(value.waypoints).forEach(issue => ctx.addIssue({ code: z.ZodIssueCode.custom, ...issue }));
  value.waypoints.forEach((point, index) => {
    const expected = index === 0 ? 'start' : index === value.waypoints.length - 1 ? 'end' : 'via';
    if (point.sequence !== index || point.role !== expected) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['waypoints', index], message: `Waypoint ${index} must be ${expected} with sequence ${index}` });
    }
    const leg = point.fixed_leg;
    const next = value.waypoints[index + 1];
    if (leg) {
      const first = leg.geometry[0], last = leg.geometry[leg.geometry.length - 1];
      if (!next || gapM(first as number[], [point.lat, point.lng]) > TOUR_FIXED_LEG_END_TOLERANCE_M || gapM(last as number[], [next.lat, next.lng]) > TOUR_FIXED_LEG_END_TOLERANCE_M) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['waypoints', index, 'fixed_leg'], message: `Waypoint ${index}'s fixed leg must run from it to the next waypoint` });
      }
    }
  });
}).transform(value => ({
  ...value,
  // A hike left without a limit is routed at T2, as in the v5.
  max_hiking_difficulty: value.tour_type === 'hike' ? (value.max_hiking_difficulty ?? 2) : null,
  hiking_preferences: value.tour_type === 'hike' ? hikingPreferencesOf(value.hiking_preferences) : null,
  bike_profile: value.tour_type === 'bike' ? (value.bike_profile ?? 'touring') : null,
  run_profile: value.tour_type === 'run' ? (value.run_profile ?? 'running') : null,
  run_pace_seconds_per_km: value.tour_type === 'run' ? (value.run_pace_seconds_per_km ?? null) : null,
}));
export type TourWrite = z.infer<typeof tourWriteSchema>;

// ── Lectura ──────────────────────────────────────────────────────────────────

interface TourRow {
  place_id: number; tour_type: string; distance: number | null; elevation_gain: number | null; elevation_loss: number | null;
  duration: number | null; difficulty: string | null; match_confidence: number | null; created_at: string | null;
  max_hiking_difficulty: number | null; planned_duration_minutes: number | null; break_additional_minutes: number | null;
  derived_from_place_id: number | null; recorded_route_geometry: string | null; origin: string; origin_file_name: string | null;
  revision: number; hiking_preferences: string | null; bike_profile: string | null; run_profile: string | null;
  run_pace_seconds_per_km: number | null; track_started_at: string | null; track_ended_at: string | null;
}
interface WaypointRow {
  id: number; place_id: number; lat: number; lng: number; role: 'start' | 'via' | 'end'; sequence: number; fixed_leg: string | null;
  shaping: number; linked_place_id: number | null; station_key: string | null; name: string | null; poi_category: string | null; stage_end: number;
}

const parseJson = <T>(s: string | null): T | null => { if (!s) return null; try { return JSON.parse(s) as T } catch { return null } };

export function listTourTypes() {
  return (db.prepare('SELECT * FROM tour_types ORDER BY sort_order').all() as Record<string, unknown>[])
    .map(r => ({ ...r, is_sport: !!r.is_sport, enabled: !!r.enabled }));
}

function waypointsOf(placeId: number): WaypointRow[] {
  return db.prepare('SELECT * FROM tour_waypoints WHERE place_id = ? ORDER BY sequence').all(placeId) as WaypointRow[];
}

function waypointOut(w: WaypointRow) {
  return {
    lat: w.lat, lng: w.lng, role: w.role, sequence: w.sequence,
    fixed_leg: parseJson(w.fixed_leg), shaping: !!w.shaping, linked_place_id: w.linked_place_id,
    key: w.station_key ?? undefined, name: w.name, poi_category: w.poi_category, stage_end: !!w.stage_end,
  };
}

/** Plan frente a realidad: the recorded track (GPX tab) linked as what was done of this tour, measured. */
function actualTrackOf(placeId: number) {
  const t = db.prepare(`SELECT id, track_name, total_distance, total_elevation_gain, total_elevation_loss, duration_seconds, ibp, day_id
    FROM gpx_tracks WHERE tour_place_id = ? ORDER BY id LIMIT 1`).get(placeId) as Record<string, unknown> | undefined;
  return t ?? null;
}

function listItem(row: TourRow & { name: string; description: string | null; website: string | null; planned: number; day_numbers?: string | null }) {
  const points = waypointsOf(row.place_id)
  const stops = tourStageStopsOf(points.map(p => ({ role: p.role, shaping: !!p.shaping, stage_end: !!p.stage_end, key: p.station_key ?? undefined, lat: p.lat, lng: p.lng })));
  const stageCount = tourStageCountOf(points.map(p => ({ stage_end: !!p.stage_end })));
  return {
    place_id: row.place_id, tour_type: row.tour_type, distance: row.distance, elevation_gain: row.elevation_gain,
    elevation_loss: row.elevation_loss, duration: row.duration, planned_duration_minutes: row.planned_duration_minutes,
    break_additional_minutes: row.break_additional_minutes, difficulty: row.difficulty, match_confidence: row.match_confidence,
    max_hiking_difficulty: row.max_hiking_difficulty, hiking_preferences: parseJson(row.hiking_preferences),
    derived_from_place_id: row.derived_from_place_id, bike_profile: row.bike_profile, run_profile: row.run_profile,
    run_pace_seconds_per_km: row.run_pace_seconds_per_km,
    name: row.name, description: row.description, website: row.website,
    planned: !!row.planned,
    day_numbers: [...new Set(String(row.day_numbers ?? '').split(',').filter(Boolean).map(Number))].sort((a, b) => a - b),
    caution: row.match_confidence != null && row.match_confidence < 0.5,
    has_waypoints: points.length > 0, has_recorded_track: !!row.recorded_route_geometry,
    origin: row.origin, origin_file_name: row.origin_file_name, revision: row.revision,
    track_started_at: row.track_started_at, track_ended_at: row.track_ended_at,
    time_estimate: tourTimeEstimate(row),
    actual_track: actualTrackOf(row.place_id),
    stage_count: stageCount > 1 ? stageCount : null,
    stage_stops: stops.length >= 3 ? stops : null,
  };
}
export type TourListItem = ReturnType<typeof listItem>;

const LIST_SQL = `
  SELECT t.*, p.name, p.description, p.website,
    EXISTS(SELECT 1 FROM day_assignments da WHERE da.place_id = p.id) AS planned,
    (SELECT group_concat(d.day_number) FROM day_assignments da JOIN days d ON d.id = da.day_id WHERE da.place_id = p.id) AS day_numbers
  FROM tours t JOIN places p ON p.id = t.place_id`;

export function listTours(tripId: number | string) {
  return (db.prepare(`${LIST_SQL} WHERE p.trip_id = ? ORDER BY p.created_at DESC, p.id DESC`).all(tripId) as Parameters<typeof listItem>[0][]).map(listItem);
}

export function getTourItem(tripId: number | string, placeId: number) {
  const row = db.prepare(`${LIST_SQL} WHERE p.trip_id = ? AND t.place_id = ?`).get(tripId, placeId) as Parameters<typeof listItem>[0] | undefined;
  return row ? listItem(row) : null;
}

function actualPointsOf(placeId: number): Array<[number, number, number | null]> | null {
  const t = db.prepare('SELECT points_json FROM gpx_tracks WHERE tour_place_id = ? ORDER BY id LIMIT 1').get(placeId) as { points_json: string | null } | undefined;
  if (!t) return null;
  const pts = parseJson<Array<{ lat: number; lng: number; ele?: number | null }>>(t.points_json) ?? [];
  return pts.map(p => [p.lat, p.lng, p.ele ?? null]);
}

export function getTourDetail(tripId: number | string, placeId: number) {
  const tour = getTourItem(tripId, placeId);
  if (!tour) return null;
  const place = db.prepare('SELECT route_geometry FROM places WHERE id = ?').get(placeId) as { route_geometry: string | null };
  const recorded = db.prepare('SELECT recorded_route_geometry FROM tours WHERE place_id = ?').get(placeId) as { recorded_route_geometry: string | null };
  const days = db.prepare(`SELECT da.id AS assignment_id, da.day_id, da.tour_stage_key, d.day_number, d.date
    FROM day_assignments da JOIN days d ON d.id = da.day_id WHERE da.place_id = ? ORDER BY d.day_number`).all(placeId);
  return {
    tour,
    waypoints: waypointsOf(placeId).map(waypointOut),
    route_geometry: parseJson<GeometryPoint[]>(place.route_geometry),
    recorded_route_geometry: parseJson<GeometryPoint[]>(recorded.recorded_route_geometry),
    days,
    actual_points: actualPointsOf(placeId),
  };
}

// ── Escritura ────────────────────────────────────────────────────────────────

export class TourError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) { super(message); }
}

const newKey = () => crypto.randomBytes(9).toString('base64url');

function writeWaypoints(placeId: number, points: TourWaypointInput[], linkable: Set<number>) {
  db.prepare('DELETE FROM tour_waypoints WHERE place_id = ?').run(placeId);
  const ins = db.prepare(`INSERT INTO tour_waypoints (place_id, lat, lng, role, sequence, fixed_leg, shaping, linked_place_id, station_key, name, poi_category, stage_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of points) {
    ins.run(placeId, p.lat, p.lng, p.role, p.sequence, p.fixed_leg ? JSON.stringify(p.fixed_leg) : null, p.shaping ? 1 : 0,
      p.linked_place_id && linkable.has(p.linked_place_id) ? p.linked_place_id : null,
      p.key ?? newKey(), p.name ?? null, p.poi_category ?? null, p.stage_end ? 1 : 0);
  }
}

function facetValues(input: TourWrite) {
  const metrics = computeTourMetrics(input.route_geometry as GeometryPoint[]);
  return {
    distance: metrics.distanceKm,
    elevation_gain: metrics.elevationGainM,
    elevation_loss: metrics.elevationLossM,
    duration: input.duration_seconds == null ? null : Math.round(input.duration_seconds / 60),
  };
}

function linkablePlaces(tripId: number | string): Set<number> {
  return new Set((db.prepare('SELECT id FROM places WHERE trip_id = ?').all(tripId) as { id: number }[]).map(r => r.id));
}

export function createTour(tripId: number | string, input: TourWrite) {
  const start = input.waypoints[0];
  return db.transaction(() => {
    const placeId = Number(db.prepare(`INSERT INTO places (trip_id, name, description, website, lat, lng, route_geometry, transport_mode, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'walking', ?)`).run(tripId, input.name, input.description ?? null, input.website ?? null,
      start.lat, start.lng, JSON.stringify(input.route_geometry), null).lastInsertRowid);
    const f = facetValues(input);
    const derived = input.derived_from_place_id && linkablePlaces(tripId).has(input.derived_from_place_id) ? input.derived_from_place_id : null;
    db.prepare(`INSERT INTO tours (place_id, tour_type, distance, elevation_gain, elevation_loss, duration, max_hiking_difficulty,
        planned_duration_minutes, break_additional_minutes, derived_from_place_id, origin, revision, hiking_preferences, bike_profile, run_profile, run_pace_seconds_per_km)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trek', 1, ?, ?, ?, ?)`).run(placeId, input.tour_type, f.distance, f.elevation_gain, f.elevation_loss, f.duration,
      input.max_hiking_difficulty, input.planned_duration_minutes ?? null, input.break_additional_minutes ?? null, derived,
      input.hiking_preferences ? JSON.stringify(input.hiking_preferences) : null, input.bike_profile, input.run_profile, input.run_pace_seconds_per_km);
    writeWaypoints(placeId, input.waypoints, linkablePlaces(tripId));
    return placeId;
  })();
}

export function updateTour(tripId: number | string, placeId: number, input: TourWrite) {
  const cur = db.prepare('SELECT t.revision FROM tours t JOIN places p ON p.id = t.place_id WHERE t.place_id = ? AND p.trip_id = ?').get(placeId, tripId) as { revision: number } | undefined;
  if (!cur) throw new TourError(404, 'Tour not found');
  if (input.expected_revision != null && input.expected_revision !== cur.revision) {
    throw new TourError(409, 'The tour was changed meanwhile', { code: TOUR_REVISION_CONFLICT, revision: cur.revision });
  }
  const start = input.waypoints[0];
  db.transaction(() => {
    db.prepare('UPDATE places SET name = ?, description = ?, website = ?, lat = ?, lng = ?, route_geometry = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(input.name, input.description ?? null, input.website ?? null, start.lat, start.lng, JSON.stringify(input.route_geometry), placeId);
    const f = facetValues(input);
    db.prepare(`UPDATE tours SET tour_type = ?, distance = ?, elevation_gain = ?, elevation_loss = ?, duration = ?, max_hiking_difficulty = ?,
        planned_duration_minutes = ?, break_additional_minutes = ?, hiking_preferences = ?, bike_profile = ?, run_profile = ?, run_pace_seconds_per_km = ?,
        revision = revision + 1 WHERE place_id = ?`).run(input.tour_type, f.distance, f.elevation_gain, f.elevation_loss, f.duration,
      input.max_hiking_difficulty, input.planned_duration_minutes ?? null, input.break_additional_minutes ?? null,
      input.hiking_preferences ? JSON.stringify(input.hiking_preferences) : null, input.bike_profile, input.run_profile, input.run_pace_seconds_per_km, placeId);
    // A GPX import planned over keeps the track it was recorded with, to go back to it.
    db.prepare(`UPDATE tours SET recorded_route_geometry = COALESCE(recorded_route_geometry,
        (SELECT route_geometry FROM places WHERE id = ? AND NOT EXISTS (SELECT 1 FROM tour_waypoints WHERE place_id = ?)))
      WHERE place_id = ? AND origin = 'gpx' AND recorded_route_geometry IS NULL`).run(placeId, placeId, placeId);
    writeWaypoints(placeId, input.waypoints, linkablePlaces(tripId));
  })();
}

/** A copy is a tour of its own, revision 1, on no day. */
export function copyTour(tripId: number | string, placeId: number, name: string | null): number {
  const src = getTourDetail(tripId, placeId);
  if (!src) throw new TourError(404, 'Tour not found');
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM places WHERE id = ?').get(placeId) as Record<string, unknown>;
    const newId = Number(db.prepare(`INSERT INTO places (trip_id, name, description, website, lat, lng, route_geometry, transport_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'walking')`).run(tripId, (name || `${p.name}`).slice(0, 255), p.description ?? null, p.website ?? null, p.lat, p.lng, p.route_geometry).lastInsertRowid);
    db.prepare(`INSERT INTO tours (place_id, tour_type, distance, elevation_gain, elevation_loss, duration, difficulty, match_confidence, max_hiking_difficulty,
        planned_duration_minutes, break_additional_minutes, recorded_route_geometry, origin, origin_file_name, revision, hiking_preferences, bike_profile, run_profile,
        run_pace_seconds_per_km, track_started_at, track_ended_at)
      SELECT ?, tour_type, distance, elevation_gain, elevation_loss, duration, difficulty, match_confidence, max_hiking_difficulty,
        planned_duration_minutes, break_additional_minutes, recorded_route_geometry, origin, origin_file_name, 1, hiking_preferences, bike_profile, run_profile,
        run_pace_seconds_per_km, track_started_at, track_ended_at FROM tours WHERE place_id = ?`).run(newId, placeId);
    db.prepare(`INSERT INTO tour_waypoints (place_id, lat, lng, role, sequence, fixed_leg, shaping, linked_place_id, station_key, name, poi_category, stage_end)
      SELECT ?, lat, lng, role, sequence, fixed_leg, shaping, linked_place_id, station_key, name, poi_category, stage_end FROM tour_waypoints WHERE place_id = ?`).run(newId, placeId);
    return newId;
  })();
}

/** An import planned over goes back to the track it was recorded with: its points go, the line comes back. */
export function restoreRecorded(tripId: number | string, placeId: number) {
  const row = db.prepare('SELECT t.recorded_route_geometry FROM tours t JOIN places p ON p.id = t.place_id WHERE t.place_id = ? AND p.trip_id = ?').get(placeId, tripId) as { recorded_route_geometry: string | null } | undefined;
  if (!row) throw new TourError(404, 'Tour not found');
  if (!row.recorded_route_geometry) throw new TourError(400, 'This tour has no recorded track');
  const pts = parseJson<GeometryPoint[]>(row.recorded_route_geometry) ?? [];
  const m = computeTourMetrics(pts);
  db.transaction(() => {
    db.prepare('UPDATE places SET route_geometry = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.recorded_route_geometry, placeId);
    db.prepare(`UPDATE tours SET recorded_route_geometry = NULL, distance = ?, elevation_gain = ?, elevation_loss = ?, duration = NULL,
      planned_duration_minutes = NULL, break_additional_minutes = NULL, revision = revision + 1 WHERE place_id = ?`).run(m.distanceKm, m.elevationGainM, m.elevationLossM, placeId);
    db.prepare('DELETE FROM tour_waypoints WHERE place_id = ?').run(placeId);
  })();
}

export function deleteTour(tripId: number | string, placeId: number): boolean {
  return db.prepare('DELETE FROM places WHERE id = ? AND trip_id = ? AND id IN (SELECT place_id FROM tours)').run(placeId, tripId).changes > 0;
}

export function placePayload(placeId: number) {
  return getPlaceWithTags(placeId);
}

// ── GPX ──────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The vertex of the line each point lies at, searching on from where the one before lay (stages/tourStages.ts of the v5). */
function vertexIndicesOf(points: ReadonlyArray<{ lat: number; lng: number }>, line: ReadonlyArray<readonly number[]>): number[] {
  const metres = (v: readonly number[], lat: number, lng: number) => Math.hypot((v[1] - lng) * Math.cos((lat * Math.PI) / 180), v[0] - lat) * 111_320;
  const out: number[] = [];
  let from = 0;
  for (const p of points) {
    let nearest = Infinity;
    for (let i = from; i < line.length; i++) nearest = Math.min(nearest, metres(line[i], p.lat, p.lng));
    let index = from;
    for (let i = from; i < line.length; i++) if (metres(line[i], p.lat, p.lng) <= nearest + 30) { index = i; break; }
    out.push(index);
    from = index;
  }
  return out;
}

/** A multi-day tour's stages as spans of its points: from the start or a stage end to the next one, or to the end. */
function stageSpans(points: ReadonlyArray<{ stage_end?: boolean }>): Array<{ from: number; to: number }> {
  if (points.length < 2) return [];
  const spans: Array<{ from: number; to: number }> = [];
  let from = 0;
  points.forEach((p, i) => { if (p.stage_end && i > 0 && i < points.length - 1) { spans.push({ from, to: i }); from = i; } });
  spans.push({ from, to: points.length - 1 });
  return spans;
}

/**
 * The tour as GPX: the whole of it, or one stage (day) of a multi-day tour,
 * cut from the one line at the stops that end the stages.
 */
export function exportTourGpx(tripId: number | string, placeId: number, stage?: number): { name: string; xml: string } | null {
  const d = getTourDetail(tripId, placeId);
  if (!d) return null;
  let pts = d.route_geometry ?? [];
  let points = d.waypoints;
  let name = d.tour.name;
  if (stage != null) {
    const spans = stageSpans(d.waypoints);
    const span = spans[stage - 1];
    if (!span || spans.length < 2 || pts.length < 2) return null;
    const at = vertexIndicesOf(d.waypoints, pts);
    pts = pts.slice(at[span.from], at[span.to] + 1);
    points = d.waypoints.slice(span.from, span.to + 1);
    name = `${d.tour.name} - ${stage}`;
  }
  const wpts = points.filter(w => !w.shaping).map((w, i) =>
    `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${esc(w.name || (i === 0 ? 'Start' : `${i}`))}</name></wpt>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trek Wanderer" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(name)}</name>${d.tour.description ? `<desc>${esc(d.tour.description)}</desc>` : ''}</metadata>`,
    ...wpts,
    `  <trk><name>${esc(name)}</name><type>${d.tour.tour_type}</type><trkseg>`,
    ...pts.map(p => `      <trkpt lat="${p[0]}" lon="${p[1]}">${p.length === 3 ? `<ele>${p[2]}</ele>` : ''}</trkpt>`),
    '  </trkseg></trk>',
    '</gpx>',
  ].join('\n');
  return { name, xml };
}

export function gpxFileName(name: string): string {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return `${base || 'tour'}.gpx`;
}

export interface ImportedTrack {
  index: number; name: string; points: GeometryPoint[]; times: (string | null)[];
}

const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_',
  isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'Placemark', 'Folder', 'Document', 'LineString', 'gx:Track', 'gx:coord', 'when'].includes(name),
});

function num(v: unknown): number | null { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; }

/** Every track and route a GPX or KML file holds, in file order. */
export function readTrackFile(buffer: Buffer, fileName: string): ImportedTrack[] {
  const text = buffer.toString('utf-8');
  const doc = xml.parse(text);
  const out: ImportedTrack[] = [];
  const push = (name: string, pts: { lat: number | null; lng: number | null; ele: number | null; time: string | null }[]) => {
    const good = pts.filter(p => p.lat != null && p.lng != null && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) as { lat: number; lng: number; ele: number | null; time: string | null }[];
    if (good.length < 2) return;
    const withEle = good.every(p => p.ele != null);
    out.push({ index: out.length, name: name || `Track ${out.length + 1}`, points: good.map(p => (withEle ? [p.lat, p.lng, p.ele as number] : [p.lat, p.lng])), times: good.map(p => p.time) });
  };
  if (doc?.gpx) {
    const gpx = doc.gpx;
    const fallback = String(gpx.metadata?.name ?? fileName.replace(/\.[^.]+$/, ''));
    for (const trk of gpx.trk ?? []) {
      const pts = (trk.trkseg ?? []).flatMap((seg: { trkpt?: Record<string, unknown>[] }) => (seg.trkpt ?? []).map(pt => ({ lat: num(pt['@_lat']), lng: num(pt['@_lon']), ele: num(pt.ele), time: pt.time ? String(pt.time) : null })));
      push(trk.name ? String(trk.name) : fallback, pts);
    }
    for (const rte of gpx.rte ?? []) {
      push(rte.name ? String(rte.name) : fallback, (rte.rtept ?? []).map((pt: Record<string, unknown>) => ({ lat: num(pt['@_lat']), lng: num(pt['@_lon']), ele: num(pt.ele), time: null })));
    }
    return out;
  }
  const kml = doc?.kml;
  if (kml) {
    const placemarks: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      for (const pm of (n.Placemark as Record<string, unknown>[] | undefined) ?? []) placemarks.push(pm);
      for (const k of ['Document', 'Folder']) for (const child of (n[k] as unknown[] | undefined) ?? []) walk(child);
    };
    walk(kml);
    for (const pm of placemarks) {
      const lines: unknown[] = [];
      const collect = (g: unknown) => {
        if (!g || typeof g !== 'object') return;
        const o = g as Record<string, unknown>;
        for (const ls of (o.LineString as Record<string, unknown>[] | undefined) ?? []) lines.push(ls.coordinates);
        if (o.MultiGeometry) collect(o.MultiGeometry);
      };
      collect(pm);
      const coords = lines.flatMap(c => String(c ?? '').trim().split(/\s+/).map(t => {
        const [lng, lat, ele] = t.split(',').map(Number);
        return { lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, ele: Number.isFinite(ele) && t.split(',').length > 2 ? ele : null, time: null };
      }));
      push(pm.name ? String(pm.name) : fileName.replace(/\.[^.]+$/, ''), coords);
    }
  }
  return out;
}

/** What the import preview shows of a track: its measures and a thinned line. */
export function previewTrack(t: ImportedTrack) {
  const m = computeTourMetrics(t.points);
  const step = Math.max(1, Math.floor(t.points.length / 300));
  const times = t.times.filter(Boolean) as string[];
  return {
    index: t.index, name: t.name, point_count: t.points.length,
    distance_km: m.distanceKm, elevation_gain: m.elevationGainM, elevation_loss: m.elevationLossM, has_heights: m.hasElevation,
    started_at: times[0] ?? null, ended_at: times[times.length - 1] ?? null,
    line: t.points.filter((_, i) => i % step === 0 || i === t.points.length - 1).map(p => [p[0], p[1]] as [number, number]),
  };
}

export const importChoiceSchema = z.object({
  choices: z.array(z.object({
    index: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(255),
    tour_type: z.enum(PLANNABLE_TOUR_TYPES),
  })).min(1).max(50),
});

/** One tour per chosen track, kept as it was recorded (no points to plan from). */
export function importTracks(tripId: number | string, tracks: ImportedTrack[], choices: z.infer<typeof importChoiceSchema>['choices'], fileName: string): number[] {
  return db.transaction(() => choices.map(choice => {
    const t = tracks.find(x => x.index === choice.index);
    if (!t) throw new TourError(400, `No track ${choice.index} in the file`);
    const m = computeTourMetrics(t.points);
    const times = t.times.filter(Boolean) as string[];
    const placeId = Number(db.prepare(`INSERT INTO places (trip_id, name, lat, lng, route_geometry, transport_mode) VALUES (?, ?, ?, ?, ?, 'walking')`)
      .run(tripId, choice.name, t.points[0][0], t.points[0][1], JSON.stringify(t.points)).lastInsertRowid);
    db.prepare(`INSERT INTO tours (place_id, tour_type, distance, elevation_gain, elevation_loss, duration, max_hiking_difficulty, origin, origin_file_name,
        match_confidence, revision, bike_profile, run_profile, track_started_at, track_ended_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, 'gpx', ?, ?, 1, NULL, NULL, ?, ?)`).run(placeId, choice.tour_type, m.distanceKm, m.elevationGainM, m.elevationLossM,
      fileName.slice(0, 255), m.hasElevation ? 1 : 0.4, times[0] ?? null, times[times.length - 1] ?? null);
    return placeId;
  }))();
}

/**
 * A recorded track of the GPX tab made a tour of its own: kept as recorded, like
 * an import, so it can be planned over with «Planificar versión editable».
 */
export function tourFromTrack(tripId: number | string, trackId: number): number {
  const t = db.prepare('SELECT track_name, points_json, transport_mode FROM gpx_tracks WHERE id = ? AND trip_id = ?').get(trackId, tripId) as
    { track_name: string; points_json: string | null; transport_mode: string | null } | undefined;
  if (!t) throw new TourError(404, 'Track not found');
  const raw = parseJson<Array<{ lat: number; lng: number; ele?: number | null; time?: string | null }>>(t.points_json) ?? [];
  const pts = raw.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < 2) throw new TourError(422, 'The track has no line');
  const withHeights = pts.every(p => p.ele != null && Number.isFinite(p.ele));
  const track: ImportedTrack = {
    index: 0,
    name: t.track_name || 'Track',
    points: pts.map(p => (withHeights ? [p.lat, p.lng, Number(p.ele)] : [p.lat, p.lng]) as GeometryPoint),
    times: pts.map(p => p.time ?? null),
  };
  const type = t.transport_mode === 'cycling' ? 'bike' : t.transport_mode === 'running' ? 'run' : 'hike';
  const [id] = importTracks(tripId, [track], [{ index: 0, name: track.name.slice(0, 255), tour_type: type }], `${track.name}.gpx`);
  return id;
}

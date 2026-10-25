/**
 * Lógica pura de Tours, copiada tal cual de liketrek/TREK v5.0.0
 * (shared/src/tours, AGPL-3.0): etapas, ritmo de carrera, tiempo DIN 33466,
 * métricas de un trazado y lo que cada tipo pide al enrutador (Valhalla).
 * El servidor lleva la misma copia en server/src/tours/core.ts (con zod).
 */

// ── geo/haversine.ts ──
/**
 * Great-circle distance in metres.
 *
 * The clamp keeps `asin` defined: floating point can push the argument a hair
 * over 1 for near-antipodal points, and a NaN distance silently fails every
 * comparison it feeds rather than throwing.
 */
export function haversineMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── tours/tour-stages.ts ──
/**
 * MDT-01: a multi-day tour is one tour, planned whole, whose stops mark where
 * each day's stage ends. The stages are read off the route in its order: the
 * first runs from the start to the first stage end, the next from there on,
 * the last to the end of the tour. Nothing about a stage is stored besides the
 * mark on its last stop, so the whole route and its stages cannot drift apart.
 * A tour without a mark is a day tour, as every tour saved before was.
 */

/** A day in minutes: the most one stage, and a day tour, is planned for. */
export const TOUR_DAY_MINUTES = 24 * 60;

/** The most stages a tour is split into, two months of days. */
export const MAX_TOUR_STAGES = 60;

/** A point as a stage end is read from: where it sits on the tour, and whether it steers only. */
interface StagePoint {
  role: 'start' | 'via' | 'end';
  shaping?: boolean;
  stage_end?: boolean;
}

/** Where a request's stage ends do not hold, and why. */
interface StageIssue {
  path: Array<string | number>;
  message: string;
}

/** How many stages the points make: one more than their stage ends, one for a day tour. */
export function tourStageCountOf(points: ReadonlyArray<{ stage_end?: boolean }>): number {
  return 1 + points.filter((point) => point.stage_end === true).length;
}

/** The longest moving time plus breaks a tour of so many stages is planned for: a day each. */
export function maxTourMinutesFor(stageCount: number): number {
  return Math.max(1, stageCount) * TOUR_DAY_MINUTES;
}

/**
 * Where a stage end may not sit: at the start or the end of the tour, which
 * begin and finish the first and the last stage anyway, and on a shaping
 * point, which is no stop to spend a night at. Beyond {@link MAX_TOUR_STAGES}
 * the tour is refused as a whole.
 */
export function tourStageIssues(points: readonly StagePoint[]): StageIssue[] {
  const issues: StageIssue[] = [];
  points.forEach((point, index) => {
    if (point.stage_end !== true) return;
    if (point.role !== 'via')
      issues.push({ path: ['waypoints', index, 'stage_end'], message: 'a stage ends at a stop between start and end' });
    else if (point.shaping === true)
      issues.push({ path: ['waypoints', index, 'stage_end'], message: 'a shaping point ends no stage' });
  });
  if (tourStageCountOf(points) > MAX_TOUR_STAGES)
    issues.push({ path: ['waypoints'], message: `a tour has at most ${MAX_TOUR_STAGES} stages` });
  return issues;
}

/** MDT-02: a stop a stage starts or ends at, as a list or a day plan places the stages. */
export interface TourStageStop {
  /** The point's own key, kept across saves; a stage is known by the key of the stop it starts at. */
  key: string;
  lat: number;
  lng: number;
}

/** A saved point as the stops between the stages are read from it. */
interface StoredStagePoint extends StagePoint {
  key?: string;
  lat: number;
  lng: number;
}

/**
 * MDT-02: the stops the stages of a multi-day tour run between, in route
 * order: the start, every stop that ends a stage, and the end, so stage `n`
 * runs from stop `n - 1` to stop `n`. A stage is put on a day by the key of
 * the stop it starts at, which a save keeps, so a stage end set or taken away
 * elsewhere leaves the other stages on their days. None for a day tour, and
 * none where a stop has no key yet (a point no save has kept), since such a
 * stage could not be found again.
 */
export function tourStageStopsOf(points: readonly StoredStagePoint[]): TourStageStop[] {
  if (points.length < 2 || tourStageCountOf(points) < 2) return [];
  const last = points.length - 1;
  const stops = points.filter((point, index) => index === 0 || index === last || point.stage_end === true);
  const keyed = stops.flatMap((point) => (point.key ? [{ key: point.key, lat: point.lat, lng: point.lng }] : []));
  return keyed.length === stops.length ? keyed : [];
}

/** The keys a stage can be put on a day by: those of the stops the stages start at, the last stop starting none. */
export function tourStageKeysOf(points: readonly StoredStagePoint[]): string[] {
  return tourStageStopsOf(points)
    .slice(0, -1)
    .map((stop) => stop.key);
}

// ── tours/run-pace.ts ──

/**
 * RUN-01: a run is planned with the runner's own pace, in seconds per
 * kilometre, and its time is the distance at that pace. Nothing else goes in:
 * no climb, no descent, no surface and no difficulty, and TREK suggests no
 * pace of its own. A run without a pace has no time; it stays unknown.
 *
 * The bounds keep a typo out, not a runner: 2:00 min/km is faster than any
 * road record, 20:00 min/km slower than walking.
 */
export const MIN_RUN_PACE_SECONDS_PER_KM = 2 * 60;
export const MAX_RUN_PACE_SECONDS_PER_KM = 20 * 60;

/** The planned running time in whole minutes: the distance at the pace, 8 km at 6:00 min/km is 48 minutes. */
export function runMinutesAtPace(distanceKm: number, paceSecondsPerKm: number): number {
  return Math.round((distanceKm * paceSecondsPerKm) / 60);
}

// ── tours/tour-time-estimate.ts ──


/**
 * Walking time the way hiking signposts in the Alps state it (DIN 33466, as the
 * DAV and the Swiss hiking trails use it): 4 km an hour on the flat, 300 m of
 * climb and 500 m of descent an hour, and of the time for the distance and the
 * time for the height only the larger counts in full, the smaller by half.
 *
 * The planner times a hike by it, and an imported hike is estimated by it
 * (TIME-01), so both come from this one rule.
 */
const FLAT_KM_PER_HOUR = 4;
const CLIMB_M_PER_HOUR = 300;
const DESCENT_M_PER_HOUR = 500;

export function hikingTimeMinutes(distanceKm: number, climbM: number, descentM: number): number {
  const flat = distanceKm / FLAT_KM_PER_HOUR;
  const height = climbM / CLIMB_M_PER_HOUR + descentM / DESCENT_M_PER_HOUR;
  const hours = Math.max(flat, height) + Math.min(flat, height) / 2;
  return Math.round(hours * 60);
}

/**
 * TIME-01: what an estimate is worked out by. `din33466`: a hike's distance,
 * climb and descent by the signposts' rule; `run_pace`: a run's distance at
 * the pace its runners entered.
 */
export type TourTimeEstimateBasis = 'din33466' | 'run_pace';

/**
 * TIME-01: the time a tour without a planned time is estimated to take, in
 * minutes and without breaks, worked out whenever it is read and never
 * stored. `minutes` is null when the rule needs heights the track does not
 * carry: then the time is unknown, never the time on the flat.
 */
export interface TourTimeEstimate { minutes: number | null; basis: TourTimeEstimateBasis }

/** What an estimate is read from: the tour's type, its measures, its planned time and a run's pace. */
export interface TourTimeEstimateSource {
  tour_type: string;
  distance: number | null;
  elevation_gain: number | null;
  elevation_loss: number | null;
  /** The time the planner worked out, in minutes; a tour that has one is not estimated. */
  duration: number | null;
  run_pace_seconds_per_km?: number | null;
}

/**
 * TIME-01: the estimate of a tour that has no time of its own (an imported
 * track, which the planner never timed), or null where there is nothing to
 * estimate it by. Only the rules the planner times these types by are used:
 * a hike by DIN 33466 from its own climb and descent, a run by the pace its
 * runners entered. A bike tour, a city walk and a paddle tour are timed by a
 * router or by a speed of their own, a ride and a ski tour by none, so none
 * of them is estimated here.
 */
export function tourTimeEstimate(tour: TourTimeEstimateSource): TourTimeEstimate | null {
  if (tour.duration != null || tour.distance == null) return null;
  if (tour.tour_type === 'hike') {
    const known = tour.elevation_gain != null && tour.elevation_loss != null;
    return {
      minutes: known ? hikingTimeMinutes(tour.distance, tour.elevation_gain ?? 0, tour.elevation_loss ?? 0) : null,
      basis: 'din33466',
    };
  }
  const pace = tour.run_pace_seconds_per_km ?? null;
  if (tour.tour_type === 'run' && pace !== null) {
    return { minutes: runMinutesAtPace(tour.distance, pace), basis: 'run_pace' };
  }
  return null;
}

// ── tours/tours.metrics.ts ──

/** One decoded `route_geometry` point: `[lat, lng]` or `[lat, lng, ele]`. */
export type GeometryPoint = [number, number] | [number, number, number];

export interface TourMetrics {
  /** Sum of segment haversine distances, in km. */
  distanceKm: number;
  /** Ascent in metres, jitter under ELEVATION_NOISE_M left out. Null when the track carries no elevation. */
  elevationGainM: number | null;
  /** Descent in metres, counted the same way. Null when no elevation. */
  elevationLossM: number | null;
  /** Whether every point in the geometry carried a 3rd (elevation) value. */
  hasElevation: boolean;
}

/**
 * How far, in metres, a height has to move from the last one that counted before
 * it counts as climbing or descending. Elevation models jitter a few metres from
 * one point to the next, and summed as it came, that jitter was the whole ascent
 * of a flat city walk: 121 m across Venice, whose highest point is 16 m. Measured
 * this way a real climb still adds up in full; only moves smaller than this that
 * turn back are left out.
 */
const ELEVATION_NOISE_M = 5;

/**
 * Ascent and descent over a run of heights, in metres, with the noise above
 * filtered out. The server's stored tour figures and the client's live analysis
 * both count with this, so a tour reads the same in the list and in its detail.
 */
export function elevationGainLoss(heights: readonly number[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let [ref] = heights;
  if (ref === undefined) return { gain, loss };
  for (const height of heights) {
    const delta = height - ref;
    if (delta >= ELEVATION_NOISE_M) gain += delta;
    else if (delta <= -ELEVATION_NOISE_M) loss -= delta;
    else continue;
    ref = height;
  }
  return { gain, loss };
}

/**
 * Derives distance/elevation from a parsed `route_geometry` array. Never throws:
 * a track with fewer than 2 points, or with missing/mixed elevation, still
 * yields a usable (if partial) result rather than blocking import.
 *
 * The server stores these numbers on every tour; the client computes the same
 * ones for a tour saved offline, so both read them from here.
 */
export function computeTourMetrics(points: readonly GeometryPoint[]): TourMetrics {
  const [first, ...rest] = points;
  if (!first || rest.length === 0) {
    return { distanceKm: 0, elevationGainM: null, elevationLossM: null, hasElevation: false };
  }
  const hasElevation = points.every((p) => p.length === 3 && Number.isFinite(p[2]));

  let distanceKm = 0;
  let prev = first;
  for (const point of rest) {
    distanceKm += haversineMetres(prev[0], prev[1], point[0], point[1]) / 1000;
    prev = point;
  }
  const elevation = hasElevation ? elevationGainLoss(points.map((point) => point[2] as number)) : null;

  return {
    distanceKm,
    elevationGainM: elevation ? elevation.gain : null,
    elevationLossM: elevation ? elevation.loss : null,
    hasElevation,
  };
}

// ── tours/tour-costing.ts ──

/**
 * What a bike tour and a run ask Valhalla for, by their profile: the
 * bicycle costing of a bike tour and the pedestrian costing of a run. The
 * planner in the browser and the server's tour routing both read them here,
 * so a ride or a run is weighed alike wherever it is planned. A hike's own
 * costing is `hikingCosting`.
 */
export type TourCostingOptions = Readonly<Record<string, number | string>>;

/**
 * BIK-01 to BIK-04: what each bike profile asks Valhalla's bicycle costing for.
 * Every one was checked against the public instance with trace_attributes over
 * the routes it gave, before it was offered (shares of the length):
 * - touring, Hybrid with bad surfaces avoided: Garmisch station to the Eckbauer
 *   92 % asphalt and no gravel, where gravel took 18 % gravel on farm tracks.
 * - road, Road at full surface avoidance: Herrsching to Andechs 100 % asphalt
 *   over 6.2 km, where touring took 4.98 km with 7 % dirt and 10 % compacted.
 * - gravel, Cross with surfaces barely avoided: Munich Marienplatz to the
 *   Englischer Garten 39 % compacted paths along the Isar, touring 9 %.
 * - mtb, Mountain with no surface avoidance and roads least wanted: Garmisch
 *   to the Eckbauer 63 % tracks and 38 % gravel.
 * `use_roads` and the bicycle type also set the router's riding speed, so the
 * time it gives is the profile's. None of it says a way is rideable or safe.
 */
export const BIKE_COSTING: Readonly<Record<BikeProfile, TourCostingOptions>> = {
  touring: { bicycle_type: 'Hybrid', use_roads: 0.2, avoid_bad_surfaces: 1 },
  road: { bicycle_type: 'Road', use_roads: 0.5, avoid_bad_surfaces: 1 },
  gravel: { bicycle_type: 'Cross', use_roads: 0.1, avoid_bad_surfaces: 0.25 },
  mtb: { bicycle_type: 'Mountain', use_roads: 0, avoid_bad_surfaces: 0 },
};

/**
 * RUN-01, RUN-02: what each run profile asks Valhalla's pedestrian costing
 * for. A run is run, so a ferry only where no way on land exists
 * (`use_ferry` 0). Checked with trace_attributes against the public instance
 * on 20.10.2026 (shares of the length):
 * - running keeps to runnable, mostly paved ways: farm and forest tracks only
 *   where there is no other way (`use_tracks` 0), and no hiking limit, so the
 *   router keeps to the ways it takes for walking anyway (T1). Berlin S
 *   Grunewald into the forest went from 95 % tracks with 3 % paved to 67 %
 *   smooth paved paths over 3.58 km instead of 3.50 km; Munich Großhesseloher
 *   Brücke to Pullach from 79 % to 88 % smooth asphalt and no track left;
 *   Marienplatz to the Englischer Garten stayed as it was.
 * - trail takes tracks wherever they serve (`use_tracks` 1) and admits
 *   mountain paths up to T2 (`max_hiking_difficulty` 2), never T3 and above.
 *   Above Freiburg Günterstal up to the Schauinsland it went from 82 % roads
 *   and 83 % paved (running) to 78 % forest tracks and 81 % compacted, gravel
 *   and dirt over 9.57 km instead of 10.15 km; Rathen to the Bastei took 28 % of T2
 *   path that running leaves out; Heidelberg's old town, all streets, stayed
 *   as it was. Leaning on footways (`walkway_factor`) was tried and left out:
 *   along the Isar it moved the run onto paved footways, from 33 % to 18 %
 *   unpaved.
 * The router's own time is a walker's and is never used: a run's time is its
 * distance at the runner's pace, whatever the profile. Nothing here says a
 * way can be run.
 */
export const RUN_COSTING: Readonly<Record<RunProfile, TourCostingOptions>> = {
  running: { use_tracks: 0, use_ferry: 0 },
  trail: { use_tracks: 1, use_ferry: 0, max_hiking_difficulty: 2 },
};

/** The bicycle costing of a bike tour of this profile. */
export function bikeCosting(profile: BikeProfile): TourCostingOptions {
  return BIKE_COSTING[profile];
}

/** The pedestrian costing of a run of this profile. */
export function runCosting(profile: RunProfile): TourCostingOptions {
  return RUN_COSTING[profile];
}

// ── tours/hiking-costing.ts ──

/**
 * Defensive fallback only. Normal planner calls pass the persisted/draft value.
 * TREK exposes 1..6 and never exposes Valhalla's internal 0.
 */
export const TOURS_MAX_HIKING_DIFFICULTY = 2;

/**
 * What a hike asks Valhalla's pedestrian costing for: its hiking limit, and
 * the weightings its preferences switch on. The planner in the browser and
 * the server's hike routing both build it here, so a hike is weighed alike
 * wherever it is planned.
 */
export type HikingCosting = Record<string, number> & { max_hiking_difficulty: number };

/**
 * MF-08, RTE-01: a hike's preferences as Valhalla's pedestrian costing
 * options. Each one was checked against the public instance before it was
 * offered, and is a weighting that gives way where there is no other path:
 * - avoid_climbs, `use_hills` 0.2: Freiburg Martinstor to the Schlossberg went
 *   from 1.64 km with a 37 % pitch and 30 m over 25 % to 1.73 km whose steepest
 *   stretch is 23 % (heights every 30 m). It weighs the grade, not the climb in
 *   sum: the same height is still gained. 0.1 and below sent Garmisch station
 *   to the Eckbauer round a 10 km detour with more steep metres, 0.25 and up
 *   left Freiburg as it was; 0.2 does neither.
 * - avoid_steps, `step_penalty` 600 s: Würzburg Altstadt to the Festung went
 *   from four flights of steps over 1.49 km to one over 2.67 km.
 * - avoid_ferries, `use_ferry` 0: Kiel Reventlou to Dietrichsdorf went from the
 *   Förde ferry (2.7 km) round the fjord on land (8.3 km); Hamburg
 *   Landungsbrücken to Steinwerder through the old Elbe tunnel instead of the ferry.
 * The router has no option for marked, paved or rough ways on foot.
 */
export function hikingCostingOptions(preferences: HikingPreferences | null | undefined): Record<string, number> {
  return {
    ...(preferences?.avoid_climbs ? { use_hills: 0.2 } : {}),
    ...(preferences?.avoid_steps ? { step_penalty: 600 } : {}),
    ...(preferences?.avoid_ferries ? { use_ferry: 0 } : {}),
  };
}

/**
 * Everything a hike asks the pedestrian costing for: its limit and its
 * preferences. One reading for the whole tour and for the ways offered for one
 * of its sections (RTE-02), so both are weighed by the same rules.
 */
export function hikingCosting(
  maxHikingDifficulty: number = TOURS_MAX_HIKING_DIFFICULTY,
  preferences: HikingPreferences | null = null,
): HikingCosting {
  return { max_hiking_difficulty: maxHikingDifficulty, ...hikingCostingOptions(preferences) };
}

// ── tours.schema.ts (lo que usan las funciones de arriba) ──
export const BIKE_PROFILES = ['touring', 'road', 'gravel', 'mtb'] as const;
export type BikeProfile = (typeof BIKE_PROFILES)[number];
export const RUN_PROFILES = ['running', 'trail'] as const;
export type RunProfile = (typeof RUN_PROFILES)[number];
export const HIKING_PREFERENCE_KEYS = ['avoid_climbs', 'avoid_steps', 'avoid_ferries'] as const;
export type HikingPreferences = { avoid_climbs?: boolean; avoid_steps?: boolean; avoid_ferries?: boolean };
export function hikingPreferencesOf(value: HikingPreferences | null | undefined): HikingPreferences | null {
  const kept = HIKING_PREFERENCE_KEYS.filter((key) => value?.[key] === true);
  return kept.length === 0 ? null : Object.fromEntries(kept.map((key) => [key, true]));
}

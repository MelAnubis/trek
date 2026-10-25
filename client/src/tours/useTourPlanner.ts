// El planificador de Tours, como useTourPlanner de liketrek/TREK v5.0.0 para excursión, bici y carrera:
// puntos con deshacer/rehacer, ruta por Valhalla según el tipo, alturas, tiempos DIN / router / ritmo,
// etapas para una excursión de varios días, y guardar con control de revisión.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  computeTourMetrics, hikingTimeMinutes, runMinutesAtPace, maxTourMinutesFor, tourStageCountOf,
  type BikeProfile, type HikingPreferences, type RunProfile,
} from './core'
import { routeBikeTour, routeRun, routeWalkingTour, enrichTourElevations, type TourRouteResult, type TourRoutePart } from './routing/tourRouting'
import { isTourRoute } from './routing/tourRouteOutcome'
import type { TourFixedLeg } from './routing/types'
import { toursApi, type TourDetail, type TourType, type TourWaypoint } from './toursApi'

export interface DraftPoint {
  id: string
  lat: number
  lng: number
  name?: string | null
  linked_place_id?: number | null
  shaping?: boolean
  stage_end?: boolean
  fixed_leg?: TourFixedLeg | null
  key?: string
}

export type PlannerStatus =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'routing' }
  | { kind: 'routingFailed' }
  | { kind: 'unreachable'; point: number; meters: number }
  | { kind: 'elevation' }
  | { kind: 'elevationFailed' }
  | { kind: 'saving' }
  | { kind: 'saveFailed' }
  | { kind: 'conflict' }

export interface PlannerFields {
  name: string
  tourType: TourType
  maxDifficulty: number
  preferences: HikingPreferences
  bikeProfile: BikeProfile
  runProfile: RunProfile
  runPace: number | null
  multiDay: boolean
  breakMinutes: number | null
  plannedOverride: number | null
}

const EMPTY_FIELDS: PlannerFields = {
  name: '', tourType: 'hike', maxDifficulty: 2, preferences: {}, bikeProfile: 'touring', runProfile: 'running',
  runPace: 360, multiDay: false, breakMinutes: null, plannedOverride: null,
}

let seq = 0
const newId = () => `wp-${Date.now().toString(36)}-${(seq++).toString(36)}`

export interface PlannerOpenState { placeId: number | null; revision: number | null }

export function useTourPlanner(tripId: number | string, onSaved: (placeId: number, created: boolean) => void) {
  const [open, setOpen] = useState<PlannerOpenState | null>(null)
  const [fields, setFieldsState] = useState<PlannerFields>(EMPTY_FIELDS)
  const [hist, setHist] = useState<{ past: DraftPoint[][]; present: DraftPoint[]; future: DraftPoint[][] }>({ past: [], present: [], future: [] })
  const points = hist.present
  const setPointsState = useCallback((present: DraftPoint[]) => setHist({ past: [], present, future: [] }), [])
  const [route, setRoute] = useState<TourRouteResult | null>(null)
  const [geometry, setGeometry] = useState<[number, number, number][] | null>(null)
  const [status, setStatus] = useState<PlannerStatus>({ kind: 'idle' })
  const [dirty, setDirty] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [routeKey, setRouteKey] = useState(0)
  const [derivedFrom, setDerivedFrom] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const setFields = useCallback((patch: Partial<PlannerFields>) => {
    setFieldsState(f => ({ ...f, ...patch }))
    setDirty(true)
  }, [])

  const commitPoints = useCallback((next: DraftPoint[] | ((prev: DraftPoint[]) => DraftPoint[])) => {
    setHist(h => {
      const value = typeof next === 'function' ? next(h.present) : next
      if (value === h.present) return h
      return { past: [...h.past.slice(-49), h.present], present: value, future: [] }
    })
    setDirty(true)
  }, [])

  const undo = useCallback(() => {
    setHist(h => h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)
    setDirty(true)
  }, [])
  const redo = useCallback(() => {
    setHist(h => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)
    setDirty(true)
  }, [])

  // ── Puntos ────────────────────────────────────────────────────────────────
  const addPoint = useCallback((lat: number, lng: number, extra: Partial<DraftPoint> = {}) => {
    commitPoints(prev => [...prev, { id: newId(), lat, lng, ...extra }])
  }, [commitPoints])

  const insertShaping = useCallback((lat: number, lng: number) => {
    // A shaping point goes in the leg of the route nearest the click.
    commitPoints(prev => {
      if (prev.length < 2 || !route) return [...prev, { id: newId(), lat, lng }]
      const leg = nearestLeg(prev, route.coordinates, lat, lng)
      const next = prev.slice()
      next.splice(leg + 1, 0, { id: newId(), lat, lng, shaping: true })
      return next
    })
  }, [commitPoints, route])

  const movePoint = useCallback((id: string, lat: number, lng: number) => {
    commitPoints(prev => prev.map(p => p.id === id ? { ...p, lat, lng, linked_place_id: null, fixed_leg: null } : p))
  }, [commitPoints])
  const removePoint = useCallback((id: string) => commitPoints(prev => prev.filter(p => p.id !== id)), [commitPoints])
  const shiftPoint = useCallback((id: string, by: -1 | 1) => commitPoints(prev => {
    const i = prev.findIndex(p => p.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= prev.length) return prev
    const next = prev.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    return next.map(p => ({ ...p, fixed_leg: null }))
  }), [commitPoints])
  const reverse = useCallback(() => commitPoints(prev => prev.slice().reverse().map(p => ({ ...p, fixed_leg: null, stage_end: false }))), [commitPoints])
  const roundTrip = useCallback(() => commitPoints(prev => prev.length < 2 ? prev : [...prev, { id: newId(), lat: prev[0].lat, lng: prev[0].lng, name: prev[0].name, linked_place_id: prev[0].linked_place_id }]), [commitPoints])
  const toggleShaping = useCallback((id: string) => commitPoints(prev => prev.map((p, i) => p.id === id && i > 0 && i < prev.length - 1 ? { ...p, shaping: !p.shaping, stage_end: false } : p)), [commitPoints])
  const toggleStageEnd = useCallback((id: string) => commitPoints(prev => prev.map((p, i) => p.id === id && i > 0 && i < prev.length - 1 ? { ...p, stage_end: !p.stage_end, shaping: false } : p)), [commitPoints])
  const drawLegByHand = useCallback((id: string) => commitPoints(prev => prev.map((p, i) => {
    if (p.id !== id || i >= prev.length - 1) return p
    if (p.fixed_leg) return { ...p, fixed_leg: null }
    const next = prev[i + 1]
    return { ...p, fixed_leg: { kind: 'free', geometry: [[p.lat, p.lng], [next.lat, next.lng]] } }
  })), [commitPoints])
  const unlinkPlace = useCallback((id: string) => commitPoints(prev => prev.map(p => p.id === id ? { ...p, linked_place_id: null } : p)), [commitPoints])

  // ── Enrutado ──────────────────────────────────────────────────────────────
  const routeInputKey = useMemo(() => JSON.stringify({
    p: points.map(p => [p.lat, p.lng, p.fixed_leg?.kind ?? null]),
    t: fields.tourType, d: fields.maxDifficulty, pr: fields.preferences, b: fields.bikeProfile, r: fields.runProfile, k: routeKey,
  }), [points, fields.tourType, fields.maxDifficulty, fields.preferences, fields.bikeProfile, fields.runProfile, routeKey])
  const lastRoutedKey = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (points.length < 2) {
      abortRef.current?.abort()
      setRoute(null); setGeometry(null)
      setStatus({ kind: 'idle' })
      return
    }
    if (lastRoutedKey.current === routeInputKey) return
    setStatus({ kind: 'dirty' })
    const ctrl = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ctrl
    const timer = setTimeout(async () => {
      setStatus({ kind: 'routing' })
      const legs = points.map(p => ({ lat: p.lat, lng: p.lng, fixedLeg: freeLegFor(p, points) }))
      try {
        const result = fields.tourType === 'bike'
          ? await routeBikeTour(legs, fields.bikeProfile, ctrl.signal)
          : fields.tourType === 'run'
            ? await routeRun(legs, fields.runProfile, ctrl.signal)
            : await routeWalkingTour(legs, ctrl.signal, fields.maxDifficulty, fields.preferences)
        if (ctrl.signal.aborted) return
        if (!result) { setStatus({ kind: 'routingFailed' }); return }
        if (!isTourRoute(result)) {
          if ('unreachable' in result) setStatus({ kind: 'unreachable', point: result.unreachable + 1, meters: result.snappedMeters })
          else setStatus({ kind: 'routingFailed' })
          return
        }
        setRoute(result)
        setGeometry(null)
        lastRoutedKey.current = routeInputKey
        setStatus({ kind: 'elevation' })
        const enriched = await enrichTourElevations(result.coordinates, ctrl.signal)
        if (ctrl.signal.aborted) return
        if (enriched && enriched.every(p => p.length === 3)) {
          setGeometry(enriched as [number, number, number][])
          setStatus({ kind: 'idle' })
        } else {
          setStatus({ kind: 'elevationFailed' })
        }
      } catch {
        if (!ctrl.signal.aborted) setStatus({ kind: 'routingFailed' })
      }
    }, 450)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeInputKey, open])

  const retry = useCallback(() => { lastRoutedKey.current = null; setRouteKey(k => k + 1) }, [])

  // ── Datos de la ruta ──────────────────────────────────────────────────────
  const analysis = useMemo(() => {
    const line = geometry ?? route?.coordinates ?? null
    if (!line || line.length < 2) return null
    const m = computeTourMetrics(line)
    const heights = geometry ? geometry.map(p => p[2]) : []
    return {
      distanceKm: route ? route.distanceMeters / 1000 : m.distanceKm,
      gain: m.elevationGainM,
      loss: m.elevationLossM,
      minAlt: heights.length ? Math.min(...heights) : null,
      maxAlt: heights.length ? Math.max(...heights) : null,
    }
  }, [geometry, route])

  const movingMinutes = useMemo(() => {
    if (!analysis) return null
    const routerMinutes = route?.durationSeconds != null ? route.durationSeconds / 60 : null
    if (fields.tourType === 'run') return fields.runPace ? runMinutesAtPace(analysis.distanceKm, fields.runPace) : null
    if (fields.tourType === 'bike') return routerMinutes
    return analysis.gain != null && analysis.loss != null ? hikingTimeMinutes(analysis.distanceKm, analysis.gain, analysis.loss) : routerMinutes
  }, [analysis, route, fields.tourType, fields.runPace])

  const stageCount = tourStageCountOf(points)
  const plannedTotal = fields.plannedOverride ?? (movingMinutes == null ? null : Math.round(movingMinutes) + (fields.breakMinutes ?? 0))
  const timeTooLong = fields.plannedOverride == null && movingMinutes != null && fields.breakMinutes != null
    && Math.round(movingMinutes) + fields.breakMinutes > maxTourMinutesFor(stageCount)

  const canSave = !!open && dirty && points.length >= 2 && !!geometry && !!route && status.kind !== 'saving'
    && !(fields.tourType === 'run' && !fields.runPace) && !timeTooLong

  // ── Abrir / cerrar ───────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortRef.current?.abort()
    lastRoutedKey.current = null
    setPointsState([]); setRoute(null); setGeometry(null)
    setStatus({ kind: 'idle' }); setDirty(false); setAddMode(false); setDerivedFrom(null)
  }, [])

  const startNew = useCallback((type: TourType = 'hike') => {
    reset()
    setFieldsState({ ...EMPTY_FIELDS, tourType: type })
    setOpen({ placeId: null, revision: null })
    setAddMode(true)
  }, [reset])

  const openTour = useCallback((detail: TourDetail) => {
    reset()
    const tour = detail.tour
    setFieldsState({
      name: tour.name,
      tourType: tour.tour_type,
      maxDifficulty: tour.max_hiking_difficulty ?? 2,
      preferences: tour.hiking_preferences ?? {},
      bikeProfile: tour.bike_profile ?? 'touring',
      runProfile: tour.run_profile ?? 'running',
      runPace: tour.run_pace_seconds_per_km ?? 360,
      multiDay: (tour.stage_count ?? 1) > 1,
      breakMinutes: tour.break_additional_minutes,
      plannedOverride: tour.planned_duration_minutes,
    })
    const pts: DraftPoint[] = detail.waypoints.map(w => ({
      id: newId(), lat: w.lat, lng: w.lng, name: w.name, linked_place_id: w.linked_place_id ?? null,
      shaping: !!w.shaping, stage_end: !!w.stage_end, fixed_leg: w.fixed_leg ?? null, key: w.key,
    }))
    setPointsState(pts)
    if (detail.route_geometry && detail.route_geometry.length > 1) {
      const coords = detail.route_geometry.map(p => [p[0], p[1]] as [number, number])
      setRoute({ coordinates: coords, parts: [{ coordinates: coords, free: false }], distanceMeters: (tour.distance ?? 0) * 1000, durationSeconds: tour.duration != null ? tour.duration * 60 : null })
      if (detail.route_geometry.every(p => p.length === 3)) setGeometry(detail.route_geometry as [number, number, number][])
      lastRoutedKey.current = JSON.stringify({
        p: pts.map(p => [p.lat, p.lng, p.fixed_leg?.kind ?? null]),
        t: tour.tour_type, d: tour.max_hiking_difficulty ?? 2, pr: tour.hiking_preferences ?? {}, b: tour.bike_profile ?? 'touring', r: tour.run_profile ?? 'running', k: 0,
      })
    }
    setRouteKey(0)
    setOpen({ placeId: tour.place_id, revision: tour.revision })
  }, [reset])

  /** A recorded track as an editable tour: control points taken off its line, routed again (tours.conversion of the v5). */
  const startFromLine = useCallback((name: string, type: TourType, line: [number, number][], derivedFrom: number) => {
    reset()
    setFieldsState({ ...EMPTY_FIELDS, tourType: type, name })
    const count = Math.min(10, Math.max(2, Math.round(line.length / 40)))
    const pts: DraftPoint[] = []
    for (let i = 0; i < count; i++) {
      const at = line[Math.round((i / (count - 1)) * (line.length - 1))]
      pts.push({ id: newId(), lat: at[0], lng: at[1] })
    }
    setPointsState(pts)
    setDerivedFrom(derivedFrom)
    setDirty(true)
    setOpen({ placeId: null, revision: null })
  }, [reset])

  const close = useCallback(() => { reset(); setOpen(null) }, [reset])

  const save = useCallback(async () => {
    if (!open || !geometry || !route) return
    setStatus({ kind: 'saving' })
    const multi = fields.multiDay
    const body = {
      name: fields.name.trim() || defaultName(fields.tourType),
      tour_type: fields.tourType,
      route_geometry: geometry,
      waypoints: savedWaypoints(points, multi),
      max_hiking_difficulty: fields.tourType === 'hike' ? fields.maxDifficulty : null,
      hiking_preferences: fields.tourType === 'hike' ? fields.preferences : null,
      bike_profile: fields.tourType === 'bike' ? fields.bikeProfile : null,
      run_profile: fields.tourType === 'run' ? fields.runProfile : null,
      run_pace_seconds_per_km: fields.tourType === 'run' ? fields.runPace : null,
      duration_seconds: movingMinutes == null ? null : Math.round(movingMinutes * 60),
      planned_duration_minutes: fields.plannedOverride,
      break_additional_minutes: fields.breakMinutes,
      expected_revision: open.revision,
      ...(derivedFrom && !open.placeId ? { derived_from_place_id: derivedFrom } : {}),
    }
    try {
      const res = open.placeId ? await toursApi.update(tripId, open.placeId, body) : await toursApi.create(tripId, body)
      setOpen({ placeId: res.tour.place_id, revision: res.tour.revision })
      setDirty(false)
      setStatus({ kind: 'idle' })
      onSaved(res.tour.place_id, !open.placeId)
      return res.tour
    } catch (err) {
      const e = err as { response?: { status?: number } }
      setStatus({ kind: e.response?.status === 409 ? 'conflict' : 'saveFailed' })
      return null
    }
  }, [open, geometry, route, fields, points, movingMinutes, tripId, onSaved, derivedFrom])

  return {
    open, fields, setFields, points, route, geometry, status, dirty, addMode, setAddMode,
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, undo, redo,
    addPoint, insertShaping, movePoint, removePoint, shiftPoint, reverse, roundTrip, toggleShaping, toggleStageEnd, drawLegByHand, unlinkPlace,
    analysis, movingMinutes, plannedTotal, timeTooLong, stageCount, canSave, retry,
    startNew, openTour, startFromLine, close, save,
  }
}
export type TourPlanner = ReturnType<typeof useTourPlanner>

export function defaultName(type: TourType): string {
  return type === 'bike' ? 'Bike tour' : type === 'run' ? 'Run' : 'Hike'
}

/** A free leg keeps its two ends on the points it joins as they move. */
function freeLegFor(p: DraftPoint, all: DraftPoint[]): TourFixedLeg | null {
  if (!p.fixed_leg) return null
  const i = all.indexOf(p)
  const next = all[i + 1]
  if (!next) return null
  if (p.fixed_leg.kind === 'free') return { kind: 'free', geometry: [[p.lat, p.lng], [next.lat, next.lng]] }
  return p.fixed_leg
}

function savedWaypoints(points: DraftPoint[], multiDay: boolean): TourWaypoint[] {
  return points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    role: i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'via',
    sequence: i,
    fixed_leg: freeLegFor(p, points),
    shaping: i > 0 && i < points.length - 1 ? !!p.shaping : false,
    linked_place_id: p.linked_place_id ?? null,
    ...(p.key ? { key: p.key } : {}),
    name: p.name ?? null,
    stage_end: multiDay && i > 0 && i < points.length - 1 ? !!p.stage_end : false,
  }))
}

/** The leg of the route a point on it belongs to: the waypoint after which it is nearest along the line. */
function nearestLeg(points: DraftPoint[], line: [number, number][], lat: number, lng: number): number {
  const idx = (q: { lat: number; lng: number }) => {
    let best = 0, bestD = Infinity
    line.forEach(([a, b], i) => { const d = (a - q.lat) ** 2 + (b - q.lng) ** 2; if (d < bestD) { bestD = d; best = i } })
    return best
  }
  const at = idx({ lat, lng })
  const marks = points.map(idx)
  for (let i = 0; i < marks.length - 1; i++) if (at >= marks[i] && at <= marks[i + 1]) return i
  return Math.max(0, points.length - 2)
}

export type { TourRoutePart }

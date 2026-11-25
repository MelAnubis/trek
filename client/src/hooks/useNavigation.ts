import { useCallback, useEffect, useRef, useState } from 'react'
import { useGeolocation } from './useGeolocation'
import { GpxRecorderService, type RecordedPoint } from '../services/gpxRecorderService'
import {
  advanceInstructions,
  generateTrackInstructions,
  fetchApproachRoute,
  type TurnInstruction,
} from '../services/turnByTurnService'
import { nativeGeoService, type NativeGeoPosition } from '../services/nativeGeoService'
import { navVoice, spokenDistance, spokenDuration, spokenManeuver } from '../services/navVoice'
import { saveNavDraft, clearNavDraft, type NavDraft } from '../services/navDraftStore'

export type NavMode = 'idle' | 'recording' | 'following'

export interface NavPhoto {
  id: number
  lat: number
  lng: number
  altitude?: number | null
  taken_at: string
  caption?: string | null
  url: string
  filename: string
}

export interface TrackPoint {
  lat: number
  lng: number
  ele: number | null
  time?: string | null
}

export interface NavStats {
  distanceTraveledM: number
  distanceRemainingM: number
  elapsedSeconds: number
  currentSpeedKmh: number
  avgSpeedKmh: number
  elevationGainM: number
  elevationLossM: number
}

const INITIAL_STATS: NavStats = {
  distanceTraveledM: 0,
  distanceRemainingM: 0,
  elapsedSeconds: 0,
  currentSpeedKmh: 0,
  avgSpeedKmh: 0,
  elevationGainM: 0,
  elevationLossM: 0,
}

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function distAlongTrack(pts: TrackPoint[], from: number, to: number): number {
  let d = 0
  const end = Math.min(to, pts.length - 1)
  for (let i = Math.max(from, 1); i <= end; i++) {
    d += haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
  }
  return d
}

function totalTrackM(pts: TrackPoint[]): number {
  return distAlongTrack(pts, 0, pts.length - 1)
}

function nearestPointIdx(pts: TrackPoint[], lat: number, lng: number, hint: number): number {
  const win = 80
  const start = Math.max(0, hint - 10)
  const end = Math.min(pts.length - 1, hint + win)
  let best = hint
  let bestD = Infinity
  for (let i = start; i <= end; i++) {
    const d = haversineM(lat, lng, pts[i].lat, pts[i].lng)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function minDistToTrackWindow(pts: TrackPoint[], lat: number, lng: number, idx: number): number {
  const win = 30
  const start = Math.max(0, idx - win)
  const end = Math.min(pts.length - 1, idx + win)
  let min = Infinity
  for (let i = start; i <= end; i++) {
    const d = haversineM(lat, lng, pts[i].lat, pts[i].lng)
    if (d < min) min = d
  }
  return min
}

function globalNearestPointIdx(pts: TrackPoint[], lat: number, lng: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = haversineM(lat, lng, pts[i].lat, pts[i].lng)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** Where the recording is made, kept with the draft so it can be picked up again. */
export interface NavDraftMeta {
  trackName: string
  tripId: number | null
  path: string
}

/** Stopped for this long while recording → automatic pause. */
const AUTO_PAUSE_AFTER_MS = 120_000
/** Moving further than this from the last "moving" fix counts as moving (GPS jitter stays inside). */
const MOVE_RADIUS_M = 15
/** …or going faster than this (m/s, ≈ 5 km/h). */
const MOVING_SPEED_MS = 1.4
/** The recording in progress is written to the phone at least this often. */
const DRAFT_EVERY_MS = 15_000

interface VoiceState {
  lastKm: number
  instrFar: string
  instrNear: string
  deviatedFixes: number
  deviatedSpoken: boolean
  near500: boolean
  arrived: boolean
}
const freshVoiceState = (): VoiceState => ({ lastKm: 0, instrFar: '', instrNear: '', deviatedFixes: 0, deviatedSpoken: false, near500: false, arrived: false })

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export function useNavigation(draftMeta?: NavDraftMeta) {
  const geo = useGeolocation()
  const recorder = useRef(new GpxRecorderService())

  const [navMode, setNavMode] = useState<NavMode>('idle')
  const [recordedPoints, setRecordedPoints] = useState<RecordedPoint[]>([])
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([])
  const [progressIdx, setProgressIdx] = useState(0)
  const [isDeviated, setIsDeviated] = useState(false)
  const [stats, setStats] = useState<NavStats>(INITIAL_STATS)
  const [instructions, setInstructions] = useState<TurnInstruction[]>([])
  const [instrIdx, setInstrIdx] = useState(0)
  const [distanceToTrackM, setDistanceToTrackM] = useState<number | null>(null)
  const [approachRoute, setApproachRoute] = useState<[number, number][] | null>(null)
  const [approachInstructions, setApproachInstructions] = useState<TurnInstruction[]>([])
  const [approachInstrIdx, setApproachInstrIdx] = useState(0)
  const [isApproaching, setIsApproaching] = useState(false)
  const [navPhotos, setNavPhotos] = useState<NavPhoto[]>([])
  const [geoRecordingError, setGeoRecordingError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [autoPaused, setAutoPaused] = useState(false)
  const [batteryWarning, setBatteryWarning] = useState<string | null>(null)
  const [voiceMuted, setVoiceMutedState] = useState(navVoice.isMuted())

  const startTimeRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAltRef = useRef<number | null>(null)
  const elevGainRef = useRef(0)
  const elevLossRef = useRef(0)
  const navModeRef = useRef<NavMode>('idle')
  navModeRef.current = navMode
  const trackPointsRef = useRef<TrackPoint[]>([])
  trackPointsRef.current = trackPoints
  const instructionsRef = useRef<TurnInstruction[]>([])
  instructionsRef.current = instructions
  const instrIdxRef = useRef(0)
  const approachInstructionsRef = useRef<TurnInstruction[]>([])
  approachInstructionsRef.current = approachInstructions
  const approachInstrIdxRef = useRef(0)
  const isApproachingRef = useRef(false)
  isApproachingRef.current = isApproaching
  const progressIdxRef = useRef(0)
  const recordWatchRef = useRef<number | null>(null)
  // Pause bookkeeping: time spent paused does not count as moving time.
  const pausedMsRef = useRef(0)
  const pauseStartRef = useRef<number | null>(null)
  const autoPausedRef = useRef(false)
  const lastMoveAtRef = useRef(0)
  const lastMovePosRef = useRef<{ lat: number; lng: number } | null>(null)
  // On the Android app the native GPS (which keeps running with the screen off)
  // drives the route guidance; the browser watch only moves the map marker.
  const nativeFollowRef = useRef(false)
  const lastDraftAtRef = useRef(0)
  const draftMetaRef = useRef(draftMeta)
  draftMetaRef.current = draftMeta
  const voiceRef = useRef<VoiceState>(freshVoiceState())

  const clearTimer = () => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null }
  }

  /** Seconds since the start, without the time spent paused. */
  const movingSeconds = (): number => {
    if (!startTimeRef.current) return 0
    const now = Date.now()
    const paused = pausedMsRef.current + (pauseStartRef.current ? now - pauseStartRef.current : 0)
    return Math.max(0, (now - startTimeRef.current - paused) / 1000)
  }

  // ── Recording kept on the phone ──────────────────────────────────────────────

  const persistDraft = (force = false) => {
    const rec = recorder.current
    if (!rec.isRunning || !startTimeRef.current || rec.points.length < 2) return
    const now = Date.now()
    if (!force && now - lastDraftAtRef.current < DRAFT_EVERY_MS) return
    lastDraftAtRef.current = now
    const meta = draftMetaRef.current
    void saveNavDraft({
      startedAt: startTimeRef.current,
      points: rec.points,
      pausedMs: pausedMsRef.current + (pauseStartRef.current ? now - pauseStartRef.current : 0),
      elevationGainM: elevGainRef.current,
      elevationLossM: elevLossRef.current,
      path: meta?.path ?? '/navigate',
      trackName: meta?.trackName ?? 'Ruta',
      tripId: meta?.tripId ?? null,
      following: navModeRef.current === 'following',
    })
  }

  // ── Pause / resume ───────────────────────────────────────────────────────────

  const doPause = (auto: boolean) => {
    const rec = recorder.current
    if (!rec.isRunning || rec.isPaused) return
    rec.pause()
    // An automatic pause starts when the stop began, not two minutes later:
    // standing still is not moving time.
    pauseStartRef.current = auto && lastMoveAtRef.current ? lastMoveAtRef.current : Date.now()
    autoPausedRef.current = auto
    setIsPaused(true)
    setAutoPaused(auto)
    navVoice.speak(auto ? 'Grabación en pausa automática. Se reanudará cuando te muevas.' : 'Grabación en pausa.')
    persistDraft(true)
  }

  const doResume = () => {
    const rec = recorder.current
    if (!rec.isPaused) return
    rec.resume()
    if (pauseStartRef.current) pausedMsRef.current += Date.now() - pauseStartRef.current
    pauseStartRef.current = null
    autoPausedRef.current = false
    lastMoveAtRef.current = Date.now()
    lastAltRef.current = null // no climb or descent across the gap
    setIsPaused(false)
    setAutoPaused(false)
    navVoice.speak('Grabación reanudada.')
  }

  const startTimer = () => {
    clearTimer()
    timerRef.current = setInterval(() => {
      if (!startTimeRef.current) return
      setStats(s => ({ ...s, elapsedSeconds: movingSeconds() }))
      // Standing still sends no fixes at all (distance filter), so the timer checks it.
      const rec = recorder.current
      if (rec.isRunning && !rec.isPaused && lastMoveAtRef.current && Date.now() - lastMoveAtRef.current > AUTO_PAUSE_AFTER_MS) {
        doPause(true)
      }
    }, 1000)
  }

  const stopRecordWatch = () => {
    nativeFollowRef.current = false
    void nativeGeoService.stop()
    if (recordWatchRef.current !== null) {
      navigator.geolocation.clearWatch(recordWatchRef.current)
      recordWatchRef.current = null
    }
  }

  // ── Route guidance ───────────────────────────────────────────────────────────

  /** Speaks the next maneuver once on approach (≈150 m) and once when it is due. */
  const announceInstruction = (list: TurnInstruction[], idx: number, lat: number, lng: number, prefix: string) => {
    const instr = list[idx]
    if (!instr || instr.type === 'depart' || instr.type === 'arrive') return
    const key = `${prefix}${idx}`
    const v = voiceRef.current
    const d = haversineM(lat, lng, instr.location[0], instr.location[1])
    const what = spokenManeuver(instr.type, instr.modifier)
    const street = instr.name ? ` por ${instr.name}` : ''
    if (d <= 40 && v.instrNear !== key) {
      v.instrNear = key
      v.instrFar = key
      navVoice.speak(`${capitalize(what)}${street}.`)
    } else if (d <= 150 && d > 60 && v.instrFar !== key) {
      v.instrFar = key
      navVoice.speak(`En ${spokenDistance(d)}, ${what}${street}.`)
    }
  }

  /** One position while following a route: progress, deviation, next maneuver and voice. */
  const applyFollowFix = (lat: number, lng: number, speed: number | null) => {
    if (navModeRef.current !== 'following') return
    const pts = trackPointsRef.current
    if (pts.length === 0) return

    const newIdx = nearestPointIdx(pts, lat, lng, progressIdxRef.current)
    progressIdxRef.current = newIdx
    const minDist = minDistToTrackWindow(pts, lat, lng, newIdx)
    const distTraveled = distAlongTrack(pts, 0, newIdx)
    const total = totalTrackM(pts)
    const remaining = total - distTraveled
    const elapsed = movingSeconds()
    const avgKmh = elapsed > 60 ? (distTraveled / 1000) / (elapsed / 3600) : 0

    setProgressIdx(newIdx)
    setIsDeviated(minDist > 50)
    setDistanceToTrackM(minDist)
    setStats(s => ({
      ...s,
      distanceTraveledM: distTraveled,
      distanceRemainingM: remaining,
      currentSpeedKmh: speed !== null ? (speed ?? 0) * 3.6 : 0,
      avgSpeedKmh: avgKmh,
    }))

    const v = voiceRef.current

    // Off the route: said once two fixes in a row agree (one bad fix is no reason to shout).
    if (minDist > 50) {
      v.deviatedFixes++
      if (v.deviatedFixes >= 2 && !v.deviatedSpoken && !isApproachingRef.current) {
        v.deviatedSpoken = true
        navVoice.speak(`Te has salido de la ruta. Estás a ${spokenDistance(minDist)}.`)
      }
    } else if (minDist < 30) {
      if (v.deviatedSpoken) navVoice.speak('De vuelta en la ruta.')
      v.deviatedFixes = 0
      v.deviatedSpoken = false
    }

    // Advance approach or track instructions
    if (isApproachingRef.current && approachInstructionsRef.current.length > 0) {
      const cur = approachInstrIdxRef.current
      // The maneuver at hand is spoken before moving past it: a fix that is already
      // within 25 m of it (where it counts as done) must still say it.
      announceInstruction(approachInstructionsRef.current, cur, lat, lng, 'a')
      const next = advanceInstructions(approachInstructionsRef.current, cur, lat, lng)
      approachInstrIdxRef.current = next
      setApproachInstrIdx(next)
      if (next !== cur) announceInstruction(approachInstructionsRef.current, next, lat, lng, 'a')
      // Auto-dismiss approach when within 30 m of track
      const nearIdx = globalNearestPointIdx(pts, lat, lng)
      if (haversineM(lat, lng, pts[nearIdx].lat, pts[nearIdx].lng) < 30) {
        setIsApproaching(false)
        isApproachingRef.current = false
        setApproachRoute(null)
        setApproachInstructions([])
        navVoice.speak('Has llegado a la ruta.')
      }
    } else if (instructionsRef.current.length > 0) {
      const cur = instrIdxRef.current
      if (minDist <= 50) announceInstruction(instructionsRef.current, cur, lat, lng, 't')
      const next = advanceInstructions(instructionsRef.current, cur, lat, lng)
      instrIdxRef.current = next
      setInstrIdx(next)
      if (next !== cur && minDist <= 50) announceInstruction(instructionsRef.current, next, lat, lng, 't')
    }

    // Distance milestones along the route
    const km = Math.floor(distTraveled / 1000)
    if (km > v.lastKm && remaining > 300) {
      v.lastKm = km
      navVoice.speak(`${capitalize(spokenDistance(km * 1000))} ${km === 1 ? 'recorrido' : 'recorridos'}. Quedan ${spokenDistance(remaining)}.`)
    }
    if (!v.near500 && total > 1500 && remaining <= 500 && distTraveled > total / 2) {
      v.near500 = true
      navVoice.speak('Quedan 500 metros para el final.')
    }
    if (!v.arrived && remaining < 40 && distTraveled > total * 0.9) {
      v.arrived = true
      navVoice.speak(`Has llegado al final de la ruta. ${capitalize(spokenDistance(total))} en ${spokenDuration(movingSeconds())}.`)
    }
  }

  // Browser position → route guidance (web, or the app before its native GPS answers).
  useEffect(() => {
    if (!geo.position || nativeFollowRef.current) return
    applyFollowFix(geo.position.lat, geo.position.lng, geo.position.speed)
  }, [geo.position]) // eslint-disable-line react-hooks/exhaustive-deps

  /** On the app: the native GPS guides along the route even with the screen off. */
  const startNativeFollow = () => {
    if (!nativeGeoService.isNative()) return
    nativeFollowRef.current = true
    void nativeGeoService.start(
      p => applyFollowFix(p.lat, p.lng, p.speed),
      () => { nativeFollowRef.current = false }, // fall back to the browser position
      { message: 'Trek Wanderer te está guiando por la ruta.' },
    )
  }

  // ── Recording ────────────────────────────────────────────────────────────────

  // Starts the recorder and its own GPS watch. Shared by plain recording and by
  // following a route while recording it (fase B: lo hecho queda grabado a la vez).
  const beginRecorder = (restore?: NavDraft) => {
    recorder.current.start(restore ? { points: restore.points, startTime: restore.startedAt } : undefined)
    elevGainRef.current = restore?.elevationGainM ?? 0
    elevLossRef.current = restore?.elevationLossM ?? 0
    lastAltRef.current = null
    lastMoveAtRef.current = Date.now()
    lastMovePosRef.current = null
    pauseStartRef.current = null
    autoPausedRef.current = false
    lastDraftAtRef.current = 0
    setIsPaused(false)
    setAutoPaused(false)
    setRecordedPoints([...recorder.current.points])
    setGeoRecordingError(null)
    setIsRecording(true)
    if (restore && navModeRef.current !== 'following') {
      voiceRef.current.lastKm = Math.floor(recorder.current.totalDistanceM() / 1000)
    }

    // Use native background GPS (Capacitor) or high-frequency web watchPosition
    stopRecordWatch()
    const handlePos = (gpos: NativeGeoPosition) => {
      // No navModeRef guard here — the watch is only active during recording and
      // recorder.current.running is false once stopRecording() is called, so
      // addPoint() will silently no-op any late-arriving callbacks.
      const { lat, lng, altitude, speed, timestamp, accuracy } = gpos
      const rec = recorder.current

      if (rec.isRunning && (accuracy ?? 0) <= 50) {
        const lm = lastMovePosRef.current
        const moved = !lm || haversineM(lm.lat, lm.lng, lat, lng) > MOVE_RADIUS_M || (speed ?? 0) > MOVING_SPEED_MS
        if (moved) {
          lastMovePosRef.current = { lat, lng }
          lastMoveAtRef.current = Date.now()
          if (rec.isPaused && autoPausedRef.current) doResume()
        }
      }

      if (!rec.isPaused) {
        rec.addPoint(lat, lng, altitude ?? null, speed, timestamp, accuracy)
        setRecordedPoints([...rec.points])

        const alt = altitude ?? null
        if (alt !== null && (accuracy ?? 0) <= 50) {
          if (lastAltRef.current !== null) {
            const diff = alt - lastAltRef.current
            if (diff > 2) elevGainRef.current += diff
            else if (diff < -2) elevLossRef.current += Math.abs(diff)
          }
          lastAltRef.current = alt
        }
        persistDraft()
      }

      // While following, progress along the route drives distance and speed.
      if (navModeRef.current === 'following') {
        setStats(s => ({ ...s, elevationGainM: elevGainRef.current, elevationLossM: elevLossRef.current }))
        if (nativeFollowRef.current) applyFollowFix(lat, lng, speed)
        return
      }
      if (rec.isPaused) return
      const distM = rec.totalDistanceM()
      const elapsed = movingSeconds()
      const avgKmh = elapsed > 60 ? (distM / 1000) / (elapsed / 3600) : 0
      setStats(s => ({
        ...s,
        distanceTraveledM: distM,
        currentSpeedKmh: speed !== null ? (speed ?? 0) * 3.6 : 0,
        avgSpeedKmh: avgKmh,
        elevationGainM: elevGainRef.current,
        elevationLossM: elevLossRef.current,
      }))
      const km = Math.floor(distM / 1000)
      const v = voiceRef.current
      if (km > v.lastKm) {
        v.lastKm = km
        navVoice.speak(`${capitalize(spokenDistance(km * 1000))}. Media de ${Math.round(avgKmh)} kilómetros por hora.`)
      }
    }

    // IMPORTANT: navigator.geolocation.watchPosition (the browser Geolocation
    // API used by the WebView) gets suspended by the WebView engine itself as
    // soon as the page isn't visible — screen off or app backgrounded — no
    // matter what Android permissions or foreground services exist, because
    // that suspension happens inside the WebView's renderer, not the OS
    // process scheduler. That's exactly why the recorded track and the live
    // position used to turn into straight lines while the phone was locked.
    //
    // On native Android we therefore rely EXCLUSIVELY on the
    // @capacitor-community/background-geolocation plugin, which runs its own
    // foreground service and talks to Android's location APIs directly,
    // independent of WebView visibility. The plain browser watch is only
    // used as a fallback in the web/PWA build, where no native plugin exists.
    if (nativeGeoService.isNative()) {
      nativeFollowRef.current = navModeRef.current === 'following'
      void nativeGeoService.start(handlePos, (err) => {
        nativeFollowRef.current = false
        setGeoRecordingError(`GPS en segundo plano no disponible: ${err}. Revisa que el permiso de ubicación esté en "Permitir todo el tiempo".`)
      })
    } else {
      recordWatchRef.current = navigator.geolocation.watchPosition(
        pos => handlePos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setGeoRecordingError('Permiso de ubicación denegado. Activa el GPS en ajustes.')
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            setGeoRecordingError('GPS no disponible. Sal al exterior para obtener señal.')
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      )
    }
  }

  /** Time already spent paused when a recovered recording carries on (the gap counts as a pause). */
  const restoredPausedMs = (d: NavDraft) => d.pausedMs + Math.max(0, Date.now() - d.updatedAt)

  const startRecording = useCallback((restore?: NavDraft) => {
    setStats(INITIAL_STATS)
    startTimeRef.current = restore ? restore.startedAt : Date.now()
    pausedMsRef.current = restore ? restoredPausedMs(restore) : 0
    voiceRef.current = freshVoiceState()
    startTimer()
    setNavMode('recording')
    navModeRef.current = 'recording'
    geo.setMode('follow')
    beginRecorder(restore)
    navVoice.speak(restore ? 'Grabación recuperada. Continúo grabando.' : 'Grabación iniciada.')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const finishPause = () => {
    if (pauseStartRef.current) pausedMsRef.current += Date.now() - pauseStartRef.current
    pauseStartRef.current = null
    setIsPaused(false)
    setAutoPaused(false)
  }

  const stopRecording = useCallback(() => {
    persistDraft(true) // kept until it is saved or discarded in the summary
    stopRecordWatch()
    finishPause()
    recorder.current.stop()
    setIsRecording(false)
    clearTimer()
    setStats(s => ({ ...s, elapsedSeconds: movingSeconds() }))
    setNavMode('idle')
    geo.setMode('off')
    const dist = recorder.current.totalDistanceM()
    navVoice.speak(`Grabación detenida. ${capitalize(spokenDistance(dist))} en ${spokenDuration(movingSeconds())}.`)
    return recorder.current
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTrackAndFollow = useCallback((pts: TrackPoint[], opts?: { record?: boolean; restore?: NavDraft }) => {
    setTrackPoints(pts)
    trackPointsRef.current = pts
    setProgressIdx(0)
    progressIdxRef.current = 0
    setIsDeviated(false)
    setApproachRoute(null)
    setApproachInstructions([])
    setIsApproaching(false)
    isApproachingRef.current = false
    const total = totalTrackM(pts)
    setStats({ ...INITIAL_STATS, distanceRemainingM: total })
    startTimeRef.current = opts?.restore ? opts.restore.startedAt : Date.now()
    pausedMsRef.current = opts?.restore ? restoredPausedMs(opts.restore) : 0
    voiceRef.current = freshVoiceState()
    startTimer()
    setNavMode('following')
    geo.setMode('follow')

    // Generate turn instructions from GPX geometry (no OSRM required)
    const instrs = generateTrackInstructions(pts)
    setInstructions(instrs)
    instructionsRef.current = instrs
    setInstrIdx(0)
    instrIdxRef.current = 0
    navModeRef.current = 'following'
    if (opts?.record || opts?.restore) beginRecorder(opts.restore)
    else startNativeFollow()
    navVoice.speak(opts?.restore
      ? 'Grabación recuperada. Sigo guiándote por la ruta.'
      : `Navegación iniciada. Ruta de ${spokenDistance(total)}.${opts?.record ? ' Grabando el recorrido.' : ''}`)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const navigateToTrack = useCallback(async (profile: 'cycling' | 'walking' | 'driving' = 'cycling') => {
    const pos = geo.position
    const pts = trackPointsRef.current
    if (!pos || pts.length === 0) return

    const nearestIdx = globalNearestPointIdx(pts, pos.lat, pos.lng)
    const nearest = pts[nearestIdx]

    try {
      const { coords, instructions: instrs } = await fetchApproachRoute(
        { lat: pos.lat, lng: pos.lng },
        { lat: nearest.lat, lng: nearest.lng },
        profile
      )
      setApproachRoute(coords)
      setApproachInstructions(instrs)
      approachInstructionsRef.current = instrs
      setApproachInstrIdx(0)
      approachInstrIdxRef.current = 0
      setIsApproaching(true)
      isApproachingRef.current = true
      navVoice.speak(`Te llevo hasta la ruta, a ${spokenDistance(haversineM(pos.lat, pos.lng, nearest.lat, nearest.lng))}.`)
    } catch {
      // approach is optional — user can still follow the track without it
    }
  }, [geo.position]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopFollowing = useCallback(() => {
    const wasRecording = recorder.current.isRunning
    if (wasRecording) persistDraft(true)
    stopRecordWatch()
    if (wasRecording) {
      finishPause()
      recorder.current.stop()
      // the summary shows what was really walked, not the progress along the plan
      setStats(s => ({ ...s, distanceTraveledM: recorder.current.totalDistanceM(), elapsedSeconds: movingSeconds() }))
    }
    setIsRecording(false)
    clearTimer()
    setNavMode('idle')
    geo.setMode('off')
    setInstructions([])
    setInstrIdx(0)
    setApproachRoute(null)
    setApproachInstructions([])
    setIsApproaching(false)
    navVoice.stop()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePause = useCallback(() => {
    if (recorder.current.isPaused) doResume()
    else doPause(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setVoiceMuted = useCallback((v: boolean) => {
    navVoice.setMuted(v)
    setVoiceMutedState(v)
    if (!v) navVoice.speak('Voz activada.')
  }, [])

  /** Picks up a recording recovered from the phone; with the route's points it keeps guiding along it. */
  const resumeDraft = useCallback((draft: NavDraft, routePoints?: TrackPoint[]) => {
    if (draft.following && routePoints && routePoints.length > 0) {
      loadTrackAndFollow(routePoints, { record: true, restore: draft })
    } else {
      startRecording(draft)
    }
  }, [loadTrackAndFollow, startRecording])

  /** Loads a recovered recording to show its summary (save it to the trip or download it). */
  const loadDraftForSummary = useCallback((draft: NavDraft) => {
    const rec = recorder.current
    rec.load(draft.points, draft.startedAt)
    const dist = rec.totalDistanceM()
    const last = draft.points[draft.points.length - 1]
    const moving = Math.max(0, ((last?.timestamp ?? draft.updatedAt) - draft.startedAt - draft.pausedMs) / 1000)
    setRecordedPoints([...draft.points])
    setStats({
      ...INITIAL_STATS,
      distanceTraveledM: dist,
      elapsedSeconds: moving,
      avgSpeedKmh: moving > 60 ? (dist / 1000) / (moving / 3600) : 0,
      elevationGainM: draft.elevationGainM,
      elevationLossM: draft.elevationLossM,
    })
  }, [])

  /** The recording was saved or thrown away: forget the copy kept on the phone. */
  const discardDraft = useCallback(() => { void clearNavDraft() }, [])

  const captureNavPhoto = useCallback(async (file: File, tripId: number | string): Promise<NavPhoto | null> => {
    // Use current GPS position; if not yet fixed, fall back to last recorded point
    const pos = geo.position
    const pts = recorder.current.points
    const lastPt = pts.length > 0 ? pts[pts.length - 1] : undefined
    const lat = pos?.lat ?? lastPt?.lat
    const lng = pos?.lng ?? lastPt?.lng
    const altitude = pos?.altitude ?? lastPt?.alt ?? null
    if (lat == null || lng == null) return null
    const form = new FormData()
    form.append('photo', file)
    form.append('lat', String(lat))
    form.append('lng', String(lng))
    if (altitude != null) form.append('altitude', String(altitude))
    form.append('taken_at', new Date().toISOString())
    try {
      const r = await fetch(`/api/trips/${tripId}/gpx/nav-photos`, { method: 'POST', body: form })
      if (!r.ok) return null
      const photo: NavPhoto = await r.json()
      setNavPhotos(prev => [...prev, photo])
      return photo
    } catch {
      return null
    }
  }, [geo.position]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearNavPhotos = useCallback(() => setNavPhotos([]), [])

  // Write the recording to the phone whenever the app goes to the background.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') persistDraft(true) }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Low battery while navigating or recording: warned once at 20 % and once at 10 %.
  useEffect(() => {
    if (navMode === 'idle') return
    type BatteryLike = EventTarget & { level: number; charging: boolean }
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery
    if (typeof getBattery !== 'function') return
    let battery: BatteryLike | null = null
    let cancelled = false
    const warned = new Set<number>()
    const check = () => {
      if (!battery) return
      if (battery.charging) { setBatteryWarning(null); return }
      for (const limit of [0.1, 0.2]) {
        if (battery.level <= limit && !warned.has(limit)) {
          warned.add(0.2)
          if (limit === 0.1) warned.add(0.1)
          const pct = Math.round(battery.level * 100)
          setBatteryWarning(limit === 0.1
            ? `Batería al ${pct} %. Activa el ahorro de batería o conecta el móvil: el GPS puede cortarse.`
            : `Batería al ${pct} %. La grabación sigue, pero vigila la batería.`)
          navVoice.speak(`Atención, batería al ${pct} por ciento.`)
          break
        }
      }
    }
    getBattery.call(navigator).then(b => {
      if (cancelled) return
      battery = b
      check()
      b.addEventListener('levelchange', check)
      b.addEventListener('chargingchange', check)
    }).catch(() => { /* not available */ })
    return () => {
      cancelled = true
      battery?.removeEventListener('levelchange', check)
      battery?.removeEventListener('chargingchange', check)
    }
  }, [navMode])

  useEffect(() => () => { clearTimer(); stopRecordWatch(); navVoice.stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currentInstruction = isApproaching
    ? (approachInstructions[approachInstrIdx] ?? null)
    : (instructions[instrIdx] ?? null)

  return {
    navMode,
    position: geo.position,
    geoError: geo.error,
    geoMode: geo.mode,

    recordedPoints,
    recorder: recorder.current,
    /** True while the recorder runs — in recording mode, or following a route with record on. */
    isRecording,
    isPaused,
    /** The pause was automatic (stopped for 2 min): it ends by itself when moving again. */
    autoPaused,
    batteryWarning,
    voiceMuted,

    trackPoints,
    progressIdx,
    isDeviated,
    progressPct: trackPoints.length > 0
      ? (distAlongTrack(trackPoints, 0, progressIdx) / totalTrackM(trackPoints)) * 100
      : 0,

    instructions,
    currentInstruction,
    instrIdx,
    distanceToTrackM,
    approachRoute,
    isApproaching,

    stats,
    navPhotos,
    geoRecordingError,

    startRecording,
    stopRecording,
    loadTrackAndFollow,
    stopFollowing,
    navigateToTrack,
    togglePause,
    setVoiceMuted,
    resumeDraft,
    loadDraftForSummary,
    discardDraft,
    captureNavPhoto,
    clearNavPhotos,
  }
}

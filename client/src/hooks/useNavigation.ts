import { useCallback, useEffect, useRef, useState } from 'react'
import { useGeolocation } from './useGeolocation'
import { GpxRecorderService, type RecordedPoint } from '../services/gpxRecorderService'
import {
  advanceInstructions,
  generateTrackInstructions,
  fetchApproachRoute,
  type TurnInstruction,
} from '../services/turnByTurnService'
import { nativeGeoService } from '../services/nativeGeoService'

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

export function useNavigation() {
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
  const approachInstructionsRef = useRef<TurnInstruction[]>([])
  approachInstructionsRef.current = approachInstructions
  const isApproachingRef = useRef(false)
  isApproachingRef.current = isApproaching
  const progressIdxRef = useRef(0)
  progressIdxRef.current = progressIdx
  const recordWatchRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const startTimer = () => {
    clearTimer()
    timerRef.current = setInterval(() => {
      if (!startTimeRef.current) return
      setStats(s => ({ ...s, elapsedSeconds: (Date.now() - startTimeRef.current!) / 1000 }))
    }, 1000)
  }

  const stopRecordWatch = () => {
    nativeGeoService.stop()
    if (recordWatchRef.current !== null) {
      navigator.geolocation.clearWatch(recordWatchRef.current)
      recordWatchRef.current = null
    }
  }

  // React to position updates in following mode only
  // (recording uses its own dedicated high-frequency watchPosition below)
  useEffect(() => {
    if (!geo.position) return
    const { lat, lng, speed } = geo.position

    if (navModeRef.current !== 'following') return
    const pts = trackPointsRef.current
    if (pts.length === 0) return

    // Compute all values first — calling setState inside a setState updater
    // violates React 18 and causes dropped renders (black screen).
    const newIdx = nearestPointIdx(pts, lat, lng, progressIdxRef.current)
    const minDist = minDistToTrackWindow(pts, lat, lng, newIdx)
    const distTraveled = distAlongTrack(pts, 0, newIdx)
    const total = totalTrackM(pts)
    const elapsed = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0
    const avgKmh = elapsed > 60 ? (distTraveled / 1000) / (elapsed / 3600) : 0

    setProgressIdx(newIdx)
    setIsDeviated(minDist > 50)
    setDistanceToTrackM(minDist)
    setStats(s => ({
      ...s,
      distanceTraveledM: distTraveled,
      distanceRemainingM: total - distTraveled,
      currentSpeedKmh: speed !== null ? (speed ?? 0) * 3.6 : 0,
      avgSpeedKmh: avgKmh,
    }))

    // Advance approach or track instructions
    if (isApproachingRef.current && approachInstructionsRef.current.length > 0) {
      setApproachInstrIdx(prev => advanceInstructions(approachInstructionsRef.current, prev, lat, lng))
      // Auto-dismiss approach when within 30 m of track
      const nearIdx = globalNearestPointIdx(pts, lat, lng)
      if (haversineM(lat, lng, pts[nearIdx].lat, pts[nearIdx].lng) < 30) {
        setIsApproaching(false)
        setApproachRoute(null)
        setApproachInstructions([])
      }
    } else if (instructionsRef.current.length > 0) {
      setInstrIdx(prev => advanceInstructions(instructionsRef.current, prev, lat, lng))
    }
  }, [geo.position]) // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(() => {
    recorder.current.start()
    elevGainRef.current = 0
    elevLossRef.current = 0
    lastAltRef.current = null
    setRecordedPoints([])
    setStats(INITIAL_STATS)
    startTimeRef.current = Date.now()
    startTimer()
    setNavMode('recording')
    geo.setMode('follow')

    // Use native background GPS (Capacitor) or high-frequency web watchPosition
    stopRecordWatch()
    const handlePos = (gpos: import('../services/nativeGeoService').NativeGeoPosition) => {
      if (navModeRef.current !== 'recording') return
      const { lat, lng, altitude, speed, timestamp } = gpos
      recorder.current.addPoint(lat, lng, altitude ?? null, speed, timestamp)
      setRecordedPoints([...recorder.current.points])

      const alt = altitude ?? null
      if (alt !== null) {
        if (lastAltRef.current !== null) {
          const diff = alt - lastAltRef.current
          if (diff > 2) elevGainRef.current += diff
          else if (diff < -2) elevLossRef.current += Math.abs(diff)
        }
        lastAltRef.current = alt
      }

      const distM = recorder.current.totalDistanceM()
      const elapsed = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0
      const avgKmh = elapsed > 60 ? (distM / 1000) / (elapsed / 3600) : 0
      setStats(s => ({
        ...s,
        distanceTraveledM: distM,
        currentSpeedKmh: speed !== null ? (speed ?? 0) * 3.6 : 0,
        avgSpeedKmh: avgKmh,
        elevationGainM: elevGainRef.current,
        elevationLossM: elevLossRef.current,
      }))
    }

    if (nativeGeoService.isNative()) {
      // Capacitor: background GPS via Android ForegroundService / iOS background location
      nativeGeoService.start(handlePos, () => { /* error shown by OS permission flow */ })
    } else {
      // Browser PWA: maximumAge:0 high-frequency watcher
      recordWatchRef.current = navigator.geolocation.watchPosition(
        pos => handlePos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }),
        () => { /* errors handled by useGeolocation */ },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      )
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback(() => {
    stopRecordWatch()
    recorder.current.stop()
    clearTimer()
    setNavMode('idle')
    geo.setMode('off')
    return recorder.current
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTrackAndFollow = useCallback((pts: TrackPoint[]) => {
    setTrackPoints(pts)
    setProgressIdx(0)
    setIsDeviated(false)
    setApproachRoute(null)
    setApproachInstructions([])
    setIsApproaching(false)
    setStats({ ...INITIAL_STATS, distanceRemainingM: totalTrackM(pts) })
    startTimeRef.current = Date.now()
    startTimer()
    setNavMode('following')
    geo.setMode('follow')

    // Generate turn instructions from GPX geometry (no OSRM required)
    const instrs = generateTrackInstructions(pts)
    setInstructions(instrs)
    setInstrIdx(0)
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
      setApproachInstrIdx(0)
      setIsApproaching(true)
    } catch {
      // approach is optional — user can still follow the track without it
    }
  }, [geo.position]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopFollowing = useCallback(() => {
    clearTimer()
    setNavMode('idle')
    geo.setMode('off')
    setInstructions([])
    setInstrIdx(0)
    setApproachRoute(null)
    setApproachInstructions([])
    setIsApproaching(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const captureNavPhoto = useCallback(async (file: File, tripId: number): Promise<NavPhoto | null> => {
    const pos = geo.position
    if (!pos) return null
    const form = new FormData()
    form.append('photo', file)
    form.append('lat', String(pos.lat))
    form.append('lng', String(pos.lng))
    if (pos.altitude != null) form.append('altitude', String(pos.altitude))
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

  useEffect(() => () => { clearTimer(); stopRecordWatch() }, [])

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

    startRecording,
    stopRecording,
    loadTrackAndFollow,
    stopFollowing,
    navigateToTrack,
    captureNavPhoto,
    clearNavPhotos,
  }
}

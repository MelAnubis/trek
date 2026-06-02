import { useCallback, useEffect, useRef, useState } from 'react'
import { useGeolocation } from './useGeolocation'
import { GpxRecorderService, type RecordedPoint } from '../services/gpxRecorderService'
import { fetchTurnByTurn, advanceInstructions, type TurnInstruction } from '../services/turnByTurnService'

export type NavMode = 'idle' | 'recording' | 'following'

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

/** Find the index of the nearest point in `pts`, searching a window around `hint`. */
function nearestPointIdx(pts: TrackPoint[], lat: number, lng: number, hint: number): number {
  const window = 80
  const start = Math.max(0, hint - 10)
  const end = Math.min(pts.length - 1, hint + window)
  let best = hint
  let bestD = Infinity
  for (let i = start; i <= end; i++) {
    const d = haversineM(lat, lng, pts[i].lat, pts[i].lng)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function minDistToTrackWindow(pts: TrackPoint[], lat: number, lng: number, idx: number): number {
  const window = 30
  const start = Math.max(0, idx - window)
  const end = Math.min(pts.length - 1, idx + window)
  let min = Infinity
  for (let i = start; i <= end; i++) {
    const d = haversineM(lat, lng, pts[i].lat, pts[i].lng)
    if (d < min) min = d
  }
  return min
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

  const startTimeRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAltRef = useRef<number | null>(null)
  const elevGainRef = useRef(0)
  const elevLossRef = useRef(0)
  const navModeRef = useRef<NavMode>('idle')
  navModeRef.current = navMode

  const clearTimer = () => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null }
  }

  // Timer for elapsed time
  const startTimer = () => {
    clearTimer()
    timerRef.current = setInterval(() => {
      if (!startTimeRef.current) return
      setStats(s => ({ ...s, elapsedSeconds: (Date.now() - startTimeRef.current!) / 1000 }))
    }, 1000)
  }

  // React to GPS position updates
  useEffect(() => {
    if (!geo.position) return
    const { lat, lng, speed, altitude, timestamp } = geo.position

    if (navModeRef.current === 'recording') {
      recorder.current.addPoint(lat, lng, altitude ?? null, speed, timestamp)
      const pts = [...recorder.current.points]
      setRecordedPoints(pts)

      // Elevation tracking with 2m hysteresis
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
    } else if (navModeRef.current === 'following') {
      setProgressIdx(prev => {
        const newIdx = nearestPointIdx(trackPoints, lat, lng, prev)
        // Deviation detection
        const minDist = minDistToTrackWindow(trackPoints, lat, lng, newIdx)
        setIsDeviated(minDist > 50)

        const distTraveled = distAlongTrack(trackPoints, 0, newIdx)
        const total = totalTrackM(trackPoints)
        const elapsed = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0
        const avgKmh = elapsed > 60 ? (distTraveled / 1000) / (elapsed / 3600) : 0
        setStats(s => ({
          ...s,
          distanceTraveledM: distTraveled,
          distanceRemainingM: total - distTraveled,
          currentSpeedKmh: speed !== null ? (speed ?? 0) * 3.6 : 0,
          avgSpeedKmh: avgKmh,
        }))

        return newIdx
      })

      // Advance turn instructions
      if (instructions.length > 0) {
        setInstrIdx(prev => advanceInstructions(instructions, prev, lat, lng))
      }
    }
  }, [geo.position]) // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(async () => {
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback(() => {
    recorder.current.stop()
    clearTimer()
    setNavMode('idle')
    geo.setMode('off')
    return recorder.current
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTrackAndFollow = useCallback(async (
    pts: TrackPoint[],
    waypoints?: Array<{ lat: number; lng: number }>,
    profile?: 'cycling' | 'walking' | 'driving'
  ) => {
    setTrackPoints(pts)
    setProgressIdx(0)
    setIsDeviated(false)
    setStats({ ...INITIAL_STATS, distanceRemainingM: totalTrackM(pts) })
    startTimeRef.current = Date.now()
    startTimer()
    setNavMode('following')
    geo.setMode('follow')

    // Optionally fetch turn-by-turn if waypoints provided
    if (waypoints && waypoints.length >= 2) {
      try {
        const instrs = await fetchTurnByTurn(waypoints, profile ?? 'cycling')
        setInstructions(instrs)
        setInstrIdx(0)
      } catch {
        // instructions are optional, fail silently
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopFollowing = useCallback(() => {
    clearTimer()
    setNavMode('idle')
    geo.setMode('off')
    setInstructions([])
    setInstrIdx(0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimer(), [])

  const currentInstruction = instructions[instrIdx] ?? null

  return {
    navMode,
    position: geo.position,
    geoError: geo.error,
    geoMode: geo.mode,

    // Recording
    recordedPoints,
    recorder: recorder.current,

    // Following
    trackPoints,
    progressIdx,
    isDeviated,
    progressPct: trackPoints.length > 0
      ? (distAlongTrack(trackPoints, 0, progressIdx) / totalTrackM(trackPoints)) * 100
      : 0,

    // Instructions
    instructions,
    currentInstruction,
    instrIdx,

    stats,

    startRecording,
    stopRecording,
    loadTrackAndFollow,
    stopFollowing,
  }
}

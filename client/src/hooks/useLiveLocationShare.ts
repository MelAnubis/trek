/**
 * useLiveLocationShare — arranca/para el compartir de ubicación en vivo.
 *
 * Envuelve nativeGeoService (que ya gestiona el foreground service en Android
 * vía @capacitor-community/background-geolocation) y manda los puntos al
 * backend a un ritmo limitado, para no saturar el servidor ni la batería.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { nativeGeoService, type NativeGeoPosition } from '../services/nativeGeoService'
import { liveLocationApi } from '../api/client'

// No mandes un punto nuevo si el anterior se envió hace menos de esto,
// aunque el GPS dispare eventos más seguido (el distanceFilter de
// nativeGeoService ya filtra por distancia; esto filtra por tiempo).
const MIN_SEND_INTERVAL_MS = 8_000

export function useLiveLocationShare() {
  const [sharing, setSharing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastSentAtRef = useRef(0)
  const tokenRef = useRef<string | null>(null)

  // On mount, check if there's already an active share (e.g. app was closed
  // and reopened while sharing was still on).
  useEffect(() => {
    liveLocationApi.mine()
      .then(res => {
        if (res.token) {
          tokenRef.current = res.token
          setToken(res.token)
          setSharing(true)
          // Resume feeding the GPS watcher into the existing share.
          nativeGeoService.start(handleLocation, handleError)
        }
      })
      .catch(() => { /* not fatal — just means we start from a clean state */ })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleError = useCallback((message: string) => {
    setError(message)
  }, [])

  const handleLocation = useCallback((pos: NativeGeoPosition) => {
    const shareToken = tokenRef.current
    if (!shareToken) return
    const now = Date.now()
    if (now - lastSentAtRef.current < MIN_SEND_INTERVAL_MS) return
    lastSentAtRef.current = now
    liveLocationApi.sendPoint(shareToken, {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      altitude: pos.altitude,
      speed: pos.speed,
      recorded_at: new Date(pos.timestamp).toISOString(),
    }).catch(() => { /* a dropped point isn't worth surfacing to the user */ })
  }, [])

  const start = useCallback(async (label?: string) => {
    setError(null)
    try {
      const res = await liveLocationApi.start(label)
      tokenRef.current = res.token
      setToken(res.token)
      setSharing(true)
      lastSentAtRef.current = 0
      await nativeGeoService.start(handleLocation, handleError)
    } catch {
      setError('No se pudo iniciar el compartir ubicación')
    }
  }, [handleLocation, handleError])

  const stop = useCallback(async () => {
    await nativeGeoService.stop()
    tokenRef.current = null
    setToken(null)
    setSharing(false)
    try { await liveLocationApi.stop() } catch { /* best effort */ }
  }, [])

  const shareUrl = token ? `${window.location.origin}/live/${token}` : null

  return { sharing, loading, token, shareUrl, error, start, stop }
}

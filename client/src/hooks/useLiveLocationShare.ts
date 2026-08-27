/**
 * useLiveLocationShare — arranca/para el compartir de ubicación en vivo.
 *
 * Usa la geolocalización estándar del navegador (no el plugin nativo de
 * grabación de rutas) porque esta app carga su JS en vivo desde el
 * servidor, y manda los puntos al backend a un ritmo limitado para no
 * saturar el servidor ni la batería.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { liveLocationApi } from '../api/client'

// No mandes un punto nuevo si el anterior se envió hace menos de esto,
// aunque el GPS dispare eventos más seguido.
const MIN_SEND_INTERVAL_MS = 8_000

// Geolocalización estándar del navegador — funciona en cualquier WebView,
// incluida esta app (que carga su JS en vivo desde el servidor, por lo que
// no puede usar el plugin nativo @capacitor-community/background-geolocation:
// ese plugin solo existe dentro del paquete nativo compilado, no en una
// página web servida por HTTP). A cambio, solo actualiza mientras la app
// esté abierta en primer o segundo plano — asumido y ya documentado en la UI.
let watchId: number | null = null
function startBrowserGeo(onLocation: (pos: { lat: number; lng: number; accuracy: number | null; altitude: number | null; speed: number | null; timestamp: number }) => void, onError: (message: string) => void) {
  if (watchId !== null) return
  if (!navigator.geolocation) { onError('Este navegador no soporta geolocalización'); return }
  watchId = navigator.geolocation.watchPosition(
    (pos) => onLocation({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      altitude: pos.coords.altitude ?? null,
      speed: pos.coords.speed ?? null,
      timestamp: pos.timestamp,
    }),
    (err) => onError(err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  )
}
function stopBrowserGeo() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null }
}

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
          startBrowserGeo(handleLocation, handleError)
        }
      })
      .catch(() => { /* not fatal — just means we start from a clean state */ })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleError = useCallback((message: string) => {
    setError(message)
  }, [])

  const handleLocation = useCallback((pos: { lat: number; lng: number; accuracy: number | null; altitude: number | null; speed: number | null; timestamp: number }) => {
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
      startBrowserGeo(handleLocation, handleError)
    } catch {
      setError('No se pudo iniciar el compartir ubicación')
    }
  }, [handleLocation, handleError])

  const stop = useCallback(async () => {
    stopBrowserGeo()
    tokenRef.current = null
    setToken(null)
    setSharing(false)
    try { await liveLocationApi.stop() } catch { /* best effort */ }
  }, [])

  const shareUrl = token ? `${window.location.origin}/live/${token}` : null

  return { sharing, loading, token, shareUrl, error, start, stop }
}

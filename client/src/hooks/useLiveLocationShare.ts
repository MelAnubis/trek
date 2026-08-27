/**
 * useLiveLocationShare — arranca/para el compartir de ubicación en vivo.
 *
 * Igual que la grabación de rutas (ver useNavigation.ts): usa la
 * geolocalización estándar del navegador para el primer plano, y además,
 * dentro de la app nativa (Capacitor), arranca en paralelo el plugin
 * @capacitor-community/background-geolocation para que el GPS siga activo
 * con la pantalla apagada o la app en segundo plano — el bridge nativo de
 * Capacitor (window.Capacitor) está disponible sin importar si la página
 * se sirve empaquetada o en vivo desde el servidor (server.url), así que
 * el plugin funciona igual en ambos casos.
 *
 * Sin esto, watchPosition del navegador se suspende en cuanto Android pone
 * la WebView en segundo plano; al volver a primer plano llega un único
 * punto muy alejado en el tiempo del anterior, y el mapa dibuja una línea
 * recta larga entre ambos en vez del recorrido real.
 *
 * Los puntos se filtran (mala precisión, jitter en parada, saltos
 * imposibles) antes de enviarse, y se limita el ritmo de envío para no
 * saturar el servidor ni la batería.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { liveLocationApi } from '../api/client'
import { nativeGeoService, type NativeGeoPosition } from '../services/nativeGeoService'

// No mandes un punto nuevo si el anterior se envió hace menos de esto,
// aunque el GPS dispare eventos más seguido.
const MIN_SEND_INTERVAL_MS = 8_000

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

let watchId: number | null = null
function startBrowserGeo(onLocation: (pos: NativeGeoPosition) => void, onError: (message: string) => void) {
  if (watchId !== null) return
  if (!navigator.geolocation) { onError('Este navegador no soporta geolocalización'); return }
  watchId = navigator.geolocation.watchPosition(
    (pos) => onLocation({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? 0,
      altitude: pos.coords.altitude,
      speed: pos.coords.speed,
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
  // Último punto aceptado (no necesariamente enviado) — para filtrar jitter y saltos de GPS.
  const lastAcceptedRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null)

  const handleError = useCallback((message: string) => {
    setError(message)
  }, [])

  const handleLocation = useCallback((pos: NativeGeoPosition) => {
    const shareToken = tokenRef.current
    if (!shareToken) return

    // Descarta fixes de mala precisión — es lo que hace que el trazo parezca "muy malo".
    if (pos.accuracy > 50) return

    const last = lastAcceptedRef.current
    if (last) {
      const dist = haversineM(last.lat, last.lng, pos.lat, pos.lng)
      const dt = (pos.timestamp - last.timestamp) / 1000
      // Ignora jitter en parada (< 3 m en menos de 4 s)
      if (dist < 3 && dt < 4) return
      // Descarta saltos imposibles (> 300 km/h) — típicos de un GPS "recuperando" señal
      // tras estar en segundo plano, que son los que dibujan la línea recta larga.
      if (dt > 0 && dist / dt > 85) return
    }
    lastAcceptedRef.current = { lat: pos.lat, lng: pos.lng, timestamp: pos.timestamp }

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

  const startAllGeo = useCallback(() => {
    startBrowserGeo(handleLocation, handleError)
    // En la app nativa, mantiene el GPS activo (foreground service) aunque
    // la pantalla se apague o la app pase a segundo plano.
    if (nativeGeoService.isNative()) {
      nativeGeoService.start(handleLocation, () => { /* plugin nativo opcional */ })
    }
  }, [handleLocation, handleError])

  const stopAllGeo = useCallback(() => {
    stopBrowserGeo()
    nativeGeoService.stop()
  }, [])

  // On mount, check if there's already an active share (e.g. app was closed
  // and reopened while sharing was still on).
  useEffect(() => {
    liveLocationApi.mine()
      .then(res => {
        if (res.token) {
          tokenRef.current = res.token
          setToken(res.token)
          setSharing(true)
          startAllGeo()
        }
      })
      .catch(() => { /* not fatal — just means we start from a clean state */ })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async (label?: string) => {
    setError(null)
    try {
      const res = await liveLocationApi.start(label)
      tokenRef.current = res.token
      setToken(res.token)
      setSharing(true)
      lastSentAtRef.current = 0
      lastAcceptedRef.current = null
      startAllGeo()
    } catch {
      setError('No se pudo iniciar el compartir ubicación')
    }
  }, [startAllGeo])

  const stop = useCallback(async () => {
    stopAllGeo()
    tokenRef.current = null
    setToken(null)
    setSharing(false)
    try { await liveLocationApi.stop() } catch { /* best effort */ }
  }, [stopAllGeo])

  const shareUrl = token ? `${window.location.origin}/live/${token}` : null

  return { sharing, loading, token, shareUrl, error, start, stop }
}

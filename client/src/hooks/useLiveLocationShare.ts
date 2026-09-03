/**
 * useLiveLocationShare — arranca/para el compartir de ubicación en vivo.
 *
 * Usa la misma fuente dual que "Navegar / Grabar ruta" (ver useNavigation.ts):
 * geolocalización estándar del navegador en paralelo con el plugin nativo
 * @capacitor-community/background-geolocation dentro de la app Android, para
 * que el GPS siga activo con la pantalla apagada o la app en segundo plano.
 *
 * A diferencia de grabar una ruta (que guarda cada punto aceptado
 * localmente, sin coste de red), aquí cada punto aceptado se manda al
 * servidor. Enviar "el primero que llegue" cada pocos segundos deja que un
 * fix malo de la fuente nativa (red/caché, con apenas movimiento) le gane la
 * carrera a uno bueno del navegador y se quede pisando la posición mostrada
 * — que es justo lo que hacía que el trazo pareciera "no moverse". En vez de
 * eso, cada punto aceptado actualiza solo la última posición conocida, y un
 * temporizador aparte manda periódicamente la más reciente: así siempre se
 * comparte el mejor dato disponible en cada momento, venga de donde venga.
 *
 * Los puntos se filtran (mala precisión, jitter en parada, saltos
 * imposibles) antes de aceptarse.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { liveLocationApi } from '../api/client'
import { nativeGeoService, type NativeGeoPosition } from '../services/nativeGeoService'

// Ritmo de envío al servidor — no tiene que ver con la frecuencia del GPS,
// solo con cada cuánto se manda la última posición conocida.
const SEND_INTERVAL_MS = 8_000

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
  const tokenRef = useRef<string | null>(null)
  // Último punto aceptado (filtrado) — referencia para detectar jitter y saltos.
  const lastAcceptedRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null)
  // Posición más reciente pendiente de enviar (o ya enviada, se reenvía como
  // "sigo aquí" mientras no llegue una mejor).
  const latestPositionRef = useRef<NativeGeoPosition | null>(null)
  const hasSentFirstRef = useRef(false)
  const sendTimerRef = useRef<number | null>(null)

  const handleError = useCallback((message: string) => {
    setError(message)
  }, [])

  const sendPosition = useCallback((pos: NativeGeoPosition) => {
    const shareToken = tokenRef.current
    if (!shareToken) return
    liveLocationApi.sendPoint(shareToken, {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      altitude: pos.altitude,
      speed: pos.speed,
      recorded_at: new Date(pos.timestamp).toISOString(),
    }).catch(() => { /* a dropped point isn't worth surfacing to the user */ })
  }, [])

  const handleLocation = useCallback((pos: NativeGeoPosition) => {
    if (!tokenRef.current) return

    // Descarta fixes de mala precisión.
    if (pos.accuracy > 50) return

    const last = lastAcceptedRef.current
    if (last) {
      const dist = haversineM(last.lat, last.lng, pos.lat, pos.lng)
      const dt = (pos.timestamp - last.timestamp) / 1000
      // Ignora jitter en parada (< 3 m en menos de 4 s)
      if (dist < 3 && dt < 4) return
      // Descarta saltos imposibles (> 300 km/h) — típicos de un fix de red
      // "recuperando" tras estar en segundo plano.
      if (dt > 0 && dist / dt > 85) return
    }
    lastAcceptedRef.current = { lat: pos.lat, lng: pos.lng, timestamp: pos.timestamp }
    latestPositionRef.current = pos

    // Send every accepted point immediately rather than only the first one.
    // The periodic timer below is a "still here" heartbeat for when no new
    // fix has arrived, but it's a JS setInterval — Android can throttle
    // those once the app is backgrounded/screen off — so genuinely new
    // positions must not depend on it firing on schedule.
    if (!hasSentFirstRef.current) hasSentFirstRef.current = true
    sendPosition(pos)
  }, [sendPosition])

  const startAllGeo = useCallback(() => {
    // Same reasoning as useNavigation's recording watch: on native Android,
    // navigator.geolocation.watchPosition gets suspended by the WebView
    // itself once the screen turns off or the app is backgrounded — that
    // suspension happens inside the WebView engine, so no permission or
    // foreground service fixes it. The background-geolocation plugin runs
    // its own foreground service against Android's location APIs directly
    // and keeps delivering fixes regardless of WebView visibility, so it's
    // the only source used natively. The browser watch remains the only
    // option in the web/PWA build.
    if (nativeGeoService.isNative()) {
      nativeGeoService.start(handleLocation, (err) => handleError(`GPS en segundo plano no disponible: ${err}`))
    } else {
      startBrowserGeo(handleLocation, handleError)
    }
    if (sendTimerRef.current === null) {
      sendTimerRef.current = window.setInterval(() => {
        if (latestPositionRef.current) sendPosition(latestPositionRef.current)
      }, SEND_INTERVAL_MS)
    }
  }, [handleLocation, handleError, sendPosition])

  const stopAllGeo = useCallback(() => {
    stopBrowserGeo()
    nativeGeoService.stop()
    if (sendTimerRef.current !== null) {
      clearInterval(sendTimerRef.current)
      sendTimerRef.current = null
    }
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
      lastAcceptedRef.current = null
      latestPositionRef.current = null
      hasSentFirstRef.current = false
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

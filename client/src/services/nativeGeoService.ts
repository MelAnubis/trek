/**
 * Abstraction layer over geolocation.
 *
 * - In Capacitor (native Android/iOS): uses @capacitor-community/background-geolocation
 *   which keeps GPS running even when the screen is off via a Foreground Service.
 * - In browser (PWA): falls back to the standard Web Geolocation API.
 *
 * The API surface is intentionally minimal — callers only need start/stop/onLocation.
 */

export interface NativeGeoPosition {
  lat: number
  lng: number
  altitude: number | null
  speed: number | null        // m/s
  accuracy: number
  timestamp: number
}

type LocationCallback = (pos: NativeGeoPosition) => void
type ErrorCallback = (err: string) => void

let _isCapacitor: boolean | null = null

function isCapacitor(): boolean {
  if (_isCapacitor !== null) return _isCapacitor
  // Capacitor injects window.Capacitor when running inside a native shell
  _isCapacitor = typeof window !== 'undefined' &&
    !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.()
  return _isCapacitor
}

// ── Native (Capacitor) path ───────────────────────────────────────────────────

let _bgGeoStarted = false
let _nativeCallbackId: string | null = null

async function startNative(onLocation: LocationCallback, onError: ErrorCallback): Promise<void> {
  if (_bgGeoStarted) return
  try {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')

    // Request permissions — prompts the user if needed
    const perm = await BackgroundGeolocation.checkPermissions()
    if (perm.location === 'denied') {
      const req = await BackgroundGeolocation.requestPermissions()
      if (req.location === 'denied') {
        onError('Permiso de ubicación denegado')
        return
      }
    }

    await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Trek Wanderer está grabando tu ruta.',
        backgroundTitle: 'Trek Wanderer — GPS activo',
        requestPermissions: true,
        stale: false,
        distanceFilter: 3,
      },
      (location, error) => {
        if (error) { onError(error.message); return }
        if (!location) return
        onLocation({
          lat: location.latitude,
          lng: location.longitude,
          altitude: location.altitude ?? null,
          speed: location.speed ?? null,
          accuracy: location.accuracy,
          timestamp: location.time ?? Date.now(),
        })
      }
    ).then(id => { _nativeCallbackId = id })

    _bgGeoStarted = true
  } catch (e) {
    onError(String(e))
  }
}

async function stopNative(): Promise<void> {
  if (!_bgGeoStarted) return
  try {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')
    if (_nativeCallbackId) {
      await BackgroundGeolocation.removeWatcher({ id: _nativeCallbackId })
      _nativeCallbackId = null
    }
  } catch { /* ignore */ }
  _bgGeoStarted = false
}

// ── Web (browser) path ────────────────────────────────────────────────────────

let _webWatchId: number | null = null

function startWeb(onLocation: LocationCallback, onError: ErrorCallback): void {
  if (_webWatchId !== null) return
  _webWatchId = navigator.geolocation.watchPosition(
    pos => onLocation({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      altitude: pos.coords.altitude,
      speed: pos.coords.speed,
      accuracy: pos.coords.accuracy,
      timestamp: pos.timestamp,
    }),
    err => onError(err.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  )
}

function stopWeb(): void {
  if (_webWatchId !== null) {
    navigator.geolocation.clearWatch(_webWatchId)
    _webWatchId = null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const nativeGeoService = {
  isNative: isCapacitor,

  async start(onLocation: LocationCallback, onError: ErrorCallback): Promise<void> {
    if (isCapacitor()) {
      await startNative(onLocation, onError)
    } else {
      startWeb(onLocation, onError)
    }
  },

  async stop(): Promise<void> {
    if (isCapacitor()) {
      await stopNative()
    } else {
      stopWeb()
    }
  },
}

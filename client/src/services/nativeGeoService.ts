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

/**
 * The background-geolocation plugin is native only (it ships no JavaScript): it is reached
 * through Capacitor's plugin bridge, not imported. The old `import('@capacitor-community/…')`
 * was marked external in the build, so inside the app it could never load.
 */
type BgLocation = { latitude: number; longitude: number; altitude: number | null; speed: number | null; accuracy: number; time: number | null }
type BgError = { message: string; code?: string }
interface BackgroundGeolocationPlugin {
  addWatcher(options: Record<string, unknown>, cb: (location?: BgLocation, error?: BgError) => void): Promise<string>
  removeWatcher(options: { id: string }): Promise<void>
  openSettings(): Promise<void>
}
let _bgPlugin: BackgroundGeolocationPlugin | null = null
async function backgroundGeolocation(): Promise<BackgroundGeolocationPlugin> {
  if (!_bgPlugin) {
    const { registerPlugin } = await import('@capacitor/core')
    _bgPlugin = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
  }
  return _bgPlugin
}
let _nativeCallbackId: string | null = null

async function startNative(onLocation: LocationCallback, onError: ErrorCallback): Promise<void> {
  if (_bgGeoStarted) return
  try {
    const BackgroundGeolocation = await backgroundGeolocation()

    // Permissions are asked by addWatcher itself (requestPermissions: true); a refusal
    // arrives in the callback as error.code === 'NOT_AUTHORIZED'.
    await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Trek Wanderer está grabando tu ruta.',
        backgroundTitle: 'Trek Wanderer — GPS activo',
        requestPermissions: true,
        stale: false,
        distanceFilter: 3,
      },
      (location, error) => {
        if (error) {
          onError(error.code === 'NOT_AUTHORIZED' ? 'Permiso de ubicación denegado' : error.message)
          return
        }
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
    const BackgroundGeolocation = await backgroundGeolocation()
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

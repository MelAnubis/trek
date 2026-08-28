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

// Local Android-only plugin (client/android/app/src/main/java/com/trek/wanderer/
// BackgroundLocationHelperPlugin.java) — not an npm package, so it's registered
// by name via @capacitor/core. Requests ACCESS_BACKGROUND_LOCATION and the
// battery-optimization exemption, neither of which
// @capacitor-community/background-geolocation asks for on its own.
interface BackgroundLocationHelperPlugin {
  checkBackgroundPermission(): Promise<{ granted: boolean }>
  requestBackgroundPermission(): Promise<{ granted: boolean }>
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<void>
}

let _hardeningRequested = false

async function requestBackgroundLocationHardening(): Promise<void> {
  if (_hardeningRequested) return
  _hardeningRequested = true
  try {
    const { registerPlugin } = await import('@capacitor/core')
    const helper = registerPlugin<BackgroundLocationHelperPlugin>('BackgroundLocationHelper')

    const bg = await helper.checkBackgroundPermission()
    if (!bg.granted) await helper.requestBackgroundPermission()

    const battery = await helper.isIgnoringBatteryOptimizations()
    if (!battery.ignoring) await helper.requestIgnoreBatteryOptimizations()
  } catch {
    // Best effort — an old APK without this native plugin, or a device that
    // rejects one of these prompts, shouldn't stop tracking from starting.
  }
}

let _bgGeoStarted = false
let _nativeCallbackId: string | null = null

async function startNative(onLocation: LocationCallback, onError: ErrorCallback): Promise<void> {
  if (_bgGeoStarted) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation') as any

    // Request permissions — prompts the user if needed
    const perm = await BackgroundGeolocation.checkPermissions()
    if (perm.location === 'denied') {
      const req = await BackgroundGeolocation.requestPermissions()
      if (req.location === 'denied') {
        onError('Permiso de ubicación denegado')
        return
      }
    }

    // @capacitor-community/background-geolocation only ever asks for
    // "while using the app" location. That alone doesn't guarantee GPS
    // keeps running with the screen off: Android also wants
    // ACCESS_BACKGROUND_LOCATION ("Allow all the time") and, on most OEM
    // builds, an exemption from battery optimization — otherwise the
    // foreground service gets killed the moment the screen locks, which is
    // exactly what shows up as "se corta al apagar la pantalla". Best
    // effort: prompt for both, but never block tracking if the user says no.
    await requestBackgroundLocationHardening()

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation') as any
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

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
// The watcher stays one and the same while it runs; who gets its fixes can change
// (following a route, then recording it too) without restarting the GPS.
let _onLocation: LocationCallback | null = null
let _onError: ErrorCallback | null = null
let _stopping: Promise<void> | null = null
/** Bumped on every start/stop, so a watcher that finishes registering late knows it is stale. */
let _gen = 0

export interface NativeStartOptions {
  /** Text of the persistent notification Android shows while the GPS runs. */
  message?: string
  title?: string
}

async function startNative(onLocation: LocationCallback, onError: ErrorCallback, opts: NativeStartOptions = {}): Promise<void> {
  _onLocation = onLocation
  _onError = onError
  if (_stopping) await _stopping
  if (_bgGeoStarted) return
  _bgGeoStarted = true
  const gen = ++_gen
  try {
    const BackgroundGeolocation = await backgroundGeolocation()

    // Permissions are asked by addWatcher itself (requestPermissions: true); a refusal
    // arrives in the callback as error.code === 'NOT_AUTHORIZED'.
    await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: opts.message ?? 'Trek Wanderer está grabando tu ruta.',
        backgroundTitle: opts.title ?? 'Trek Wanderer — GPS activo',
        requestPermissions: true,
        stale: false,
        distanceFilter: 3,
      },
      (location, error) => {
        if (error) {
          _onError?.(error.code === 'NOT_AUTHORIZED' ? 'Permiso de ubicación denegado' : error.message)
          return
        }
        if (!location) return
        _onLocation?.({
          lat: location.latitude,
          lng: location.longitude,
          altitude: location.altitude ?? null,
          speed: location.speed ?? null,
          accuracy: location.accuracy,
          timestamp: location.time ?? Date.now(),
        })
      }
    ).then(id => {
      // Stopped (or restarted) while the watcher was being added: remove it now.
      if (gen !== _gen) { void BackgroundGeolocation.removeWatcher({ id }).catch(() => {}); return }
      _nativeCallbackId = id
      // Only now: Android grants "Allow all the time" (ACCESS_BACKGROUND_LOCATION) only
      // after the "while using the app" permission that addWatcher has just asked for.
      // That one alone doesn't keep GPS alive with the screen off — Android also wants
      // the background permission and, on most OEM builds, a battery-optimization
      // exemption, or the foreground service is killed when the screen locks.
      // Best effort: never blocks tracking.
      void requestBackgroundLocationHardening()
    })
  } catch (e) {
    _bgGeoStarted = false
    onError(String(e))
  }
}

async function stopNative(): Promise<void> {
  _onLocation = null
  _onError = null
  if (!_bgGeoStarted) return
  _bgGeoStarted = false
  _gen++
  _stopping = (async () => {
    try {
      const BackgroundGeolocation = await backgroundGeolocation()
      if (_nativeCallbackId) {
        await BackgroundGeolocation.removeWatcher({ id: _nativeCallbackId })
        _nativeCallbackId = null
      }
    } catch { /* ignore */ }
  })()
  await _stopping
  _stopping = null
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

  async start(onLocation: LocationCallback, onError: ErrorCallback, opts?: NativeStartOptions): Promise<void> {
    if (isCapacitor()) {
      await startNative(onLocation, onError, opts)
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

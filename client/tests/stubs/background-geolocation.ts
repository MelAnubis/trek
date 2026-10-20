/**
 * Test stand-in for @capacitor-community/background-geolocation.
 *
 * The real package is native-only (Kotlin/Swift, no JS entry point), which is
 * why vite.config.js marks it external for the build. Vitest resolves imports
 * itself and fails on it, taking every test file that reaches
 * nativeGeoService (App, SettingsPage…) down with it. Nothing under test runs
 * inside Capacitor, so a no-op watcher is all it needs.
 */
export const BackgroundGeolocation = {
  addWatcher: async () => 'test-watcher',
  removeWatcher: async () => undefined,
  openSettings: async () => undefined,
}
export default { BackgroundGeolocation }

import type { CapacitorConfig } from '@capacitor/cli'

// ── CONFIGURE THIS ─────────────────────────────────────────────────────────
// Set TREK_SERVER_URL to the public URL of your Trek server (with https://).
// The Android WebView will load the app directly from this URL, so you never
// need to rebuild the APK when you deploy a new version to the server.
const TREK_SERVER_URL = process.env.TREK_SERVER_URL ?? ''
// ───────────────────────────────────────────────────────────────────────────

const config: CapacitorConfig = {
  appId: 'com.trek.wanderer',
  appName: 'Trek Wanderer',
  webDir: 'dist',
  ...(TREK_SERVER_URL ? {
    server: {
      url: TREK_SERVER_URL,
      cleartext: false,   // require HTTPS
    },
  } : {}),
  plugins: {
    BackgroundGeolocation: {
      notificationTitle: 'Trek Wanderer — Navegando',
      notificationText: 'Grabando ubicación en segundo plano',
      notificationIconColor: '#6366f1',
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
  },
}

export default config

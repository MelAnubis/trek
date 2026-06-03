import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.trek.wanderer',
  appName: 'Trek Wanderer',
  webDir: 'dist',
  // During development: point to your local server so you don't need to rebuild on every change.
  // Comment this out for production builds.
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:5173',
  //   cleartext: true,
  // },
  plugins: {
    BackgroundGeolocation: {
      // Android foreground service notification
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

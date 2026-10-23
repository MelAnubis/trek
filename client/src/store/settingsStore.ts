import { create } from 'zustand'
import { settingsApi } from '../api/client'
import type { Settings } from '../types'
import { getApiErrorMessage } from '../types'
import { SUPPORTED_LANGUAGE_CODES } from '../i18n/supportedLanguages'

interface SettingsState {
  settings: Settings
  isLoaded: boolean

  loadSettings: () => Promise<void>
  updateSetting: (key: keyof Settings, value: Settings[keyof Settings]) => Promise<void>
  setLanguageLocal: (lang: string) => void
  setLanguageTransient: (lang: string) => void
  updateSettings: (settingsObj: Partial<Settings>) => Promise<void>
}

// Returns true when the user has explicitly chosen a language (persisted in localStorage).
// Use this instead of reading localStorage directly so the key stays encapsulated here.
export const hasStoredLanguage = (): boolean =>
  typeof localStorage !== 'undefined' && !!localStorage.getItem('app_language')

// The last settings loaded from the server, so a start without a connection
// (the APK on a flaky network, the server restarting) keeps the user's map
// source and the rest instead of silently falling back to the defaults.
// Secrets stay out of it.
export const SETTINGS_SNAPSHOT_KEY = 'trek_settings'
const SECRET_SETTING_KEYS = new Set(['mapbox_access_token', 'webhook_url', 'ntfy_token'])

function readSettingsSnapshot(): Partial<Settings> {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_SNAPSHOT_KEY) || 'null')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

function writeSettingsSnapshot(settings: Settings): void {
  try {
    const safe = Object.fromEntries(Object.entries(settings).filter(([k]) => !SECRET_SETTING_KEYS.has(k)))
    localStorage.setItem(SETTINGS_SNAPSHOT_KEY, JSON.stringify(safe))
  } catch { /* private mode / quota: only the offline start is affected */ }
}

/** On logout, so the next person on a shared device doesn't inherit these. */
export function clearSettingsSnapshot(): void {
  try { localStorage.removeItem(SETTINGS_SNAPSHOT_KEY) } catch { /* non-fatal */ }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    map_tile_url: '',
    default_lat: 48.8566,
    default_lng: 2.3522,
    default_zoom: 10,
    dark_mode: false,
    default_currency: 'EUR',
    language: localStorage.getItem('app_language') || 'en',
    temperature_unit: 'celsius',
    time_format: '24h',
    show_place_description: false,
    map_provider: 'leaflet',
    map_poi_pill_enabled: true,
    mapbox_access_token: '',
    mapbox_style: 'mapbox://styles/mapbox/standard',
    mapbox_3d_enabled: true,
    mapbox_quality_mode: false,
    ...readSettingsSnapshot(),
    language: localStorage.getItem('app_language') || readSettingsSnapshot().language || 'en',
  },
  isLoaded: false,

  loadSettings: async () => {
    try {
      const data = await settingsApi.get()
      set((state) => ({
        settings: { ...state.settings, ...data.settings },
        isLoaded: true,
      }))
      writeSettingsSnapshot(get().settings)
    } catch (err: unknown) {
      set({ isLoaded: true })
      console.error('Failed to load settings:', err)
    }
  },

  updateSetting: async (key: keyof Settings, value: Settings[keyof Settings]) => {
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }))
    if (key === 'language') localStorage.setItem('app_language', value as string)
    if (get().isLoaded) writeSettingsSnapshot(get().settings)
    try {
      await settingsApi.set(key, value)
    } catch (err: unknown) {
      console.error('Failed to save setting:', err)
      throw new Error(getApiErrorMessage(err, 'Error saving setting'))
    }
  },

  setLanguageLocal: (lang: string) => {
    localStorage.setItem('app_language', lang)
    set((state) => ({ settings: { ...state.settings, language: lang } }))
  },

  // Applies a language for the current session without persisting to localStorage.
  // Used for automatic detection (browser/server default) — only explicit user
  // choices via the UI should be persisted.
  setLanguageTransient: (lang: string) => {
    if (!SUPPORTED_LANGUAGE_CODES.includes(lang)) return
    set((state) => ({ settings: { ...state.settings, language: lang } }))
  },

  updateSettings: async (settingsObj: Partial<Settings>) => {
    set((state) => ({
      settings: { ...state.settings, ...settingsObj },
    }))
    if (get().isLoaded) writeSettingsSnapshot(get().settings)
    try {
      await settingsApi.setBulk(settingsObj)
    } catch (err: unknown) {
      console.error('Failed to save settings:', err)
      throw new Error(getApiErrorMessage(err, 'Error saving settings'))
    }
  },
}))

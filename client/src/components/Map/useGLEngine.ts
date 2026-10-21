import { useMemo } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { resolveGLEngine } from './glEngine'

/**
 * The GL engine the user's settings ask for, or null for Leaflet.
 *
 * Primitive selectors + useMemo on purpose: a zustand selector returning a
 * fresh object every call makes useSyncExternalStore re-render forever.
 */
export function useGLEngine() {
  const map_provider = useSettingsStore(s => s.settings.map_provider)
  const mapbox_access_token = useSettingsStore(s => s.settings.mapbox_access_token)
  const mapbox_style = useSettingsStore(s => s.settings.mapbox_style)
  const maplibre_style = useSettingsStore(s => s.settings.maplibre_style)
  return useMemo(
    () => resolveGLEngine({ map_provider, mapbox_access_token, mapbox_style, maplibre_style }),
    [map_provider, mapbox_access_token, mapbox_style, maplibre_style],
  )
}

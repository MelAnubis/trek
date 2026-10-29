import { useEffect, useState } from 'react'
import { journeyApi } from '../../api/client'

export interface PhotoProvider { id: string; name: string }

/**
 * The photo providers this user has connected (Immich, Synology Photos and
 * other addon providers, plus OneDrive) — shared by the journey gallery and
 * the Studio (5.7.2). Each check has its own try/catch so one failing request
 * cannot wipe out the others, and the list is checked again when the tab
 * regains focus, so a provider connected in another tab shows up without a reload.
 */
export function usePhotoProviders(): PhotoProvider[] {
  const [providers, setProviders] = useState<PhotoProvider[]>([])
  useEffect(() => {
    let cancelled = false
    const checkProviders = async () => {
      const connected: PhotoProvider[] = []
      try {
        const addonsRes = await fetch('/api/addons', { credentials: 'include' })
        if (addonsRes.ok) {
          const addonsData = await addonsRes.json()
          const enabledProviders = (addonsData.addons || []).filter(
            (a: { type?: string; enabled?: boolean }) => a.type === 'photo_provider' && a.enabled,
          ) as { id: string; name: string }[]
          for (const p of enabledProviders) {
            try {
              const res = await fetch(`/api/integrations/memories/${p.id}/status`, { credentials: 'include' })
              if (res.ok) {
                const status = await res.json()
                if (status.connected) connected.push({ id: p.id, name: p.name })
              }
            } catch { /* this provider is unreachable; the others still count */ }
          }
        }
      } catch { /* addons list unavailable */ }
      // OneDrive separately (OAuth provider, not addon-driven)
      try {
        const odRes = await fetch('/api/integrations/memories/onedrive/status', { credentials: 'include' })
        if (odRes.ok) {
          const odStatus = await odRes.json()
          if (odStatus.connected) connected.push({ id: 'onedrive', name: 'OneDrive Photos' })
        }
      } catch { /* OneDrive status unavailable */ }
      if (!cancelled) setProviders(connected)
    }
    void checkProviders()
    const onFocus = () => { void checkProviders() }
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [])
  return providers
}

/**
 * Adds what the provider picker chose: to an entry when one was picked, to
 * the journey's gallery otherwise. Returns how many were added and the
 * gallery ids of the new photos (for the Studio's "just added" view).
 */
export async function addProviderGroups(
  journeyId: number,
  provider: string,
  groups: Array<{ assetIds: string[]; passphrase?: string }>,
  entryId: number | null,
): Promise<{ added: number; photoIds: number[] }> {
  let added = 0
  const photoIds: number[] = []
  for (const group of groups) {
    try {
      const result = entryId
        ? await journeyApi.addProviderPhotos(entryId, provider, group.assetIds, undefined, group.passphrase)
        : await journeyApi.addProviderPhotosToGallery(journeyId, provider, group.assetIds, group.passphrase)
      added += result.added || 0
      for (const p of (result.photos || []) as Array<{ photo_id?: number; id?: number }>) {
        const id = p.photo_id ?? p.id
        if (typeof id === 'number') photoIds.push(id)
      }
    } catch { /* one group failing (expired share, offline provider) leaves the rest */ }
  }
  return { added, photoIds }
}

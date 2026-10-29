import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useJourneyStore } from '../../store/journeyStore'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'
import { ProviderPicker } from '../Journey/ProviderPicker'
import { addProviderGroups, usePhotoProviders } from '../Journey/usePhotoProviders'

/**
 * Photos from Immich, Synology Photos (and any other connected provider)
 * straight from the Studio (5.7.2): the journey's own provider picker, the
 * chosen photos added to the journey's gallery (or to an entry), the journey
 * reloaded so they show in the Photos panel, and their ids handed back so the
 * panel can show just those.
 */
export function StudioProviderPhotos({ journeyId, onAdded }: { journeyId: number; onAdded: (photoIds: number[]) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const providers = usePhotoProviders()
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null)
  const current = useJourneyStore(s => s.current)
  const userId = useAuthStore(s => s.user?.id ?? 0)
  if (!providers.length || !Number.isFinite(journeyId)) return null

  const entries = (current?.entries || []).filter(e => e.type !== 'skeleton' || e.title)
  const existingAssetIds = new Set((current?.gallery || []).filter(p => p.asset_id).map(p => p.asset_id!))

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }} data-testid="studio-providers">
        {providers.map(p => (
          <button key={p.id} type="button" data-testid={`studio-provider-${p.id}`} onClick={() => setPicking(p)}
            style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 8px', fontSize: 10.5, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit' }}>
            <Cloud size={12} aria-hidden style={{ flexShrink: 0 }} />
            {t('journey.studio.photo.fromProvider', { provider: providerLabel(p) })}
          </button>
        ))}
      </div>
      {picking && (
        <ProviderPicker
          provider={picking.id}
          userId={userId}
          entries={entries}
          trips={current?.trips || []}
          existingAssetIds={existingAssetIds}
          onClose={() => setPicking(null)}
          onAdd={async (groups, entryId) => {
            const provider = picking
            const { added, photoIds } = await addProviderGroups(journeyId, provider.id, groups, entryId)
            setPicking(null)
            if (added > 0) {
              await useJourneyStore.getState().loadJourney(journeyId)
              toast.success(t('journey.studio.photo.addedFromProvider', { count: added, provider: providerLabel(provider) }))
              onAdded(photoIds)
            }
          }}
        />
      )}
    </>
  )
}

function providerLabel(p: { id: string; name: string }): string {
  if (p.id === 'immich') return 'Immich'
  if (p.id === 'synologyphotos') return 'Synology'
  if (p.id === 'onedrive') return 'OneDrive'
  return p.name
}

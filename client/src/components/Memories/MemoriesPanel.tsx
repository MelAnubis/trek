import { useState, useEffect, useCallback } from 'react'
import apiClient, { addonsApi } from '../../api/client'
import { Camera, Plus, Share2, EyeOff, Eye, X, Check, Search, ArrowUpDown, MapPin, Filter, Link2, RefreshCw, Unlink, FolderOpen, Info, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useTranslation } from '../../i18n'
import { fetchImageAsBlob, clearImageQueue } from '../../api/authUrl'
import { useToast } from '../shared/Toast'

interface PhotoProvider {
  id: string
  name: string
  icon?: string
  config?: Record<string, unknown>
}

function ProviderImg({ baseUrl, provider, style, loading }: { baseUrl: string; provider: string; style?: React.CSSProperties; loading?: 'lazy' | 'eager' }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let revoke = ''
    fetchImageAsBlob('/api' + baseUrl).then(blobUrl => {
      revoke = blobUrl
      setSrc(blobUrl)
    })
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [baseUrl])
  return src ? <img src={src} alt="" loading={loading} style={style} /> : null
}


// ── Types ───────────────────────────────────────────────────────────────────

interface TripPhoto {
  photo_id: number
  asset_id: string
  provider: string
  user_id: number
  username: string
  shared: number
  added_at: string
  city?: string | null
}

interface Asset {
  id: string
  provider: string
  takenAt: string
  city: string | null
  country: string | null
}

interface MemoriesPanelProps {
  tripId: number | string
  startDate: string | null
  endDate: string | null
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function MemoriesPanel({ tripId, startDate, endDate }: MemoriesPanelProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const currentUser = useAuthStore(s => s.user)

  const [connected, setConnected] = useState(false)
  const [enabledProviders, setEnabledProviders] = useState<PhotoProvider[]>([])
  const [availableProviders, setAvailableProviders] = useState<PhotoProvider[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [loading, setLoading] = useState(true)

  // Trip photos (saved selections)
  const [tripPhotos, setTripPhotos] = useState<TripPhoto[]>([])

  // Photo picker
  const [showPicker, setShowPicker] = useState(false)
  const [pickerPhotos, setPickerPhotos] = useState<Asset[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Confirm share popup
  const [showConfirmShare, setShowConfirmShare] = useState(false)

  // Filters & sort
  const [sortAsc, setSortAsc] = useState(true)
  const [locationFilter, setLocationFilter] = useState('')

  // Album linking
  const [showAlbumPicker, setShowAlbumPicker] = useState(false)
  const [albums, setAlbums] = useState<{ id: string; albumName: string; assetCount: number; passphrase?: string }[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [albumLinks, setAlbumLinks] = useState<{ id: number; provider: string; album_id: string; album_name: string; user_id: number; username: string; sync_enabled: number; last_synced_at: string | null }[]>([])
  const [syncing, setSyncing] = useState<number | null>(null)


  //helpers for building urls
  const ADDON_PREFIX = "/integrations/memories"
  
  function buildUnifiedUrl(endpoint: string, lastParam?:string,): string {
    return `${ADDON_PREFIX}/unified/trips/${tripId}/${endpoint}${lastParam ? `/${lastParam}` : ''}`;
  }

  function buildProviderUrl(provider: string, endpoint: string, item?: string): string {
    if (endpoint === 'album-link-sync') {
      endpoint = `trips/${tripId}/album-links/${item?.toString() || ''}/sync`
    }
    return `${ADDON_PREFIX}/${provider}/${endpoint}`;
  }

  function buildProviderAssetUrl(photo: TripPhoto, what: string): string {
    return `/photos/${photo.photo_id}/${what}`
  }

  function buildProviderAssetUrlFromAsset(asset: Asset, what: string, userId: number): string {
    // Picker photos are not yet saved — use provider-specific URL
    return `${ADDON_PREFIX}/${asset.provider}/assets/${tripId}/${asset.id}/${userId}/${what}`
  }


  const loadAlbumLinks = async () => {
    try {
      const res = await apiClient.get(buildUnifiedUrl('album-links'))
      setAlbumLinks(res.data.links || [])
    } catch { setAlbumLinks([]) }
  }

  const loadAlbums = async (provider: string = selectedProvider) => {
    if (!provider) return
    setAlbumsLoading(true)
    try {
      const res = await apiClient.get(buildProviderUrl(provider, 'albums'))
      setAlbums(res.data.albums || [])
    } catch {
      setAlbums([])
      toast.error(t('memories.error.loadAlbums'))
    } finally {
      setAlbumsLoading(false)
    }
  }

  const openAlbumPicker = async () => {
    setShowAlbumPicker(true)
    await loadAlbums(selectedProvider)
  }

  const linkAlbum = async (albumId: string, albumName: string, passphrase?: string) => {
    if (!selectedProvider) {
      toast.error(t('memories.error.linkAlbum'))
      return
    }

    try {
      await apiClient.post(buildUnifiedUrl('album-links'), {
        album_id: albumId,
        album_name: albumName,
        provider: selectedProvider,
        ...(passphrase ? { passphrase } : {}),
      })
      setShowAlbumPicker(false)
      await loadAlbumLinks()
      // Auto-sync after linking
      const linksRes = await apiClient.get(buildUnifiedUrl('album-links'))
      const newLink = (linksRes.data.links || []).find((l: any) => l.album_id === albumId && l.provider === selectedProvider)
      if (newLink) await syncAlbum(newLink.id)
    } catch { toast.error(t('memories.error.linkAlbum')) }
  }

  const unlinkAlbum = async (linkId: number) => {
    try {
      await apiClient.delete(buildUnifiedUrl('album-links', linkId.toString()))
      await loadAlbumLinks()
      await loadPhotos()
    } catch { toast.error(t('memories.error.unlinkAlbum')) }
  }

  const syncAlbum = async (linkId: number, provider?: string) => {
    const targetProvider = provider || selectedProvider
    if (!targetProvider) return
    setSyncing(linkId)
    try {
      await apiClient.post(buildProviderUrl(targetProvider, 'album-link-sync', linkId.toString()))
      await loadAlbumLinks()
      await loadPhotos()
    } catch { toast.error(t('memories.error.syncAlbum')) }
    finally { setSyncing(null) }
  }

  // Lightbox
  const [lightboxId, setLightboxId] = useState<number | null>(null)
  const [lightboxUserId, setLightboxUserId] = useState<number | null>(null)
  const [lightboxInfo, setLightboxInfo] = useState<any>(null)
  const [lightboxInfoLoading, setLightboxInfoLoading] = useState(false)
  const [lightboxOriginalSrc, setLightboxOriginalSrc] = useState('')
  const [showMobileInfo, setShowMobileInfo] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadInitial()
  }, [tripId])

  // WebSocket: reload photos when another user adds/removes/shares
  useEffect(() => {
    const handler = () => loadPhotos()
    window.addEventListener('memories:updated', handler)
    return () => window.removeEventListener('memories:updated', handler)
  }, [tripId])

  const loadPhotos = async () => {
    try {
      const photosRes = await apiClient.get(buildUnifiedUrl('photos'))
      setTripPhotos(photosRes.data.photos || [])
    } catch {
      setTripPhotos([])
    }
  }

  const loadInitial = async () => {
    setLoading(true)
    try {
      const addonsRes = await addonsApi.enabled().catch(() => ({ addons: [] as any[] }))
      const enabledAddons = addonsRes?.addons || []
      const photoProviders = enabledAddons.filter((a: any) => a.type === 'photo_provider' && a.enabled)

      setEnabledProviders(photoProviders.map((a: any) => ({ id: a.id, name: a.name, icon: a.icon, config: a.config })))

      // Test connection status for each enabled provider
      const statusResults = await Promise.all(
        photoProviders.map(async (provider: any) => {
          const statusUrl = (provider.config as Record<string, unknown>)?.status_get as string
          if (!statusUrl) return { provider, connected: false }
          try {
            const res = await apiClient.get(statusUrl)
            return { provider, connected: !!res.data?.connected }
          } catch {
            return { provider, connected: false }
          }
        })
      )

      const connectedProviders = statusResults
        .filter(r => r.connected)
        .map(r => ({ id: r.provider.id, name: r.provider.name, icon: r.provider.icon, config: r.provider.config }))

      // Check OneDrive separately (OAuth provider, not in photo_providers table)
      try {
        const odRes = await fetch('/api/integrations/memories/onedrive/status', { credentials: 'include' })
        const odData = await odRes.json()
        if (odData?.connected) {
          connectedProviders.push({ id: 'onedrive', name: 'OneDrive Photos', icon: 'Cloud', config: {} })
        }
      } catch { /* OneDrive not available */ }

      setAvailableProviders(connectedProviders)
      setConnected(connectedProviders.length > 0)
      if (connectedProviders.length > 0 && !selectedProvider) {
        setSelectedProvider(connectedProviders[0].id)
      }
    } catch {
      setAvailableProviders([])
      setConnected(false)
    }
    await loadPhotos()
    await loadAlbumLinks()
    setLoading(false)
  }

  // ── Photo Picker ──────────────────────────────────────────────────────────

  const [pickerDateFilter, setPickerDateFilter] = useState(true)

  const openPicker = async () => {
    setShowPicker(true)
    setPickerLoading(true)
    setSelectedIds(new Set())
    setPickerDateFilter(!!(startDate && endDate))
    await loadPickerPhotos(!!(startDate && endDate))
  }

  useEffect(() => {
    if (showPicker) {
      loadPickerPhotos(pickerDateFilter)
    }
  }, [selectedProvider])

  useEffect(() => {
    loadAlbumLinks()
  }, [tripId])

  useEffect(() => {
    if (showAlbumPicker) {
      loadAlbums(selectedProvider)
    }
  }, [showAlbumPicker, selectedProvider, tripId])

  const loadPickerPhotos = async (useDate: boolean) => {
    setPickerLoading(true)
    try {
      const provider = availableProviders.find(p => p.id === selectedProvider)
      if (!provider) {
        setPickerPhotos([])
        return
      }
      const res = await apiClient.post(buildProviderUrl(provider.id, 'search'), {
        from: useDate && startDate ? startDate : undefined,
        to: useDate && endDate ? endDate : undefined,
      })
      setPickerPhotos((res.data.assets || []).map((asset: Asset) => ({ ...asset, provider: provider.id })))
    } catch {
      setPickerPhotos([])
      toast.error(t('memories.error.loadPhotos'))
    } finally {
      setPickerLoading(false)
    }
  }

  const togglePickerSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmSelection = () => {
    if (selectedIds.size === 0) return
    setShowConfirmShare(true)
  }

  const executeAddPhotos = async () => {
    setShowConfirmShare(false)
    try {
      const groupedByProvider = new Map<string, string[]>()
      for (const key of selectedIds) {
        const [provider, assetId] = key.split('::')
        if (!provider || !assetId) continue
        const list = groupedByProvider.get(provider) || []
        list.push(assetId)
        groupedByProvider.set(provider, list)
      }

      await apiClient.post(buildUnifiedUrl('photos'), {
        selections: [...groupedByProvider.entries()].map(([provider, asset_ids]) => ({ provider, asset_ids })),
        shared: true,
      })
      setShowPicker(false)
      clearImageQueue()
      loadInitial()
    } catch { toast.error(t('memories.error.addPhotos')) }
  }

  // ── Remove photo ──────────────────────────────────────────────────────────

  const removePhoto = async (photo: TripPhoto) => {
    try {
      await apiClient.delete(buildUnifiedUrl('photos'), {
        data: {
          photo_id: photo.photo_id,
        },
      })
      setTripPhotos(prev => prev.filter(p => p.photo_id !== photo.photo_id))
    } catch { toast.error(t('memories.error.removePhoto')) }
  }

  // ── Toggle sharing ────────────────────────────────────────────────────────

  const toggleSharing = async (photo: TripPhoto, shared: boolean) => {
    try {
      await apiClient.put(buildUnifiedUrl('photos', 'sharing'), {
        shared,
        photo_id: photo.photo_id,
      })
      setTripPhotos(prev => prev.map(p =>
        p.photo_id === photo.photo_id ? { ...p, shared: shared ? 1 : 0 } : p
      ))
    } catch { toast.error(t('memories.error.toggleSharing')) }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  

  const makePickerKey = (provider: string, assetId: string): string => `${provider}::${assetId}`

  const ownPhotos = tripPhotos.filter(p => p.user_id === currentUser?.id)
  const othersPhotos = tripPhotos.filter(p => p.user_id !== currentUser?.id && p.shared)
  const allVisibleRaw = [...ownPhotos, ...othersPhotos]

  // Unique locations for filter
  const locations = [...new Set(allVisibleRaw.map(p => p.city).filter(Boolean) as string[])].sort()

  // Apply filter + sort
  const allVisible = allVisibleRaw
    .filter(p => !locationFilter || p.city === locationFilter)
    .sort((a, b) => {
      const da = new Date(a.added_at || 0).getTime()
      const db = new Date(b.added_at || 0).getTime()
      return sortAsc ? da - db : db - da
    })

  const font: React.CSSProperties = {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', ...font }}>
        <div className="w-8 h-8 border-2 rounded-full animate-spin ![border-color:var(--border-primary)] ![border-top-color:var(--text-primary)]" />
      </div>
    )
  }

  // ── Not connected ─────────────────────────────────────────────────────────

  if (!connected && allVisible.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40, textAlign: 'center', ...font }}>
        <Camera size={40} style={{ color: 'var(--text-faint)', marginBottom: 12 }} />
        <h3 className="!m-[0_0_6px] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">
          {t('memories.notConnected', { provider_name: enabledProviders.length === 1 ? enabledProviders[0]?.name : 'Photo provider' })}
        </h3>
        <p className="!m-[0] !text-[length:13px] ![color:var(--text-muted)] !max-w-[300px]">
          {enabledProviders.length === 1 ? t('memories.notConnectedHint', { provider_name: enabledProviders[0]?.name }) : t('memories.notConnectedMultipleHint', { provider_names: enabledProviders.map(p => p.name).join(', ') })}
        </p>
      </div>
    )
  }

  // ── Photo Picker Modal ────────────────────────────────────────────────────

  const ProviderTabs = () => {
    if (availableProviders.length < 2) return null
    return (
      <div className="!flex !gap-[6px] !mt-[8px]">
        {availableProviders.map(provider => (
          <button className={['!p-[6px_12px] !rounded-[99px] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit] ![transition:all_0.15s] !capitalize', (selectedProvider === provider.id) ? '![background:var(--text-primary)]' : '![background:var(--bg-card)]', (selectedProvider === provider.id) ? '[&&]:![border-color:var(--text-primary)]' : '[&&]:![border-color:var(--border-primary)]', (selectedProvider === provider.id) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '![border:1px_solid]'].join(' ')}
            key={provider.id}
            onClick={() => setSelectedProvider(provider.id)}
          >
            {provider.name}
          </button>
        ))}
      </div>
    )
  }

  // ── Album Picker Modal ──────────────────────────────────────────────────

  if (showAlbumPicker) {
    const linkedIds = new Set(albumLinks.map(l => l.album_id))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...font }}>
        <div className="!p-[14px_20px] ![border-bottom:1px_solid_var(--border-secondary)]">
          <div className="!flex !items-center !justify-between">
            <h3 className="!m-[0] !text-[length:15px] !font-[700] ![color:var(--text-primary)]">
              {availableProviders.length > 1 ? t('memories.selectAlbumMultiple') : t('memories.selectAlbum', { provider_name: availableProviders.find(p => p.id === selectedProvider)?.name || 'Photo provider' })}
            </h3>
            <button className="!p-[7px_14px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setShowAlbumPicker(false)}>
              {t('common.cancel')}
            </button>
          </div>
          <ProviderTabs />
        </div>
        <div className="!flex-[1] !overflow-y-auto !p-[12px]">
          {albumsLoading ? (
            <div className="!text-center !p-[40px]">
              <div className="!w-[24px] !h-[24px] ![border:2px_solid_var(--border-primary)] [&&]:![border-top-color:var(--text-primary)] !rounded-[50%] !m-[0_auto]" style={{ animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : albums.length === 0 ? (
            <p className="!text-center !p-[40px] !text-[length:13px] ![color:var(--text-faint)]">
              {t('memories.noAlbums')}
            </p>
          ) : (
            <div className="!flex !flex-col !gap-[4px]">
              {albums.map(album => {
                const isLinked = linkedIds.has(album.id)
                return (
                  <button className={[(!isLinked) ? 'trek-hover' : undefined, '!flex !items-center !gap-[12px] !w-[100%] !p-[12px_14px] !rounded-[10px] ![border:none] ![font-family:inherit] !text-left'].join(' ')} key={album.id} onClick={() => !isLinked && linkAlbum(album.id, album.albumName, album.passphrase)}
                    disabled={isLinked}
                    style={{ cursor: isLinked ? 'default' : 'pointer', background: isLinked ? 'var(--bg-tertiary)' : 'transparent', opacity: isLinked ? 0.5 : 1 }} >
                    <FolderOpen size={20} color="var(--text-muted)" />
                    <div className="!flex-[1] !min-w-[0]">
                      <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary)]">{album.albumName}</div>
                      <div className="!text-[length:11px] ![color:var(--text-faint)] !mt-[1px]">
                        {album.assetCount} {t('memories.photos')}
                      </div>
                    </div>
                    {isLinked ? (
                      <Check size={16} color="var(--text-faint)" />
                    ) : (
                      <Link2 size={16} color="var(--text-muted)" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Photo Picker Modal ────────────────────────────────────────────────────

  if (showPicker) {
    const alreadyAdded = new Set(
      tripPhotos
        .filter(p => p.user_id === currentUser?.id)
        .map(p => makePickerKey(p.provider, p.asset_id))
    )

    return (
      <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...font }}>
        {/* Picker header */}
        <div className="!p-[14px_20px] ![border-bottom:1px_solid_var(--border-secondary)]">
          <div className="!flex !items-center !justify-between !mb-[10px]">
            <h3 className="!m-[0] !text-[length:15px] !font-[700] ![color:var(--text-primary)]">
              {availableProviders.length > 1 ? t('memories.selectPhotosMultiple') : t('memories.selectPhotos', { provider_name: availableProviders.find(p => p.id === selectedProvider)?.name || 'Photo provider' })}
            </h3>
            <div className="!flex !gap-[8px]">
              <button className="!p-[7px_14px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => { clearImageQueue(); setShowPicker(false) }}>
                {t('common.cancel')}
              </button>
              <button className="!p-[7px_14px] !rounded-[10px] ![border:none] !text-[length:12px] !font-[600] ![font-family:inherit]" onClick={confirmSelection} disabled={selectedIds.size === 0}
                style={{ cursor: selectedIds.size > 0 ? 'pointer' : 'default', background: selectedIds.size > 0 ? 'var(--text-primary)' : 'var(--border-primary)', color: selectedIds.size > 0 ? 'var(--bg-primary)' : 'var(--text-faint)' }}>
                {selectedIds.size > 0 ? t('memories.addSelected', { count: selectedIds.size }) : t('memories.addPhotos')}
              </button>
            </div>
          </div>
          <div className="!mb-[10px]">
            <ProviderTabs />
          </div>
          {/* Filter tabs */}
          <div className="!flex !gap-[6px]">
            {startDate && endDate && (
              <button className={['!p-[6px_14px] !rounded-[99px] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit] ![transition:all_0.15s]', (pickerDateFilter) ? '![background:var(--text-primary)]' : '![background:var(--bg-card)]', (pickerDateFilter) ? '[&&]:![border-color:var(--text-primary)]' : '[&&]:![border-color:var(--border-primary)]', (pickerDateFilter) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '![border:1px_solid]'].join(' ')} onClick={() => { if (!pickerDateFilter) { setPickerDateFilter(true); loadPickerPhotos(true) } }}>
                {t('memories.tripDates')} ({startDate ? new Date(startDate + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''} — {endDate ? new Date(endDate + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''})
              </button>
            )}
            <button className={['!p-[6px_14px] !rounded-[99px] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit] ![transition:all_0.15s]', (!pickerDateFilter) ? '![background:var(--text-primary)]' : '![background:var(--bg-card)]', (!pickerDateFilter) ? '[&&]:![border-color:var(--text-primary)]' : '[&&]:![border-color:var(--border-primary)]', (!pickerDateFilter) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '![border:1px_solid]'].join(' ')} onClick={() => { if (pickerDateFilter || !startDate) { setPickerDateFilter(false); loadPickerPhotos(false) } }}>
              <span className="hidden sm:inline">{t('memories.allPhotos')}</span>
              <span className="sm:hidden">{t('common.all')}</span>
            </button>
          </div>
          {selectedIds.size > 0 && (
            <p className="!m-[8px_0_0] !text-[length:12px] !font-[600] ![color:var(--text-primary)]">
              {selectedIds.size} {t('memories.selected')}
            </p>
          )}
        </div>

        {/* Picker grid */}
        <div className="!flex-[1] !overflow-y-auto !p-[12px]">
          {pickerLoading ? (
            <div className="!flex !items-center !justify-center !p-[60px]">
              <div className="w-7 h-7 border-2 rounded-full animate-spin ![border-color:var(--border-primary)] ![border-top-color:var(--text-primary)]" />
            </div>
          ) : pickerPhotos.length === 0 ? (
            <div className="!text-center !p-[60px_20px]">
              <Camera size={36} style={{ color: 'var(--text-faint)', margin: '0 auto 10px', display: 'block' }} />
              <p className="!text-[length:13px] ![color:var(--text-muted)] !m-[0]">{t('memories.noPhotos')}</p>
              {
                pickerDateFilter && (
                  <p className="!text-[length:12px] ![color:var(--text-faint)] !m-[0_0_16px]">
                    {t('memories.noPhotosHint', { provider_name: availableProviders.find(p => p.id === selectedProvider)?.name || 'Photo provider' })}
                  </p>
                )
              } 
            </div>
          ) : (() => {
            // Group photos by month
            const byMonth: Record<string, Asset[]> = {}
            for (const asset of pickerPhotos) {
              const d = asset.takenAt ? new Date(asset.takenAt) : null
              const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'unknown'
              if (!byMonth[key]) byMonth[key] = []
              byMonth[key].push(asset)
            }
            const sortedMonths = Object.keys(byMonth).sort().reverse()

            return sortedMonths.map(month => (
              <div className="!mb-[16px]" key={month}>
                <div className="!text-[length:12px] !font-[700] ![color:var(--text-muted)] !mb-[6px] !pl-[2px]">
                  {month !== 'unknown'
                    ? new Date(month + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
                    : '—'}
                </div>
                <div className="!grid ![grid-template-columns:repeat(auto-fill,_minmax(100px,_1fr))] !gap-[4px]">
                  {byMonth[month].map(asset => {
                    const pickerKey = makePickerKey(asset.provider, asset.id)
                    const isSelected = selectedIds.has(pickerKey)
                    const isAlready = alreadyAdded.has(pickerKey)
                    return (
                      <div className={['!relative ![aspect-ratio:1] !rounded-[8px] !overflow-hidden', (isAlready) ? '!cursor-default' : '!cursor-pointer', (isSelected) ? '![outline:3px_solid_var(--text-primary)]' : '![outline:none]', '[&&]:![outline-offset:-3px]'].join(' ')} key={pickerKey}
                        onClick={() => !isAlready && togglePickerSelect(pickerKey)}
                        style={{ opacity: isAlready ? 0.3 : 1 }}>
                        <ProviderImg baseUrl={buildProviderAssetUrlFromAsset(asset, 'thumbnail', currentUser!.id)} provider={asset.provider} loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {isSelected && (
                          <div className="!absolute !top-[4px] !right-[4px] !w-[22px] !h-[22px] !rounded-[50%] ![background:var(--text-primary)] !flex !items-center !justify-center">
                            <Check size={13} color="var(--bg-primary)" />
                          </div>
                        )}
                        {isAlready && (
                          <div className="!absolute !inset-[0] !flex !items-center !justify-center ![background:rgba(0,0,0,0.3)] !text-[length:10px] ![color:white] !font-[600]">
                            {t('memories.alreadyAdded')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          })()}
        </div>
      </div>

      {/* Confirm share popup (inside picker) */}
      {showConfirmShare && (
        <div className="!fixed !inset-[0] !z-[1000] ![background:var(--modal-backdrop)] ![backdrop-filter:blur(12px)_saturate(150%)] ![-webkit-backdrop-filter:blur(12px)_saturate(150%)] !flex !items-center !justify-center !p-[20px]" onClick={() => setShowConfirmShare(false)}>
          <div className="![background:var(--modal-bg)] ![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] ![box-shadow:var(--modal-shadow)] !rounded-[16px] !p-[24px] !max-w-[360px] !w-[100%] !text-center" onClick={e => e.stopPropagation()}>
            <Share2 size={28} style={{ color: 'var(--text-primary)', marginBottom: 12 }} />
            <h3 className="!m-[0_0_8px] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">
              {t('memories.confirmShareTitle')}
            </h3>
            <p className="!m-[0_0_20px] !text-[length:13px] ![color:var(--text-muted)] !leading-[1.5]">
              {t('memories.confirmShareHint', { count: selectedIds.size })}
            </p>
            <div className="!flex !gap-[8px] !justify-center">
              <button className="!p-[8px_20px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:13px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setShowConfirmShare(false)}>
                {t('common.cancel')}
              </button>
              <button className="!p-[8px_20px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[600] !cursor-pointer ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={executeAddPhotos}>
                {t('memories.confirmShareButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
    )
  }

  // ── Main Gallery ──────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...font }}>

      {/* Disconnected banner — shown when photos exist but provider is unreachable */}
      {!connected && allVisible.length > 0 && enabledProviders.length > 0 && (
        <div className="!flex !items-center !gap-[8px] !p-[8px_16px] !shrink-[0] ![background:rgba(234,179,8,0.08)] ![border-bottom:1px_solid_rgba(234,179,8,0.25)] !text-[length:12px] ![color:var(--text-muted)]">
          <Camera size={13} style={{ color: '#ca8a04', flexShrink: 0 }} />
          <span>
            {t('memories.providerDisconnectedBanner', {
              provider_name: enabledProviders.length === 1 ? enabledProviders[0].name : enabledProviders.map(p => p.name).join(', ')
            })}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="!p-[16px_20px] ![border-bottom:1px_solid_var(--border-secondary)] !shrink-[0]">
        <div className="!flex !items-center !justify-between">
          <div>
            <h2 className="!m-[0] !text-[length:18px] !font-[700] ![color:var(--text-primary)]">
              {t('memories.title')}
            </h2>
            <p className="!m-[2px_0_0] !text-[length:12px] ![color:var(--text-faint)]">
              {allVisible.length} {t('memories.photosFound')}
              {othersPhotos.length > 0 && ` · ${othersPhotos.length} ${t('memories.fromOthers')}`}
            </p>
          </div>
          {connected && (
            <div className="!flex !gap-[6px]">
              <button className="!flex !items-center !gap-[5px] !p-[7px_14px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={openAlbumPicker}>
                <Link2 size={13} /> {t('memories.linkAlbum')}
              </button>
              <button className="!flex !items-center !gap-[5px] !p-[7px_14px] !rounded-[10px] ![border:none] ![background:var(--text-primary)] ![color:var(--bg-primary)] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]" onClick={openPicker}>
                <Plus size={14} /> {t('memories.addPhotos')}
              </button>
            </div>
          )}
        </div>

        {/* Linked Albums */}
        {albumLinks.length > 0 && (
          <div className="!p-[8px_20px] ![border-bottom:1px_solid_var(--border-secondary)] !flex !gap-[6px] !flex-wrap">
            {albumLinks.map(link => (
              <div className="!flex !items-center !gap-[6px] !p-[4px_10px] !rounded-[8px] ![background:var(--bg-tertiary)] !text-[length:11px] ![color:var(--text-muted)]" key={link.id}>
                <FolderOpen size={11} />
                <span className="!font-[500]">{link.album_name}</span>
                {link.username !== currentUser?.username && <span className="![color:var(--text-faint)]">({link.username})</span>}
                <button className="![background:none] ![border:none] !cursor-pointer !p-[2px] !flex ![color:var(--text-faint)]" onClick={() => syncAlbum(link.id, link.provider)} disabled={syncing === link.id} title={t('memories.syncAlbum')}>
                  <RefreshCw size={11} style={{ animation: syncing === link.id ? 'spin 1s linear infinite' : 'none' }} />
                </button>
                {link.user_id === currentUser?.id && (
                  <button className="![background:none] ![border:none] !cursor-pointer !p-[2px] !flex ![color:var(--text-faint)]" onClick={() => unlinkAlbum(link.id)} title={t('memories.unlinkAlbum')}>
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter & Sort bar */}
      {allVisibleRaw.length > 0 && (
        <div className="!flex !gap-[6px] !p-[8px_20px] ![border-bottom:1px_solid_var(--border-secondary)] !shrink-[0] !flex-wrap">
          <button className="!flex !items-center !gap-[4px] !p-[4px_10px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !text-[length:11px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setSortAsc(v => !v)}>
            <ArrowUpDown size={11} /> {sortAsc ? t('memories.oldest') : t('memories.newest')}
          </button>
          {locations.length > 1 && (
            <select className="!p-[4px_10px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !text-[length:11px] ![font-family:inherit] ![color:var(--text-muted)] !cursor-pointer ![outline:none]" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
              <option value="">{t('memories.allLocations')}</option>
              {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Gallery */}
      <div className="!flex-[1] !overflow-y-auto !p-[12px]">
        {allVisible.length === 0 ? (
          <div className="!text-center !p-[60px_20px]">
            <Camera size={40} style={{ color: 'var(--text-faint)', margin: '0 auto 12px', display: 'block' }} />
            <p className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !m-[0_0_12px]">
              {t('memories.noPhotos')}
            </p>
            <button className="!inline-flex !items-center !gap-[5px] !p-[9px_18px] !rounded-[10px] ![border:none] ![background:var(--text-primary)] ![color:var(--bg-primary)] !text-[length:13px] !font-[600] !cursor-pointer ![font-family:inherit]" onClick={openPicker}>
              <Plus size={15} /> {t('memories.addPhotos')}
            </button>
          </div>
        ) : (
          <div className="!grid ![grid-template-columns:repeat(auto-fill,_minmax(130px,_1fr))] !gap-[6px]">
            {allVisible.map(photo => {
              const isOwn = photo.user_id === currentUser?.id
              return (
                <div key={photo.photo_id} className="group !relative ![aspect-ratio:1] !rounded-[10px] !overflow-visible !cursor-pointer"
                  onClick={() => {
                    setLightboxId(photo.photo_id); setLightboxUserId(photo.user_id); setLightboxInfo(null)
                    if (lightboxOriginalSrc) URL.revokeObjectURL(lightboxOriginalSrc)
                    setLightboxOriginalSrc('')
                    fetchImageAsBlob('/api' + buildProviderAssetUrl(photo, 'original')).then(setLightboxOriginalSrc)
                    setLightboxInfoLoading(true)
                    apiClient.get(buildProviderAssetUrl(photo, 'info'))
                      .then(r => setLightboxInfo(r.data)).catch(() => {}).finally(() => setLightboxInfoLoading(false))
                  }}>

                  <ProviderImg baseUrl={buildProviderAssetUrl(photo, 'thumbnail')} provider={photo.provider} loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />

                  {/* Other user's avatar */}
                  {!isOwn && (
                    <div className="memories-avatar !absolute !bottom-[6px] !left-[6px] !z-[10]">
                      <div className="!w-[22px] !h-[22px] !rounded-[50%] !flex !items-center !justify-center !text-[length:10px] !font-[700] ![color:white] !uppercase ![border:2px_solid_white] ![box-shadow:0_1px_4px_rgba(0,0,0,0.3)]" style={{ background: `hsl(${photo.username.charCodeAt(0) * 37 % 360}, 55%, 55%)` }}>
                        {photo.username[0]}
                      </div>
                      <div className="memories-avatar-tooltip !absolute !bottom-[100%] !left-[50%] !mb-[6px] !p-[3px_8px] !rounded-[6px] ![background:var(--text-primary)] ![color:var(--bg-primary)] !text-[length:10px] !font-[600] !whitespace-nowrap !pointer-events-none ![transition:opacity_0.15s]" style={{ transform: 'translateX(-50%)', opacity: 0 }}>
                        {photo.username}
                      </div>
                    </div>
                  )}

                  {/* Own photo actions (hover) */}
                  {isOwn && (
                    <div className="opacity-0 group-hover:opacity-100 !absolute !top-[4px] !right-[4px] !flex !gap-[3px] ![transition:opacity_0.15s]">
                      <button className="!w-[26px] !h-[26px] !rounded-[50%] ![border:none] !cursor-pointer ![background:rgba(0,0,0,0.5)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center" onClick={e => { e.stopPropagation(); toggleSharing(photo, !photo.shared) }}
                        title={photo.shared ? t('memories.stopSharing') : t('memories.sharePhotos')}>
                        {photo.shared ? <Eye size={12} color="white" /> : <EyeOff size={12} color="white" />}
                      </button>
                      <button className="!w-[26px] !h-[26px] !rounded-[50%] ![border:none] !cursor-pointer ![background:rgba(0,0,0,0.5)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center" onClick={e => { e.stopPropagation(); removePhoto(photo) }}>
                        <X size={12} color="white" />
                      </button>
                    </div>
                  )}

                  {/* Not shared indicator */}
                  {isOwn && !photo.shared && (
                    <div className="!absolute !bottom-[6px] !right-[6px] !p-[2px_6px] !rounded-[6px] ![background:rgba(0,0,0,0.5)] ![backdrop-filter:blur(4px)] !text-[length:9px] ![color:rgba(255,255,255,0.7)] !font-[500]">
                      <EyeOff size={9} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />
                      {t('memories.private')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style>{`
        .memories-avatar:hover .memories-avatar-tooltip { opacity: 1 !important; }
      `}</style>

      {/* Confirm share popup */}
      {showConfirmShare && (
        <div className="!fixed !inset-[0] !z-[1000] ![background:var(--modal-backdrop)] ![backdrop-filter:blur(12px)_saturate(150%)] ![-webkit-backdrop-filter:blur(12px)_saturate(150%)] !flex !items-center !justify-center !p-[20px]" onClick={() => setShowConfirmShare(false)}>
          <div className="![background:var(--modal-bg)] ![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] ![box-shadow:var(--modal-shadow)] !rounded-[16px] !p-[24px] !max-w-[360px] !w-[100%] !text-center" onClick={e => e.stopPropagation()}>
            <Share2 size={28} style={{ color: 'var(--text-primary)', marginBottom: 12 }} />
            <h3 className="!m-[0_0_8px] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">
              {t('memories.confirmShareTitle')}
            </h3>
            <p className="!m-[0_0_20px] !text-[length:13px] ![color:var(--text-muted)] !leading-[1.5]">
              {t('memories.confirmShareHint', { count: selectedIds.size })}
            </p>
            <div className="!flex !gap-[8px] !justify-center">
              <button className="!p-[8px_20px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:13px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setShowConfirmShare(false)}>
                {t('common.cancel')}
              </button>
              <button className="!p-[8px_20px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[600] !cursor-pointer ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={executeAddPhotos}>
                {t('memories.confirmShareButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxId && lightboxUserId && (() => {
        const closeLightbox = () => {
          if (lightboxOriginalSrc) URL.revokeObjectURL(lightboxOriginalSrc)
          setLightboxOriginalSrc('')
          setLightboxId(null)
          setLightboxUserId(null)
          setShowMobileInfo(false)
        }

        const currentIdx = allVisible.findIndex(p => p.photo_id === lightboxId)
        const hasPrev = currentIdx > 0
        const hasNext = currentIdx < allVisible.length - 1
        const navigateTo = (idx: number) => {
          const photo = allVisible[idx]
          if (!photo) return
          if (lightboxOriginalSrc) URL.revokeObjectURL(lightboxOriginalSrc)
          setLightboxOriginalSrc('')
          setLightboxId(photo.photo_id)
          setLightboxUserId(photo.user_id)
          setLightboxInfo(null)
          fetchImageAsBlob('/api' + buildProviderAssetUrl(photo, 'original')).then(setLightboxOriginalSrc)
          setLightboxInfoLoading(true)
          apiClient.get(buildProviderAssetUrl(photo, 'info'))
            .then(r => setLightboxInfo(r.data)).catch(() => {}).finally(() => setLightboxInfoLoading(false))
        }

        const exifContent = lightboxInfo ? (
          <>
            {lightboxInfo.takenAt && (
              <div>
                <div className="!text-[length:9px] !font-[700] !uppercase !tracking-[0.08em] ![color:rgba(255,255,255,0.4)] !mb-[3px]">Date</div>
                <div className="!text-[length:13px] !font-[600]">{new Date(lightboxInfo.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                <div className="!text-[length:11px] ![color:rgba(255,255,255,0.5)]">{new Date(lightboxInfo.takenAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            )}
            {(lightboxInfo.city || lightboxInfo.country) && (
              <div>
                <div className="!text-[length:9px] !font-[700] !uppercase !tracking-[0.08em] ![color:rgba(255,255,255,0.4)] !mb-[3px]">
                  <MapPin size={9} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />Location
                </div>
                <div className="!text-[length:13px] !font-[600]">
                  {[lightboxInfo.city, lightboxInfo.state, lightboxInfo.country].filter(Boolean).join(', ')}
                </div>
              </div>
            )}
            {lightboxInfo.camera && (
              <div>
                <div className="!text-[length:9px] !font-[700] !uppercase !tracking-[0.08em] ![color:rgba(255,255,255,0.4)] !mb-[3px]">Camera</div>
                <div className="!text-[length:12px] !font-[500]">{lightboxInfo.camera}</div>
                {lightboxInfo.lens && <div className="!text-[length:11px] ![color:rgba(255,255,255,0.5)] !mt-[2px]">{lightboxInfo.lens}</div>}
              </div>
            )}
            {(lightboxInfo.focalLength || lightboxInfo.aperture || lightboxInfo.iso) && (
              <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[8px]">
                {lightboxInfo.focalLength && (
                  <div>
                    <div className="!text-[length:9px] ![color:rgba(255,255,255,0.4)] !uppercase !tracking-[0.05em]">Focal</div>
                    <div className="!text-[length:13px] !font-[700]">{lightboxInfo.focalLength}</div>
                  </div>
                )}
                {lightboxInfo.aperture && (
                  <div>
                    <div className="!text-[length:9px] ![color:rgba(255,255,255,0.4)] !uppercase !tracking-[0.05em]">Aperture</div>
                    <div className="!text-[length:13px] !font-[700]">{lightboxInfo.aperture}</div>
                  </div>
                )}
                {lightboxInfo.shutter && (
                  <div>
                    <div className="!text-[length:9px] ![color:rgba(255,255,255,0.4)] !uppercase !tracking-[0.05em]">Shutter</div>
                    <div className="!text-[length:13px] !font-[700]">{lightboxInfo.shutter}</div>
                  </div>
                )}
                {lightboxInfo.iso && (
                  <div>
                    <div className="!text-[length:9px] ![color:rgba(255,255,255,0.4)] !uppercase !tracking-[0.05em]">ISO</div>
                    <div className="!text-[length:13px] !font-[700]">{lightboxInfo.iso}</div>
                  </div>
                )}
              </div>
            )}
            {(lightboxInfo.width || lightboxInfo.fileName) && (
              <div className="![border-top:1px_solid_rgba(255,255,255,0.08)] !pt-[10px]">
                {lightboxInfo.width && lightboxInfo.height && (
                  <div className="!text-[length:11px] ![color:rgba(255,255,255,0.4)] !mb-[3px]">{lightboxInfo.width} × {lightboxInfo.height}</div>
                )}
                {lightboxInfo.fileSize && (
                  <div className="!text-[length:11px] ![color:rgba(255,255,255,0.4)]">{(lightboxInfo.fileSize / 1024 / 1024).toFixed(1)} MB</div>
                )}
              </div>
            )}
          </>
        ) : null

        return (
          <div onClick={closeLightbox}
            onKeyDown={e => { if (e.key === 'ArrowLeft' && hasPrev) navigateTo(currentIdx - 1); if (e.key === 'ArrowRight' && hasNext) navigateTo(currentIdx + 1); if (e.key === 'Escape') closeLightbox() }}
            tabIndex={0} ref={el => el?.focus()}
            onTouchStart={e => (e.currentTarget as any)._touchX = e.touches[0].clientX}
            onTouchEnd={e => { const start = (e.currentTarget as any)._touchX; if (start == null) return; const diff = e.changedTouches[0].clientX - start; if (diff > 60 && hasPrev) navigateTo(currentIdx - 1); else if (diff < -60 && hasNext) navigateTo(currentIdx + 1) }}
            style={{
              position: 'absolute', inset: 0, zIndex: 100, outline: 'none',
              background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {/* Close button */}
            <button className="!absolute !top-[16px] !right-[16px] !z-[10] !w-[40px] !h-[40px] !rounded-[50%] ![background:rgba(255,255,255,0.1)] ![border:none] !cursor-pointer !flex !items-center !justify-center" onClick={closeLightbox}>
              <X size={20} color="white" />
            </button>

            {/* Counter */}
            {allVisible.length > 1 && (
              <div className="!absolute !top-[20px] !left-[20px] !z-[10] !text-[length:12px] ![color:rgba(255,255,255,0.5)]">
                {currentIdx + 1} / {allVisible.length}
              </div>
            )}

            {/* Prev/Next buttons */}
            {hasPrev && (
              <button className="!absolute !left-[12px] !top-[50%] !z-[10] ![background:rgba(0,0,0,0.5)] ![border:none] !rounded-[50%] !w-[40px] !h-[40px] !flex !items-center !justify-center !cursor-pointer ![color:rgba(255,255,255,0.8)]" onClick={e => { e.stopPropagation(); navigateTo(currentIdx - 1) }}
                style={{ transform: 'translateY(-50%)' }}>
                <ChevronLeft size={22} />
              </button>
            )}
            {hasNext && (
              <button className={['!absolute !z-[10] ![background:rgba(0,0,0,0.5)] ![border:none] !rounded-[50%] !w-[40px] !h-[40px] !flex !items-center !justify-center !cursor-pointer ![color:rgba(255,255,255,0.8)]', (isMobile) ? '!right-[12px]' : '!right-[280px]', '!top-[50%]'].join(' ')} onClick={e => { e.stopPropagation(); navigateTo(currentIdx + 1) }}
                style={{ transform: 'translateY(-50%)' }}>
                <ChevronRight size={22} />
              </button>
            )}

            {/* Mobile info toggle button */}
            {isMobile && (lightboxInfo || lightboxInfoLoading) && (
              <button className="!absolute !top-[16px] !right-[68px] !z-[10] !w-[40px] !h-[40px] !rounded-[50%] ![border:none] !cursor-pointer !flex !items-center !justify-center" onClick={e => { e.stopPropagation(); setShowMobileInfo(prev => !prev) }}
                style={{ background: showMobileInfo ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)' }}>
                <Info size={20} color="white" />
              </button>
            )}

            <div className="!flex !gap-[16px] !items-start !justify-center !p-[20px] !w-[100%] !h-[100%]" onClick={e => { if (e.target === e.currentTarget) closeLightbox() }}>
              <img className={['!object-contain !rounded-[10px] !cursor-default', ((!isMobile && lightboxInfo)) ? '!max-w-[calc(100%_-_280px)]' : '!max-w-[100%]', '!max-h-[100%]'].join(' ')}
                src={lightboxOriginalSrc}
                alt=""
                onClick={e => e.stopPropagation()}
              />

              {/* Desktop info panel — liquid glass */}
              {!isMobile && lightboxInfo && (
                <div className="!w-[240px] !shrink-[0] !rounded-[16px] !p-[18px] ![background:rgba(255,255,255,0.08)] ![backdrop-filter:blur(20px)] ![-webkit-backdrop-filter:blur(20px)] ![border:1px_solid_rgba(255,255,255,0.12)] ![color:white] !flex !flex-col !gap-[14px] !max-h-[100%] !overflow-y-auto">
                  {exifContent}
                </div>
              )}

              {!isMobile && lightboxInfoLoading && (
                <div className="!w-[240px] !flex !items-center !justify-center">
                  <div className="w-6 h-6 border-2 rounded-full animate-spin ![border-color:rgba(255,255,255,0.2)] ![border-top-color:white]" />
                </div>
              )}
            </div>

            {/* Mobile bottom sheet */}
            {isMobile && showMobileInfo && lightboxInfo && (
              <div className="!absolute !bottom-[0] !left-[0] !right-[0] !z-[5] !max-h-[60vh] !overflow-y-auto !rounded-[16px_16px_0_0] !p-[18px] ![background:rgba(0,0,0,0.85)] ![backdrop-filter:blur(20px)] ![-webkit-backdrop-filter:blur(20px)] ![border:1px_solid_rgba(255,255,255,0.12)] [&&]:![border-bottom:none] ![color:white] !flex !flex-col !gap-[14px]" onClick={e => e.stopPropagation()}>
                {exifContent}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

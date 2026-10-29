/**
 * The photo-provider picker (Immich, Synology Photos, OneDrive) and the date
 * picker it uses — moved out of JourneyDetailPage.tsx in 5.7.2 so the Studio
 * can open the same picker and add pictures to the journey without leaving
 * the book (see StudioSidebar's Photos section).
 */
import { useEffect, useState, useRef, useMemo } from 'react'
import {
  ArrowLeft, Calendar, Camera, Check, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { AlbumBrowser, normalizeAlbums } from './AlbumBrowser'
import type { PickerAlbum } from './albumBrowser'
import type { JourneyEntry, JourneyTrip } from '../../store/journeyStore'

// ── Scroll Trigger ───────────────────────────────────────────────────────

function ScrollTrigger({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !loading) onVisible() }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [onVisible, loading])
  return (
    <div ref={ref} className="flex justify-center py-4 mt-2">
      <div className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white rounded-full animate-spin" />
    </div>
  )
}

// ── Photo date grouping ───────────────────────────────────────────────────

function groupPhotosByDate(photos: any[]): { date: string; label: string; assets: any[] }[] {
  const map = new Map<string, any[]>()
  for (const asset of photos) {
    const key = asset.takenAt ? asset.takenAt.slice(0, 10) : '__unknown__'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(asset)
  }
  return [...map.entries()].map(([date, assets]) => ({
    date,
    label: date === '__unknown__'
      ? 'Unknown date'
      : new Date(date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    assets,
  }))
}

// ── Provider Picker ───────────────────────────────────────────────────────

export function ProviderPicker({ provider, userId, entries, trips, existingAssetIds, onClose, onAdd }: {
  provider: string
  userId: number
  entries: JourneyEntry[]
  trips: JourneyTrip[]
  existingAssetIds: Set<string>
  onClose: () => void
  onAdd: (groups: Array<{ assetIds: string[]; passphrase?: string }>, entryId: number | null) => Promise<void>
}) {
  const { t, locale } = useTranslation()
  const [filter, setFilter] = useState<'trip' | 'custom' | 'all' | 'album'>('trip')
  const [photos, setPhotos] = useState<any[]>([])
  const [albums, setAlbums] = useState<PickerAlbum[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null)
  const [selectedAlbumPassphrase, setSelectedAlbumPassphrase] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [searchFrom, setSearchFrom] = useState('')
  const [searchTo, setSearchTo] = useState('')
  const [selected, setSelected] = useState<Map<string, { albumId?: string; passphrase?: string }>>(new Map())
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [targetEntryId, setTargetEntryId] = useState<number | null>(null)
  const [addToOpen, setAddToOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // compute trip range
  const tripRange = useMemo(() => {
    let from = '', to = ''
    for (const t of trips) {
      if (t.start_date && (!from || t.start_date < from)) from = t.start_date
      if (t.end_date && (!to || t.end_date > to)) to = t.end_date
    }
    return { from, to }
  }, [trips])

  const cancelPending = () => {
    if (abortRef.current) { abortRef.current.abort() }
    abortRef.current = new AbortController()
    return abortRef.current.signal
  }

  const searchPhotos = async (from: string, to: string, page: number = 1, append: boolean = false) => {
    const signal = cancelPending()
    if (page === 1) { setLoading(true); setPhotos([]) } else { setLoadingMore(true) }
    setSearchFrom(from)
    setSearchTo(to)
    setSearchPage(page)
    try {
      const res = await fetch(`/api/integrations/memories/${provider}/search`, {
        method: 'POST', credentials: 'include', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, page, size: 50 }),
      })
      if (res.ok) {
        const data = await res.json()
        const assets = data.assets || []
        setPhotos(prev => append ? [...prev, ...assets] : assets)
        setHasMore(!!data.hasMore)
      } else {
        setHasMore(false)
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setHasMore(false)
    }
    if (!signal.aborted) { setLoading(false); setLoadingMore(false) }
  }

  const loadMorePhotos = () => {
    if (loadingMore || !hasMore) return
    searchPhotos(searchFrom, searchTo, searchPage + 1, true)
  }

  const loadAlbumPhotos = async (album: { id: string; passphrase?: string }) => {
    const signal = cancelPending()
    setLoading(true)
    setPhotos([])
    setHasMore(false)
    try {
      const qs = album.passphrase ? `?passphrase=${encodeURIComponent(album.passphrase)}` : ''
      const res = await fetch(`/api/integrations/memories/${provider}/albums/${album.id}/photos${qs}`, { credentials: 'include', signal })
      if (res.ok) setPhotos((await res.json()).assets || [])
    } catch (e: any) { if (e.name !== 'AbortError') {} }
    if (!signal.aborted) setLoading(false)
  }

  const loadAlbums = async () => {
    setAlbumsLoading(true)
    try {
      const res = await fetch(`/api/integrations/memories/${provider}/albums`, { credentials: 'include' })
      if (res.ok) setAlbums(normalizeAlbums((await res.json()).albums || []))
    } catch {}
    setAlbumsLoading(false)
  }

  const pickAlbum = (a: PickerAlbum) => {
    setSelectedAlbum(a.id)
    setSelectedAlbumPassphrase(a.passphrase)
    loadAlbumPhotos(a)
  }

  const backToAlbums = () => {
    cancelPending()
    setSelectedAlbum(null)
    setSelectedAlbumPassphrase(undefined)
    setPhotos([])
    setLoading(false)
  }
  const currentAlbum = selectedAlbum ? albums.find(a => a.id === selectedAlbum) ?? null : null

  // load on mount / filter change
  useEffect(() => {
    if (filter === 'trip' && tripRange.from && tripRange.to) {
      searchPhotos(tripRange.from, tripRange.to)
    } else if (filter === 'all') {
      searchPhotos('', '')
    } else if (filter === 'album' && albums.length === 0) {
      loadAlbums()
    }
  }, [filter])

  const handleCustomSearch = () => {
    if (customFrom && customTo) searchPhotos(customFrom, customTo)
  }

  const toggleAsset = (id: string) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.set(id, { albumId: selectedAlbum ?? undefined, passphrase: selectedAlbumPassphrase })
      }
      return next
    })
  }

  const targetLabel = targetEntryId
    ? entries.find(e => e.id === targetEntryId)?.title || entries.find(e => e.id === targetEntryId)?.entry_date || t('journey.stats.entries')
    : t('journey.picker.newGallery')

  return (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center md:p-5 overscroll-none" style={{ background: 'rgba(9,9,11,0.75)' }} onClick={onClose} onTouchMove={e => { if (e.target === e.currentTarget) e.preventDefault() }}>
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl md:rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.2)] max-w-[720px] md:max-w-[960px] w-full max-h-[calc(100dvh-var(--bottom-nav-h)-20px)] md:max-h-[85vh] flex flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <h2 className="text-[16px] font-bold text-zinc-900 dark:text-white">
            {provider === 'immich' ? 'Immich' : provider === 'onedrive' ? 'OneDrive Photos' : provider === 'synologyphotos' ? 'Synology Photos' : provider}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          {/* Tabs */}
          <div className="flex gap-1.5 mb-3">
            {[
              { id: 'trip' as const, label: t('journey.picker.tripPeriod') },
              { id: 'custom' as const, label: t('journey.picker.dateRange') },
              { id: 'all' as const, label: t('journey.picker.allPhotos'), short: t('common.all') },
              { id: 'album' as const, label: t('journey.picker.albums') },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  filter === f.id
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {f.short ? (
                  <>
                    <span className="hidden sm:inline">{f.label}</span>
                    <span className="sm:hidden">{f.short}</span>
                  </>
                ) : f.label}
              </button>
            ))}
          </div>

          {/* Filter content — always visible row */}
          <div className="min-h-[36px] flex items-center">
            {filter === 'trip' && (
              <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                {tripRange.from && tripRange.to ? (
                  <>
                    <Calendar size={13} className="text-zinc-400" />
                    <span className="font-medium text-zinc-900 dark:text-white">
                      {new Date(tripRange.from + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-zinc-400">&mdash;</span>
                    <span className="font-medium text-zinc-900 dark:text-white">
                      {new Date(tripRange.to + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className="ml-1 text-zinc-400">
                      ({Math.ceil((new Date(tripRange.to).getTime() - new Date(tripRange.from).getTime()) / 86400000) + 1} days)
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-400">{t('journey.trips.noTripsLinkedSettings')}</span>
                )}
              </div>
            )}

            {filter === 'custom' && (
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1"><DatePicker value={customFrom} onChange={setCustomFrom} /></div>
                <span className="text-zinc-400 text-[12px]">&mdash;</span>
                <div className="flex-1"><DatePicker value={customTo} onChange={setCustomTo} /></div>
                <button onClick={handleCustomSearch}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[12px] font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 flex-shrink-0">
                  {t('journey.picker.search')}
                </button>
              </div>
            )}

            {filter === 'album' && (
              currentAlbum ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button onClick={backToAlbums}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex-shrink-0">
                    <ChevronLeft size={13} /> {t('journey.picker.albums')}
                  </button>
                  <span className="text-[13px] font-semibold text-zinc-900 dark:text-white truncate">{currentAlbum.albumName || 'Album'}</span>
                  {currentAlbum.assetCount != null && (
                    <span className="text-[12px] text-zinc-400 flex-shrink-0">{t('journey.picker.albumPhotos', { count: currentAlbum.assetCount })}</span>
                  )}
                </div>
              ) : (
                <span className="text-[12px] text-zinc-500">{albums.length ? t('journey.picker.albumsPickHint') : ''}</span>
              )
            )}
          </div>
        </div>

        {/* Add-to entry selector */}
        <div className="px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 flex-shrink-0">
          <div className="relative flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-zinc-500">{t('journey.picker.addTo')}</span>
            <button
              onClick={() => setAddToOpen(!addToOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[12px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span className={targetEntryId ? '' : 'font-semibold'}>{targetLabel}</span>
              <ChevronRight size={12} className="rotate-90 text-zinc-400" />
            </button>
            {addToOpen && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setAddToOpen(false)} />
                <div className="absolute left-12 top-full mt-1 z-10 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg py-1.5 min-w-[200px] max-h-[240px] overflow-y-auto">
                  <button
                    onClick={() => { setTargetEntryId(null); setAddToOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 ${
                      !targetEntryId
                        ? 'bg-zinc-100 dark:bg-zinc-700 font-semibold text-zinc-900 dark:text-white'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <Camera size={12} />
                    {t('journey.picker.newGallery')}
                  </button>
                  {entries.filter(e => e.type !== 'skeleton' && e.title !== 'Gallery' && e.title !== '[Trip Photos]').length > 0 && (
                    <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
                  )}
                  {entries.filter(e => e.type !== 'skeleton' && e.title !== 'Gallery' && e.title !== '[Trip Photos]').map(e => (
                    <button
                      key={e.id}
                      onClick={() => { setTargetEntryId(e.id); setAddToOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-[12px] truncate ${
                        targetEntryId === e.id
                          ? 'bg-zinc-100 dark:bg-zinc-700 font-semibold text-zinc-900 dark:text-white'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {e.title || e.location_name || new Date(e.entry_date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Select all bar — sticky above grid */}
        {!loading && photos.length > 0 && (() => {
          const selectable = photos.filter((a: any) => !existingAssetIds.has(a.id))
          const allSelected = selectable.length > 0 && selectable.every((a: any) => selected.has(a.id))
          if (selectable.length === 0) return null
          return (
            <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex-shrink-0">
              <button
                onClick={() => {
                  if (allSelected) {
                    setSelected(new Map())
                  } else {
                    setSelected(new Map(selectable.map((a: any) => [a.id, { albumId: selectedAlbum ?? undefined, passphrase: selectedAlbumPassphrase }])))
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                  allSelected
                    ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white'
                    : 'border-zinc-300 dark:border-zinc-600'
                }`}>
                  {allSelected && <Check size={9} className="text-white dark:text-zinc-900" strokeWidth={3} />}
                </div>
                {allSelected ? t('journey.picker.deselectAll') : t('journey.picker.selectAll')} ({selectable.length})
              </button>
            </div>
          )
        })()}

        {/* Photo grid */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 min-h-0">
          {filter === 'album' && !selectedAlbum ? (
            <AlbumBrowser
              albums={albums}
              loading={albumsLoading}
              provider={provider}
              userId={userId}
              tripFrom={tripRange.from}
              tripTo={tripRange.to}
              onPick={pickAlbum}
              t={t}
              locale={locale}
            />
          ) : loading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
              {provider === 'onedrive' && (
                <p className="text-[12px] text-zinc-400 text-center max-w-[320px]">{t('journey.picker.onedriveIndexing')}</p>
              )}
            </div>
          ) : photos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[13px] text-zinc-500">
                {filter === 'trip' && !tripRange.from ? t('journey.trips.noTripsLinkedSettings') : t('journey.detail.noPhotos')}
              </p>
            </div>
          ) : (
            <div>
              {groupPhotosByDate(photos).map(group => (
                <div key={group.date}>
                  <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2 mt-4 first:mt-0">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 mb-1">
                    {group.assets.map((asset: any) => {
                      const isSelected = selected.has(asset.id)
                      const alreadyAdded = existingAssetIds.has(asset.id)
                      return (
                        <div
                          key={asset.id}
                          onClick={() => !alreadyAdded && toggleAsset(asset.id)}
                          className={`relative aspect-square rounded-lg overflow-hidden ${
                            alreadyAdded
                              ? 'opacity-40 cursor-not-allowed'
                              : isSelected
                                ? 'ring-2 ring-zinc-900 dark:ring-white ring-offset-2 dark:ring-offset-zinc-900 cursor-pointer'
                                : 'cursor-pointer'
                          }`}
                        >
                          <img
                            src={`/api/integrations/memories/${provider}/assets/0/${asset.id}/${userId}/thumbnail${selectedAlbumPassphrase ? `?passphrase=${encodeURIComponent(selectedAlbumPassphrase)}` : ''}`}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={e => {
                              const img = e.currentTarget
                              const original = `/api/integrations/memories/${provider}/assets/0/${asset.id}/${userId}/original${selectedAlbumPassphrase ? `?passphrase=${encodeURIComponent(selectedAlbumPassphrase)}` : ''}`
                              if (!img.src.includes('/original')) img.src = original
                            }}
                          />
                          {alreadyAdded && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-zinc-500 text-white flex items-center justify-center">
                              <Check size={12} />
                            </div>
                          )}
                          {isSelected && !alreadyAdded && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center">
                              <Check size={12} />
                            </div>
                          )}
                          {asset.city && (
                            <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/50 to-transparent">
                              <p className="text-[8px] text-white truncate">{asset.city}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {/* Infinite scroll trigger */}
              {hasMore && !selectedAlbum && <ScrollTrigger onVisible={loadMorePhotos} loading={loadingMore} />}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-200/60 dark:bg-zinc-700/60 text-[11px] leading-none text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] leading-none font-bold">{selected.size}</span>
            <span className="leading-[18px]">{t('journey.picker.selected')}</span>
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 text-[13px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700">
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                const groupMap = new Map<string | undefined, string[]>()
                for (const [assetId, { passphrase }] of selected.entries()) {
                  const list = groupMap.get(passphrase) || []
                  list.push(assetId)
                  groupMap.set(passphrase, list)
                }
                const groups = [...groupMap.entries()].map(([passphrase, assetIds]) => ({ assetIds, passphrase }))
                onAdd(groups, targetEntryId)
              }}
              disabled={selected.size === 0}
              className="px-3.5 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('common.add')} {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Date Picker ───────────────────────────────────────────────────────────

export function DatePicker({ value, onChange, tripDates }: {
  value: string
  onChange: (date: string) => void
  tripDates?: Set<string>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value + 'T00:00:00') : new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate()
  const firstDow = new Date(viewMonth.year, viewMonth.month, 1).getDay()
  const monthName = new Date(viewMonth.year, viewMonth.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const prevMonth = () => {
    setViewMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })
  }
  const nextMonth = () => {
    setViewMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const formatted = value ? new Date(value + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg text-[13px] bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-left flex items-center justify-between"
      >
        {formatted ? (
          <span>{formatted}</span>
        ) : (
          <span>
            <span className="hidden sm:inline">{t('journey.picker.selectDate')}</span>
            <span className="sm:hidden">{t('common.date')}</span>
          </span>
        )}
        <Calendar size={13} className="text-zinc-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[10]" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-[20] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg p-3 w-[280px]">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={prevMonth} className="w-7 h-7 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500">
                <ArrowLeft size={14} />
              </button>
              <span className="text-[13px] font-semibold text-zinc-900 dark:text-white">{monthName}</span>
              <button type="button" onClick={nextMonth} className="w-7 h-7 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500">
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-medium text-zinc-400 py-1">{d}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                if (day === null) return <div key={`e${i}`} />
                const dateStr = `${viewMonth.year}-${pad(viewMonth.month + 1)}-${pad(day)}`
                const isSelected = dateStr === value
                const isTrip = tripDates?.has(dateStr)
                const isToday = dateStr === new Date().toISOString().split('T')[0]

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => { onChange(dateStr); setOpen(false) }}
                    className={`w-9 h-9 rounded-lg text-[12px] font-medium flex items-center justify-center relative transition-colors ${
                      isSelected
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : isToday
                          ? 'text-zinc-900 dark:text-white font-bold'
                          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {day}
                    {isTrip && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-500" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

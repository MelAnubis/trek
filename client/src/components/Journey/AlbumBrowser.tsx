import { useMemo, useState } from 'react'
import { Calendar, Image as ImageIcon, Search, Users, X } from 'lucide-react'
import { albumSections, albumTitle, albumYear, type AlbumSort, type PickerAlbum } from './albumBrowser'

/**
 * The "Albums" tab of the photo-provider picker, as a browsable grid instead
 * of a single row of chips: search, sort (most recent / name / most photos),
 * albums matching the journey's dates first, the rest grouped by year, each
 * with a cover where the provider has one. Picking one hands it back to the
 * picker, which shows its photos with a way back here.
 */

/** Providers send different shapes (OneDrive: name/count). Fill the fields the browser reads. */
export function normalizeAlbums(raw: any[]): PickerAlbum[] {
  return (raw || []).map(a => ({
    ...a,
    id: String(a.id),
    albumName: a.albumName || a.name || '',
    assetCount: a.assetCount ?? a.count ?? undefined,
  }))
}

/** Where to load an album's cover from, or null for a placeholder. */
export function albumCoverUrl(provider: string, userId: number, a: PickerAlbum): string | null {
  const base = `/api/integrations/memories/${provider}/assets/0`
  const pass = a.passphrase ? `?passphrase=${encodeURIComponent(a.passphrase)}` : ''
  if (provider === 'immich') return a.albumThumbnailAssetId ? `${base}/${a.albumThumbnailAssetId}/${userId}/thumbnail${pass}` : null
  // A OneDrive album or folder is a drive item with thumbnails of its own,
  // reachable through the same asset-thumbnail route as any photo.
  if (provider === 'onedrive') return `${base}/${a.id}/${userId}/thumbnail`
  return null
}

function Cover({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover" />
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700">
      {title
        ? <span className="text-[22px] font-semibold text-zinc-400 dark:text-zinc-500">{title.replace(/^[\d\s._-]+/, '').charAt(0).toUpperCase() || title.charAt(0)}</span>
        : <ImageIcon size={22} className="text-zinc-400" />}
    </div>
  )
}

function dateLabel(a: PickerAlbum, locale?: string): string | null {
  if (!a.startDate) return null
  const s = new Date(a.startDate)
  if (Number.isNaN(s.getTime())) return null
  const e = a.endDate ? new Date(a.endDate) : s
  const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()
  const fmt = (d: Date, withYear: boolean) => d.toLocaleDateString(locale, { month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
  return sameMonth ? fmt(s, true) : `${fmt(s, s.getFullYear() !== e.getFullYear())} – ${fmt(e, true)}`
}

export function AlbumBrowser({ albums, loading, provider, userId, tripFrom, tripTo, onPick, t, locale }: {
  albums: PickerAlbum[]
  loading: boolean
  provider: string
  userId: number
  tripFrom: string
  tripTo: string
  onPick: (a: PickerAlbum) => void
  t: (key: string, params?: Record<string, string | number>) => string
  locale?: string
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AlbumSort>('recent')
  const sections = useMemo(() => albumSections(albums, { sort, query, tripFrom, tripTo }), [albums, sort, query, tripFrom, tripTo])
  const total = albums.length

  if (loading && total === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    )
  }
  if (total === 0) {
    return <p className="text-center py-12 text-[13px] text-zinc-400">{t('journey.picker.noAlbums')}</p>
  }

  const heading = (key: string) => key === 'trip' ? t('journey.picker.albumsMatchTrip')
    : key === 'undated' ? t('journey.picker.albumsUndated')
    : key === 'all' ? (query.trim() ? t('journey.picker.albumsResults') : t('journey.picker.albums'))
    : key

  return (
    <div data-testid="album-browser">
      {/* Search + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('journey.picker.albumsSearch', { count: total })}
            aria-label={t('journey.picker.albumsSearch', { count: total })}
            className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[12px] text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('common.clear')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden" role="group" aria-label={t('journey.picker.albumsSort')}>
          {(['recent', 'name', 'size'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)} aria-pressed={sort === s}
              className={`px-2.5 py-1.5 text-[11px] font-medium ${sort === s ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
              {t(`journey.picker.albumsSort.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {sections.length === 0 && (
        <p className="text-center py-10 text-[13px] text-zinc-400">{t('journey.picker.albumsNoMatch', { query })}</p>
      )}

      {sections.map(section => (
        <section key={section.key} className="mb-5" aria-label={heading(section.key)}>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
            {section.key === 'trip' && <Calendar size={12} />}
            {heading(section.key)}
            <span className="font-normal text-zinc-400">· {section.albums.length}</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {section.albums.map(a => {
              const title = albumTitle(a) || 'Album'
              const when = dateLabel(a, locale) ?? (albumYear(a) && section.key !== String(albumYear(a)) ? String(albumYear(a)) : null)
              return (
                <button key={a.id} onClick={() => onPick(a)} title={title}
                  className={`group text-left rounded-xl overflow-hidden border bg-white dark:bg-zinc-900 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-zinc-400 ${section.key === 'trip' ? 'border-zinc-900 dark:border-white' : 'border-zinc-200 dark:border-zinc-700'}`}>
                  <div className="aspect-[4/3] overflow-hidden relative">
                    <Cover src={albumCoverUrl(provider, userId, a)} title={title} />
                    {a.shared && (
                      <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center" title={t('journey.picker.albumShared')}>
                        <Users size={11} />
                      </span>
                    )}
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{title}</div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      {a.assetCount != null ? t('journey.picker.albumPhotos', { count: a.assetCount }) : ''}
                      {a.assetCount != null && when ? ' · ' : ''}
                      {when}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

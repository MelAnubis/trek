import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { journeyApi } from '../api/client'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import {
  List, Grid, MapPin, Camera, BookOpen, Image, Clock,
  Laugh, Smile, Meh, Frown,
  Sun, CloudSun, Cloud, CloudRain, CloudLightning, Snowflake,
  ThumbsUp, ThumbsDown,
  Newspaper,
} from 'lucide-react'
import JourneyMap from '../components/Journey/JourneyMap'
import type { JourneyMapHandle } from '../components/Journey/JourneyMap'
import JournalBody from '../components/Journey/JournalBody'
import PhotoLightbox from '../components/Journey/PhotoLightbox'
import MobileMapTimeline from '../components/Journey/MobileMapTimeline'
import MobileEntryView from '../components/Journey/MobileEntryView'
import { PublicBookView } from '../components/Studio/PublicBookView'
import { useIsMobile } from '../hooks/useIsMobile'
import { formatLocationName } from '../utils/formatters'
import { DAY_COLORS } from '../components/Journey/dayColors'
import type { BookDocument } from '../types/book'

interface PublicEntry {
  id: number
  title?: string | null
  story?: string | null
  entry_date: string
  entry_time?: string | null
  location_name?: string | null
  location_lat?: number | null
  location_lng?: number | null
  mood?: string | null
  weather?: string | null
  pros_cons?: { pros: string[]; cons: string[] } | null
  photos: PublicPhoto[]
}

interface PublicPhoto {
  id: number
  entry_id: number
  photo_id: number
  provider?: string
  asset_id?: string | null
  owner_id?: number | null
  file_path?: string | null
  caption?: string | null
}

interface PublicGalleryPhoto {
  id: number
  journey_id: number
  photo_id: number
  provider?: string
  asset_id?: string | null
  owner_id?: number | null
  file_path?: string | null
  caption?: string | null
}

const MOOD_CONFIG: Record<string, { icon: typeof Smile; label: string; bg: string; text: string }> = {
  amazing: { icon: Laugh,  label: 'Amazing', bg: 'bg-pink-50 dark:bg-pink-900/20',   text: 'text-pink-600 dark:text-pink-400' },
  good:    { icon: Smile,  label: 'Good',    bg: 'bg-amber-50 dark:bg-amber-900/20',  text: 'text-amber-600 dark:text-amber-400' },
  neutral: { icon: Meh,    label: 'Neutral', bg: 'bg-zinc-100 dark:bg-zinc-800',       text: 'text-zinc-500 dark:text-zinc-400' },
  rough:   { icon: Frown,  label: 'Rough',   bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-600 dark:text-violet-400' },
}

const WEATHER_CONFIG: Record<string, { icon: typeof Sun; label: string }> = {
  sunny:  { icon: Sun,             label: 'Sunny' },
  partly: { icon: CloudSun,        label: 'Partly cloudy' },
  cloudy: { icon: Cloud,           label: 'Cloudy' },
  rainy:  { icon: CloudRain,       label: 'Rainy' },
  stormy: { icon: CloudLightning,  label: 'Stormy' },
  cold:   { icon: Snowflake,       label: 'Cold' },
}

function photoUrl(p: { photo_id: number }, shareToken: string, kind: 'thumbnail' | 'original' = 'original'): string {
  return `/api/public/journey/${shareToken}/photos/${p.photo_id}/${kind}`
}

function formatDate(d: string, locale?: string): { weekday: string; month: string; day: number } {
  const date = new Date(d + 'T00:00:00')
  return {
    weekday: date.toLocaleDateString(locale || 'en', { weekday: 'long' }),
    month: date.toLocaleDateString(locale || 'en', { month: 'long' }),
    day: date.getDate(),
  }
}

function groupByDate(entries: PublicEntry[]): Map<string, PublicEntry[]> {
  const groups = new Map<string, PublicEntry[]>()
  for (const e of entries) {
    const d = e.entry_date
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(e)
  }
  return groups
}

export default function JourneyPublicPage() {
  const { token } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const isMobile = useIsMobile()
  const [view, setView] = useState<'timeline' | 'gallery' | 'map' | 'book'>('timeline')
  const [book, setBook] = useState<BookDocument | null>(null)
  const [bookLoaded, setBookLoaded] = useState(false)
  const [lightbox, setLightbox] = useState<{ photos: { id: string; src: string; caption?: string | null }[]; index: number } | null>(null)
  const { t } = useTranslation()
  const [showLangPicker, setShowLangPicker] = useState(false)
  const locale = useSettingsStore(s => s.settings.language) || 'en'
  const mapRef = useRef<JourneyMapHandle>(null)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [viewingEntry, setViewingEntry] = useState<PublicEntry | null>(null)

  const handleMarkerClick = useCallback((entryId: string) => {
    setActiveEntryId(entryId)
    mapRef.current?.highlightMarker(entryId)
    document.querySelector(`[data-entry-id="${entryId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  useEffect(() => {
    if (!token) return
    journeyApi.getPublicJourney(token)
      .then(d => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [token])

  const entries = (data?.entries || []) as PublicEntry[]
  const gallery = (data?.gallery || []) as PublicGalleryPhoto[]
  const perms = data?.permissions || {}
  const journey = data?.journey || {}
  const stats = data?.stats || {}

  // Fetched separately (and lazily) — the book document can be sizeable, and
  // most visitors to a shared journey never open this tab.
  useEffect(() => {
    if (!token || !perms.share_book || view !== 'book' || bookLoaded) return
    journeyApi.getPublicBook(token)
      .then(d => setBook(d?.book?.document ?? null))
      .catch(() => setBook(null))
      .finally(() => setBookLoaded(true))
  }, [token, perms.share_book, view, bookLoaded])

  const timelineEntries = useMemo(() => entries, [entries])
  const groupedEntries = useMemo(() => groupByDate(timelineEntries), [timelineEntries])
  const sortedDates = useMemo(() => [...groupedEntries.keys()].sort(), [groupedEntries])
  const mapEntries = useMemo(
    () => timelineEntries.filter(e => e.location_lat && e.location_lng),
    [timelineEntries],
  )
  const allPhotos = gallery

  // Map entries with day color/label for colored markers.
  // dayIdx is derived from sortedDates (ALL timeline dates) so marker colors
  // stay in sync with the timeline day headers even when some days have no locations.
  const sidebarMapItems = useMemo(() => {
    const counters = new Map<string, number>()
    return mapEntries.map(e => {
      const dayIdx = sortedDates.indexOf(e.entry_date)
      const dayLabel = (counters.get(e.entry_date) ?? 0) + 1
      counters.set(e.entry_date, dayLabel)
      return {
        id: String(e.id),
        lat: e.location_lat!,
        lng: e.location_lng!,
        title: e.title || '',
        mood: e.mood,
        created_at: e.entry_date,
        entry_date: e.entry_date,
        dayColor: DAY_COLORS[dayIdx % DAY_COLORS.length],
        dayLabel,
      }
    })
  }, [mapEntries, sortedDates])

  // Two-column desktop layout: timeline feed left + sticky map right
  const desktopTwoColumn = !isMobile && perms.share_timeline && perms.share_map

  // Set default view based on permissions
  useEffect(() => {
    if (!perms.share_timeline && perms.share_gallery) setView('gallery')
    else if (!perms.share_timeline && !perms.share_gallery && perms.share_map) setView('map')
  }, [perms])

  // When switching to desktop two-column, 'map' standalone tab no longer exists
  useEffect(() => {
    if (desktopTwoColumn && view === 'map') setView('timeline')
  }, [desktopTwoColumn, view])

  if (loading) {
    return (
      <div className="min-h-screen page-bg flex items-center justify-center ![background:var(--bg-secondary)]">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen page-bg flex items-center justify-center ![background:var(--bg-secondary)]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">{t('journey.public.notFound')}</h1>
          <p className="text-zinc-500">{t('journey.public.notFoundMessage')}</p>
        </div>
      </div>
    )
  }

  // In desktop two-column mode the map is always visible — exclude the standalone 'map' tab
  const availableViews = [
    perms.share_timeline && { id: 'timeline' as const, icon: List, label: t('journey.share.timeline') },
    perms.share_gallery && { id: 'gallery' as const, icon: Grid, label: t('journey.share.gallery') },
    !desktopTwoColumn && !isMobile && perms.share_map && { id: 'map' as const, icon: MapPin, label: t('journey.share.map') },
    perms.share_book && { id: 'book' as const, icon: BookOpen, label: t('journey.share.book') },
  ].filter(Boolean) as { id: 'timeline' | 'gallery' | 'map' | 'book'; icon: any; label: string }[]

  // Shared book renderer
  const renderBook = () => {
    if (!bookLoaded) {
      return (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
        </div>
      )
    }
    if (!book) {
      return (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <BookOpen size={24} className="text-zinc-400" />
          </div>
          <p className="text-[15px] font-medium text-zinc-700 dark:text-zinc-300">{t('journey.public.noBook')}</p>
        </div>
      )
    }
    return <PublicBookView document={book} publicToken={token!} />
  }

  // Shared timeline renderer used in both layout modes
  const renderTimeline = () => (
    <div className="flex flex-col gap-6">
      {sortedDates.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <BookOpen size={24} className="text-zinc-400" />
          </div>
          <p className="text-[15px] font-medium text-zinc-700 dark:text-zinc-300">No entries yet</p>
        </div>
      )}
      {sortedDates.map((date, dayIdx) => {
        const dayEntries = groupedEntries.get(date)!
        const fd = formatDate(date, locale)
        const dayColor = DAY_COLORS[dayIdx % DAY_COLORS.length]
        return (
          <div key={date}>
            {/* Day header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-bold text-white flex-shrink-0"
                style={{ background: dayColor }}
              >
                {dayIdx + 1}
              </div>
              <div>
                <div className="text-[14px] font-semibold text-zinc-900 dark:text-white">{fd.weekday}</div>
                <div className="text-[11px] text-zinc-500">{fd.month} {fd.day}</div>
              </div>
            </div>

            {/* Entries */}
            <div className="flex flex-col gap-4 pl-[52px]">
              {dayEntries.map(entry => {
                const photos = entry.photos || []
                const mood = entry.mood ? MOOD_CONFIG[entry.mood] : null
                const weather = entry.weather ? WEATHER_CONFIG[entry.weather] : null
                const prosArr = entry.pros_cons?.pros ?? []
                const consArr = entry.pros_cons?.cons ?? []
                const hasProscons = prosArr.length > 0 || consArr.length > 0
                const lightboxPhotos = photos.map(p => ({ id: String(p.id), src: photoUrl(p, token!, 'original'), caption: p.caption }))

                const isActive = activeEntryId === String(entry.id)
                return (
                  <div
                    key={entry.id}
                    data-entry-id={String(entry.id)}
                    onMouseEnter={() => {
                      if (!desktopTwoColumn) return
                      setActiveEntryId(String(entry.id))
                      mapRef.current?.highlightMarker(String(entry.id))
                    }}
                    style={isActive && desktopTwoColumn ? { outline: `2px solid ${dayColor}`, outlineOffset: '3px', borderRadius: '16px' } : undefined}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden">

                    {/* Photo area */}
                    {photos.length === 1 && (
                      <div className="relative cursor-pointer" onClick={() => setLightbox({ photos: lightboxPhotos, index: 0 })}>
                        <img src={photoUrl(photos[0], token!)} className="w-full h-64 object-cover" alt="" />
                        <div className="absolute inset-x-0 bottom-0 pointer-events-none ![background:linear-gradient(to_top,_rgba(0,0,0,0.55)_0%,_rgba(0,0,0,0.15)_60%,_transparent_100%)] !h-[65%]" />
                        {entry.location_name && (
                          <div className="absolute top-3 left-4">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-black/40 backdrop-blur-sm rounded-full text-[10px] font-semibold text-white">
                              <MapPin size={10} className="flex-shrink-0" />
                              <span className="truncate max-w-[200px]">{formatLocationName(entry.location_name)}</span>
                            </span>
                          </div>
                        )}
                        {entry.title && (
                          <div className="absolute bottom-4 left-5 right-5 pointer-events-none">
                            <h3 className="text-[18px] font-bold text-white drop-shadow-sm leading-tight">{entry.title}</h3>
                          </div>
                        )}
                      </div>
                    )}

                    {photos.length === 2 && (
                      <div className="grid grid-cols-2 gap-0.5 overflow-hidden">
                        {photos.slice(0, 2).map((p, i) => (
                          <img
                            key={p.id}
                            src={photoUrl(p, token!, 'thumbnail')}
                            alt=""
                            className="w-full h-52 object-cover cursor-pointer"
                            onClick={() => setLightbox({ photos: lightboxPhotos, index: i })}
                          />
                        ))}
                      </div>
                    )}

                    {photos.length >= 3 && (
                      <div className="overflow-hidden flex !h-[280px] !gap-[2px]">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setLightbox({ photos: lightboxPhotos, index: 0 })}>
                          <img src={photoUrl(photos[0], token!, 'thumbnail')} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col !gap-[2px]">
                          <div className="flex-1 min-h-0 cursor-pointer" onClick={() => setLightbox({ photos: lightboxPhotos, index: 1 })}>
                            <img src={photoUrl(photos[1], token!, 'thumbnail')} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-h-0 relative cursor-pointer" onClick={() => setLightbox({ photos: lightboxPhotos, index: 2 })}>
                            <img src={photoUrl(photos[2], token!, 'thumbnail')} alt="" className="w-full h-full object-cover" />
                            {photos.length > 3 && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <span className="text-white text-[13px] font-semibold flex items-center gap-1">
                                  <Image size={13} /> +{photos.length - 3}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Content */}
                    <div className="px-5 pt-4 pb-5 cursor-pointer" onClick={() => setViewingEntry(entry)}>
                      {/* Title (only when no single photo — photo has it in overlay) */}
                      {photos.length !== 1 && entry.title && (
                        <h3 className="text-[16px] font-semibold text-zinc-900 dark:text-white tracking-tight leading-snug mb-2">{entry.title}</h3>
                      )}

                      {/* Location + time badges */}
                      {(entry.location_name || entry.entry_time) && photos.length !== 1 && (
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          {entry.location_name && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                              <MapPin size={11} className="flex-shrink-0" />
                              {formatLocationName(entry.location_name)}
                            </span>
                          )}
                          {entry.entry_time && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                              <Clock size={11} />
                              {entry.entry_time.slice(0, 5)}
                            </span>
                          )}
                        </div>
                      )}
                      {entry.entry_time && photos.length === 1 && (
                        <div className="flex items-center gap-1 text-[11px] text-zinc-400 mb-2">
                          <Clock size={11} />
                          {entry.entry_time.slice(0, 5)}
                        </div>
                      )}

                      {/* Story */}
                      {entry.story && (
                        <div className="text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed">
                          <JournalBody text={entry.story} />
                        </div>
                      )}

                      {/* Pros & Cons */}
                      {hasProscons && (
                        <div className={`grid gap-3 mt-4 ${prosArr.length > 0 && consArr.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {prosArr.length > 0 && (
                            <div className="rounded-xl border border-green-200 dark:border-green-800/30 p-3 ![background:linear-gradient(180deg,_#F0FDF4_0%,_white_100%)]">
                              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-green-700 mb-2">
                                <ThumbsUp size={10} /> Pros
                              </div>
                              {prosArr.map((p, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[12px] text-green-900 mb-1">
                                  <span className="w-[5px] h-[5px] rounded-full bg-green-500 flex-shrink-0 mt-[6px]" />{p}
                                </div>
                              ))}
                            </div>
                          )}
                          {consArr.length > 0 && (
                            <div className="rounded-xl border border-red-200 dark:border-red-800/30 p-3 ![background:linear-gradient(180deg,_#FEF2F2_0%,_white_100%)]">
                              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-red-700 mb-2">
                                <ThumbsDown size={10} /> Cons
                              </div>
                              {consArr.map((c, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[12px] text-red-900 mb-1">
                                  <span className="w-[5px] h-[5px] rounded-full bg-red-500 flex-shrink-0 mt-[6px]" />{c}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Mood + weather */}
                      {(mood || weather) && (
                        <div className="flex items-center gap-1.5 pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800">
                          {mood && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${mood.bg} ${mood.text}`}>
                              <mood.icon size={11} /> {mood.label}
                            </span>
                          )}
                          {weather && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                              <weather.icon size={11} /> {weather.label}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )

  // Shared gallery renderer
  const renderGallery = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
      {allPhotos.map((photo, idx) => (
        <div
          key={photo.id}
          className="aspect-square rounded-lg overflow-hidden cursor-pointer"
          onClick={() => setLightbox({ photos: allPhotos.map(p => ({ id: String(p.id), src: photoUrl(p, token!, 'original'), caption: p.caption })), index: idx })}
        >
          <img src={photoUrl(photo, token!, 'thumbnail')} className="w-full h-full object-cover hover:scale-105 transition-transform" alt="" loading="lazy" />
        </div>
      ))}
    </div>
  )

  // Shared view tab bar
  // The blog is its own page; with it shared, it is one more tab (a link).
  const renderTabs = (views: typeof availableViews) => (views.length > 1 || (perms.share_blog && views.length > 0)) && (
    <div className="flex bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden mb-6 w-fit">
      {perms.share_blog && (
        <a href={`/public/journey/${token}/blog`} className="order-last flex items-center gap-1.5 px-3 py-[7px] text-[12px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          <Newspaper size={13} />{t('blog.title')}
        </a>
      )}
      {views.map(v => (
        <button
          key={v.id}
          onClick={() => setView(v.id)}
          className={`flex items-center gap-1.5 px-3 py-[7px] text-[12px] font-medium ${
            view === v.id
              ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <v.icon size={13} />
          {v.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen page-bg ![background:var(--bg-secondary)]">
      {/* Hero */}
      <div className="relative text-center text-white ![background:linear-gradient(135deg,_#000_0%,_#0f172a_50%,_#1e293b_100%)] !p-[32px_20px_28px] !overflow-hidden">
        {journey.cover_image && (
          <div className="!absolute !inset-[0]" style={{ backgroundImage: `url(/uploads/${journey.cover_image})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.15 }} />
        )}
        <div className="!absolute !top-[-60px] !right-[-60px] !w-[200px] !h-[200px] !rounded-[50%] ![background:rgba(255,255,255,0.03)]" />
        <div className="!absolute !bottom-[-40px] !left-[-40px] !w-[150px] !h-[150px] !rounded-[50%] ![background:rgba(255,255,255,0.02)]" />

        {/* Language picker */}
        <div className="!absolute !top-[12px] !right-[12px] !z-[10]">
          <button className="!p-[5px_12px] !rounded-[20px] ![border:1px_solid_rgba(255,255,255,0.15)] ![background:rgba(255,255,255,0.1)] ![backdrop-filter:blur(8px)] ![color:rgba(255,255,255,0.7)] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={() => setShowLangPicker(v => !v)}>
            {SUPPORTED_LANGUAGES.find(l => l.value === (locale?.split('-')[0] || 'en'))?.label || 'Language'}
          </button>
          {showLangPicker && (
            <div className="!absolute !top-[100%] !right-[0] !mt-[6px] ![background:white] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.2)] !p-[4px] !z-[50] !min-w-[150px]">
              {SUPPORTED_LANGUAGES.map(lang => (
                <button className="trek-hover-gray !block !w-[100%] !p-[6px_12px] ![border:none] ![background:none] !text-left !cursor-pointer !text-[length:12px] ![color:#374151] !rounded-[6px] ![font-family:inherit]" key={lang.value} onClick={() => {
                  useSettingsStore.setState(s => ({ settings: { ...s.settings, language: lang.value } }))
                  setShowLangPicker(false)
                }} >{lang.label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Logo */}
        <div className="!inline-flex !items-center !justify-center !w-[44px] !h-[44px] !rounded-[12px] ![background:rgba(255,255,255,0.08)] ![backdrop-filter:blur(8px)] !mb-[12px] ![border:1px_solid_rgba(255,255,255,0.1)] !relative">
          <img src="/icons/icon-white.svg" alt="Trek Wanderer" width={26} height={26} />
        </div>

        <div className="!text-[length:10px] !font-[600] !tracking-[3px] !uppercase !mb-[12px] !relative" style={{ opacity: 0.35 }}>{t('journey.public.tagline')}</div>

        <h1 className="relative !m-[0_0_4px] !text-[length:26px] !font-[700] !tracking-[-0.5px]">{journey.title}</h1>

        {journey.subtitle && (
          <div className="relative !text-[length:13px] !max-w-[400px] !m-[0_auto] !leading-[1.5]" style={{ opacity: 0.5 }}>{journey.subtitle}</div>
        )}

        {/* Stats pill */}
        <div className="relative !mt-[12px] !inline-flex !items-center !gap-[12px] !p-[8px_18px] !rounded-[20px] ![background:rgba(255,255,255,0.08)] ![backdrop-filter:blur(4px)] ![border:1px_solid_rgba(255,255,255,0.08)]">
          <span className="!text-[length:12px] !font-[500] !flex !items-center !gap-[5px]" style={{ opacity: 0.8 }}><BookOpen size={12} /> {stats.entries} {t('journey.stats.entries')}</span>
          <span className="!text-[length:11px]" style={{ opacity: 0.4 }}>·</span>
          <span className="!text-[length:12px] !font-[500] !flex !items-center !gap-[5px]" style={{ opacity: 0.8 }}><Camera size={12} /> {stats.photos} {t('journey.stats.photos')}</span>
          <span className="!text-[length:11px]" style={{ opacity: 0.4 }}>·</span>
          <span className="!text-[length:12px] !font-[500] !flex !items-center !gap-[5px]" style={{ opacity: 0.8 }}><MapPin size={12} /> {stats.places} {t('journey.stats.places')}</span>
        </div>

        <div className="relative !mt-[12px] !text-[length:9px] !font-[500] !tracking-[1.5px] !uppercase" style={{ opacity: 0.25 }}>{t('journey.public.readOnly')}</div>
      </div>

      {/* Content */}
      {desktopTwoColumn ? (
        // ── Desktop two-column: scrollable timeline feed + sticky map ──────────
        <div className="max-w-[1440px] mx-auto flex !items-start">
          {/* Left: feed */}
          <div className="flex-1 xl:max-w-[50%] min-w-0 px-8 py-6">
            {renderTabs(availableViews)}
            {view === 'timeline' && perms.share_timeline && renderTimeline()}
            {view === 'gallery' && perms.share_gallery && renderGallery()}
            {view === 'book' && perms.share_book && renderBook()}
          </div>

          {/* Right: sticky map — matches auth page aside proportions */}
          <aside
            className="flex-shrink-0 !w-[44%] !min-w-[420px] !max-w-[760px] !sticky !top-[0] !h-[100dvh] !p-[16px_16px_16px_0] !self-start"
          >
            <div className="h-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <JourneyMap
                ref={mapRef}
                entries={sidebarMapItems as any}
                height={9999}
                fullScreen
                activeMarkerId={activeEntryId ?? undefined}
                onMarkerClick={handleMarkerClick}
              />
            </div>
          </aside>
        </div>
      ) : (
        // ── Single-column layout (mobile + desktop-without-map) ───────────────
        <div className="max-w-[900px] mx-auto px-4 md:px-8 py-6">

          {/* Floating view toggle — visible above the fullscreen map on mobile */}
          {isMobile && view === 'timeline' && perms.share_timeline && perms.share_map && availableViews.length > 1 && (
            <div className="fixed left-0 right-0 z-50 flex justify-center px-4 !top-[calc(env(safe-area-inset-top,_0px)_+_12px)]">
              <div className="flex bg-white/90 dark:bg-zinc-800/90 backdrop-blur-lg border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden shadow-lg">
                {availableViews.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className={`flex items-center gap-1.5 px-3 py-[7px] text-[12px] font-medium ${
                      view === v.id
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    <v.icon size={13} />
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {renderTabs(availableViews)}

          {/* Mobile combined map+timeline (public, read-only) */}
          {isMobile && view === 'timeline' && perms.share_timeline && perms.share_map && (
            <MobileMapTimeline
              entries={timelineEntries}
              mapEntries={sidebarMapItems as any}
              dark={document.documentElement.classList.contains('dark')}
              readOnly
              onEntryClick={(entry) => setViewingEntry(entry as any)}
              publicPhotoUrl={(photoId) => `/api/public/journey/${token}/photos/${photoId}/original`}
              carouselBottom="calc(env(safe-area-inset-bottom, 16px) + 8px)"
            />
          )}

          {/* Timeline (desktop, or mobile without map permission) */}
          {(!isMobile || !perms.share_map) && view === 'timeline' && perms.share_timeline && renderTimeline()}

          {/* Gallery */}
          {view === 'gallery' && perms.share_gallery && renderGallery()}

          {/* Map (standalone tab — only in single-column mode) */}
          {view === 'map' && perms.share_map && (
            <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700">
              <JourneyMap
                entries={sidebarMapItems as any}
                height={500}
              />
            </div>
          )}

          {/* Book */}
          {view === 'book' && perms.share_book && renderBook()}
        </div>
      )}

      {/* Powered by */}
      <div className="flex flex-col items-center py-8 gap-2">
        <div className="!inline-flex !items-center !gap-[8px] !p-[8px_16px] !rounded-[20px] ![background:white] ![border:1px_solid_#e5e7eb] ![box-shadow:0_1px_3px_rgba(0,0,0,0.04)]">
          <img className="!rounded-[4px]" src="/icons/icon-dark.svg" alt="Trek Wanderer" width={18} height={18} />
          <span className="!text-[length:11px] ![color:#9ca3af]">{t('journey.public.sharedVia')} <strong className="![color:#6b7280]">Trek Wanderer</strong></span>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Mobile entry detail view (public share) */}
      {viewingEntry && (
        <MobileEntryView
          entry={viewingEntry as any}
          readOnly
          publicPhotoUrl={(photoId) => `/api/public/journey/${token}/photos/${photoId}/original`}
          onClose={() => setViewingEntry(null)}
          onEdit={() => {}}
          onDelete={() => {}}
          onPhotoClick={(photos, idx) => setLightbox({
            photos: photos.map(p => ({
              id: String(p.id),
              src: photoUrl(p as any, token!, 'original'),
              caption: (p as any).caption ?? null,
            })),
            index: idx,
          })}
        />
      )}
    </div>
  )
}

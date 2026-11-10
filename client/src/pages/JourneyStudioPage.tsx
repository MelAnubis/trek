import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { markdownToPlainText } from '../components/Journey/stripMarkdown'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Clipboard, ClipboardPaste, Lock, Minus, Plus, Printer, Redo2, RefreshCw, Sparkles, Undo2 } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useJourneyStore } from '../store/journeyStore'
import { useSettingsStore } from '../store/settingsStore'
import { useStudioStore } from '../store/studioStore'
import { useBookStore } from '../components/Studio/useBookStore'
import { useBookPresence } from '../components/Studio/useBookPresence'
import { PeerBadges } from '../components/Studio/PeerBadges'
import { StudioCanvas } from '../components/Studio/StudioCanvas'
import { StudioSidebar } from '../components/Studio/StudioSidebar'
import { StudioInspector } from '../components/Studio/StudioInspector'
import { StudioExport } from '../components/Studio/StudioExport'
import { PrintOrderModal } from '../components/Studio/PrintOrderModal'
// Side-effect only: bundles the book's self-hosted @fontsource CSS/woff2
// files into this page's chunk, so both the live canvas and (via
// printSheets.ts's collectStyles(), which clones every stylesheet already
// on the page) the print/export pipeline have every book font available
// with no external CDN request.
import '../components/Studio/bookFonts'
import { buildBook, emptyBook, relayoutSpread, type AutoInput } from '../components/Studio/autoLayout'
import { layoutWithTheme } from '../components/Studio/bookTheme'
import { PAGE_PRESETS, pageSetupFor } from '../components/Studio/pagePresets'
import { PageFormatMenu } from '../components/Studio/PageFormatMenu'
import { AutoLayoutMenu, readAutoStyle, type AutoStyle } from '../components/Studio/AutoLayoutMenu'
import type { EditorialDesign } from '../components/Studio/editorialLayouts'
import { resolveBindings, type BindingSource } from '../components/Studio/resolveBindings'
import type { BookPageSetup } from '../types/book'
import { buildRouteImagesByDate, buildOverviewRouteImages } from '../components/Studio/buildRouteImages'
import { fetchJourneyGpxTracks } from '../components/Journey/journeyGpx'
import { fetchJourneyPlaces } from '../components/Journey/journeyPlaces'
import { fetchJourneyPacking } from '../components/Journey/journeyPacking'
import { fetchJourneyAccommodations } from '../components/Journey/journeyAccommodations'
import { DEFAULT_TILE_URL, buildRouteMapImage, computeRouteStats, groupTracksByDate, type PdfGpxTrack } from '../components/PDF/gpxDrawing'
import { useToast } from '../components/shared/Toast'
import { healthApi } from '../api/client'

/**
 * TREK Studio — editing canvas, auto layout from the journal, travel
 * elements (map/stats/places/badge/icon/list — see TravelElements.tsx),
 * print export, and real-time multi-cursor presence. See autoLayout.ts for
 * why "the whole book" is built from the 12 programmatic templates rather
 * than upstream's hand-drawn set.
 */

/** Base CSS px-per-mm; StudioCanvas multiplies this by the zoom level. */
const BASE_PX_PER_MM = 96 / 25.4
const ZOOM_STEPS = [0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1]

export default function JourneyStudioPage() {
  const { id } = useParams()
  const journeyId = Number(id)
  const navigate = useNavigate()
  const { t, locale } = useTranslation()

  const current = useJourneyStore(s => s.current)
  const loadJourney = useJourneyStore(s => s.loadJourney)
  const toast = useToast()

  const doc = useStudioStore(s => s.doc)
  const loadDoc = useStudioStore(s => s.load)
  const resetDoc = useStudioStore(s => s.reset)
  const commit = useStudioStore(s => s.commit)
  const activeSpread = useStudioStore(s => s.activeSpread)
  const undo = useStudioStore(s => s.undo)
  const redo = useStudioStore(s => s.redo)
  const canUndo = useStudioStore(s => s.canUndo())
  const canRedo = useStudioStore(s => s.canRedo())
  const selection = useStudioStore(s => s.selection)
  const clipboard = useStudioStore(s => s.clipboard)
  const copySelection = useStudioStore(s => s.copy)
  const pasteClipboard = useStudioStore(s => s.paste)
  const setDocPagePreset = useStudioStore(s => s.setPagePreset)
  const setDocPageSize = useStudioStore(s => s.setPageSize)
  const setDocPageEdge = useStudioStore(s => s.setPageEdge)

  const [zoom, setZoom] = useState(0.4)
  // Fit the spread to the viewport until the user picks a zoom themselves;
  // a page-size change re-arms it, since the old zoom was chosen for a sheet
  // that no longer exists (an A4 landscape spread at A5's zoom overflows).
  const [autoFit, setAutoFit] = useState(true)
  // After a trim-size change: offer to lay the whole book out again for the
  // new format (the same Auto layout → whole book action), since a reflow
  // keeps the old composition and a 30×30 layout is rarely the right A5 one.
  const [resizeNotice, setResizeNotice] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [showExport, setShowExport] = useState(false)
  const [showPrintOrder, setShowPrintOrder] = useState(false)
  const [printOnDemandAvailable, setPrintOnDemandAvailable] = useState(false)
  const [autoBookBuilding, setAutoBookBuilding] = useState(false)
  const [autoStyle, setAutoStyle] = useState<AutoStyle>(readAutoStyle)
  const [pagePreset, setPagePreset] = useState<BookPageSetup['preset']>('square-210')
  const [customPage, setCustomPage] = useState({ pageWidth: 210, pageHeight: 210, bleed: 3 })
  // Per-viewer editing convenience, not part of the document — whether the
  // spread fold is drawn, same as upstream's own bookView toggle.
  const [bookView, setBookView] = useState(true)
  const mapTileUrl = useSettingsStore(s => s.settings.map_tile_url) || undefined

  const [gpxTracks, setGpxTracks] = useState<PdfGpxTrack[]>([])
  const linkedTripIds = (current?.trips || []).map((t: any) => t.trip_id).join(',')
  useEffect(() => {
    if (!linkedTripIds) { setGpxTracks([]); return }
    let cancelled = false
    fetchJourneyGpxTracks(current!.trips).then(tracks => { if (!cancelled) setGpxTracks(tracks) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedTripIds])

  useEffect(() => {
    healthApi.features().then(f => setPrintOnDemandAvailable(f.printOnDemand)).catch(() => {})
  }, [])

  const { record, loaded: bookLoaded, state, queueSave, saveNow, acceptTheirs, keepMine } = useBookStore(journeyId, loadDoc)
  const { peers, cursors, moveCursor } = useBookPresence(journeyId)

  // A book saved by a newer Studio, or one this user may only view: on screen,
  // closed to every change (the store's commit/apply refuse while readOnly).
  const setReadOnly = useStudioStore(s => s.setReadOnly)
  const readOnly = state.status === 'newer' || state.status === 'readonly'
  useEffect(() => { setReadOnly(readOnly) }, [readOnly, setReadOnly])
  useEffect(() => () => setReadOnly(false), [setReadOnly])

  const builtRef = useRef({ built: false })

  // Navigating from one journey's Studio straight to another's reuses this
  // same page instance (only the :id route param changes) — without this,
  // builtRef stayed "built" from the previous journey forever, so the load
  // effect below never re-ran and the previous journey's book stayed on
  // screen (and open to edits, autosaving straight over the new journey's
  // book) until a full page reload. Re-arm the gate and clear the stale
  // document the instant the id changes, before the new journey's book has
  // even arrived.
  useEffect(() => {
    builtRef.current.built = false
    resetDoc()
  }, [journeyId, resetDoc])

  useEffect(() => {
    if (!Number.isFinite(journeyId)) return
    if (!current || current.id !== journeyId) void loadJourney(journeyId)
  }, [journeyId, current, loadJourney])

  // Load the stored book once it arrives — an existing book always wins
  // over a fresh document. Runs once per journey; re-running it on every
  // record change would throw away the user's in-progress work. Waits for
  // the journey itself so bound text (see resolveBindings.ts) resolves
  // against real journal data on this first read, not an empty one — a
  // binding whose source is still missing is left untouched anyway (rule
  // one there), so this never risks blanking a page, only delays it.
  useEffect(() => {
    if (!bookLoaded || builtRef.current.built) return
    if (!current || current.id !== journeyId) return
    if (record) {
      loadDoc(bindingSource ? resolveBindings(record.document, bindingSource, locale) : record.document)
    }
    builtRef.current.built = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookLoaded, record, current, journeyId])

  // Autosave: every doc change is queued, debounced inside useBookStore.
  useEffect(() => {
    if (!doc || !bookLoaded) return
    queueSave(doc, current?.title || '')
  }, [doc, bookLoaded, queueSave, current?.title])

  const backToJourney = () => {
    void saveNow()
    navigate(isMagazine ? '/journey' : `/journey/${journeyId}`)
  }

  const createBook = () => loadDoc(emptyBook(pageSetupFor(pagePreset, customPage), current?.title || ''))

  const galleryPhotos = useMemo(() =>
    (current?.gallery || []).map(p => ({ photoId: p.photo_id, caption: p.caption ?? null, taken_at: p.taken_at, created_at: p.created_at })),
    [current])

  // What a bound text element reads back from — see resolveBindings.ts.
  // Built from the same journal fields autoInput draws from, plus lat/lng
  // (autoInput has no use for those) so an `entry.location` binding set to
  // a coordinate format can tell whether the point itself moved.
  const bindingSource: BindingSource | null = useMemo(() => {
    if (!current) return null
    const entries = (current.entries || []).filter(e => e.type !== 'skeleton')
    return {
      title: current.title,
      subtitle: current.subtitle || null,
      entries: entries.map(e => ({
        id: e.id,
        title: e.title ?? null,
        story: markdownToPlainText(e.story),
        location: e.location_name ?? null,
        date: e.entry_date ?? null,
        lat: e.location_lat ?? null,
        lng: e.location_lng ?? null,
        country: e.country_code ?? null,
      })),
      photos: galleryPhotos.map(p => ({ photoId: p.photoId, caption: p.caption })),
    }
  }, [current, galleryPhotos])

  // Reuses gpxDrawing's own canvas map renderer — the same one auto-layout's
  // route spread already draws with — rather than a second map-rendering
  // path, for a manually-added `map` travel element (see BookMapElement's
  // own comment on why this fork bakes a snapshot instead of a live map).
  const generateMapImage = async (): Promise<string | null> => {
    if (!current) return null
    const entries = (current.entries || []).filter(e => e.type !== 'skeleton')
    return buildRouteMapImage(entries, gpxTracks, mapTileUrl || DEFAULT_TILE_URL).catch(() => null)
  }

  // The journey's own places — from its linked trips' real place data, not
  // every place in the app (see StudioSidebar's own comment on why).
  const generatePlacesList = async (): Promise<{ name: string; note?: string }[]> => {
    if (!current?.trips?.length) return []
    return fetchJourneyPlaces(current.trips).catch(() => [])
  }

  // The journey's own packing list / stays — same per-trip fetch pattern as
  // generatePlacesList above.
  const generatePackingList = async () => {
    if (!current?.trips?.length) return []
    return fetchJourneyPacking(current.trips).catch(() => [])
  }
  const generateAccommodationsList = async () => {
    if (!current?.trips?.length) return []
    return fetchJourneyAccommodations(current.trips).catch(() => [])
  }

  // A magazine (kind 'magazine') was laid out from other journeys and stories
  // (MagazineDialog): it has no journal of its own to auto-layout from, so
  // Auto layout stays off rather than rebuilding it into an empty book.
  const isMagazine = (current as { kind?: string } | null)?.kind === 'magazine'

  const autoInput: AutoInput | null = useMemo(() => {
    if (!current || !doc || isMagazine) return null
    const entries = (current.entries || []).filter(e => e.type !== 'skeleton')
    const allPhotos = entries.flatMap(e => e.photos || [])
    const withContent = entries.filter(e => (e.photos?.length || 0) > 0 || !!e.story?.trim())
    const days = new Set(withContent.map(e => e.entry_date).filter(Boolean)).size
    const routeStats = gpxTracks.length ? computeRouteStats(gpxTracks) : null
    return {
      locale,
      title: current.title,
      subtitle: current.subtitle || null,
      coverPhotoId: allPhotos[0]?.photo_id ?? null,
      entries: entries.map(e => ({
        id: e.id,
        title: e.title ?? null,
        story: markdownToPlainText(e.story),
        location: e.location_name ?? null,
        date: e.entry_date ?? null,
        photos: (e.photos || []).map(p => ({ photoId: p.photo_id, width: p.width ?? null, height: p.height ?? null })),
        prosCons: e.pros_cons ?? null,
        lat: e.location_lat ?? null,
        lng: e.location_lng ?? null,
        country: e.country_code ?? null,
      })),
      page: doc.page,
      stationsLabel: t('journey.studio.stations'),
      style: autoStyle,
      dayLabel: t('journey.studio.dayLabel'),
      journeyStats: {
        days,
        entries: current.stats?.entries ?? withContent.length,
        photos: current.stats?.photos ?? allPhotos.length,
        places: current.stats?.places ?? 0,
        countries: current.stats?.countries,
        countryCodes: current.stats?.countryCodes,
        distanceKm: routeStats?.totalDist,
        elevationGainM: routeStats?.gain,
        elevationLossM: routeStats?.loss,
        budgetTotal: current.stats?.budgetTotal,
        budgetCurrency: current.stats?.budgetCurrency,
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, doc?.page, locale, gpxTracks, t, autoStyle, isMagazine])

  const spread = doc?.spreads[activeSpread] ?? null

  /** The page just laid out, in the book's theme — folded into the same undo step as the layout. */
  const commitThemed = (spreadId: string) => {
    const store = useStudioStore.getState()
    const d = store.doc
    if (!d?.theme) return
    const themed = layoutWithTheme(d, d.theme, [spreadId])
    if (themed !== d) store.apply(() => themed)
  }

  const handleAutoSpread = () => {
    if (!autoInput || !spread) return
    commit(d => ({
      ...d,
      spreads: d.spreads.map((sp, i) => (i !== activeSpread ? sp : relayoutSpread(sp, autoInput, activeSpread) ?? sp)),
    }))
    // Dressed in the book's theme, when it has one (bookTheme.ts).
    commitThemed(spread.id)
    toast.success(t('journey.studio.autoLayoutDone'))
  }

  const handleDesign = (design: EditorialDesign) => {
    if (!autoInput || !spread?.entryId) return
    commit(d => ({
      ...d,
      spreads: d.spreads.map((sp, i) => (i !== activeSpread ? sp : relayoutSpread(sp, autoInput, activeSpread, design) ?? sp)),
    }))
    commitThemed(spread.id)
  }

  const handleAutoBook = async () => {
    if (!autoInput) return
    if (!window.confirm(t('journey.studio.autoLayoutBookConfirm'))) return
    setAutoBookBuilding(true)
    try {
      // Route images need a network round-trip per day (map tiles) — buildBook
      // itself stays synchronous and just takes whatever came back, same
      // split JourneyBookPDF.tsx already has between fetching tracks and
      // laying out the route pages.
      const knownDates = [...new Set(autoInput.entries.map(e => e.date).filter((d): d is string => !!d))].sort()
      const tileUrl = mapTileUrl || DEFAULT_TILE_URL
      let routeImagesByDate: Awaited<ReturnType<typeof buildRouteImagesByDate>> | undefined
      let overviewRoute: Awaited<ReturnType<typeof buildOverviewRouteImages>> = null
      if (gpxTracks.length) {
        // Same day-matching JourneyBookPDF.tsx's own overview/day-page split
        // uses: a track that couldn't be tied to one specific day (no gpx
        // file per jornada) never gets a per-day route spread of its own —
        // it (or, when some tracks did match, whatever's left over) goes
        // into the closing summary's map instead, so the book still shows
        // the real route somewhere rather than silently dropping it.
        const { byDate, unmatched } = groupTracksByDate(gpxTracks, knownDates)
        if (byDate.size > 0) {
          routeImagesByDate = await buildRouteImagesByDate(gpxTracks, knownDates, tileUrl)
          if (unmatched.length > 0) overviewRoute = await buildOverviewRouteImages(unmatched, tileUrl)
        } else {
          overviewRoute = await buildOverviewRouteImages(gpxTracks, tileUrl)
        }
      }
      commit(d => layoutWithTheme(buildBook({ ...autoInput, routeImagesByDate, overviewRoute }), d.theme))
      setResizeNotice(false)
      toast.success(t('journey.studio.autoLayoutDone'))
    } finally {
      setAutoBookBuilding(false)
    }
  }
  // The sheet's on-screen size at zoom 1, in CSS px (see StudioCanvas: the
  // sheet is pageWidth (×2 for an inner spread) by pageHeight millimetres).
  const sheetWmm = doc ? (spread && spread.role === 'inner' ? doc.page.pageWidth * 2 : doc.page.pageWidth) : 0
  const sheetHmm = doc?.page.pageHeight ?? 0
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!autoFit || !el || !sheetWmm || !sheetHmm) return
    const fit = () => {
      const pad = 80 // the viewport's own 40px padding on each side
      const z = Math.min((el.clientWidth - pad) / (sheetWmm * BASE_PX_PER_MM), (el.clientHeight - pad) / (sheetHmm * BASE_PX_PER_MM))
      if (Number.isFinite(z) && z > 0) setZoom(Math.round(Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], z)) * 100) / 100)
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [autoFit, sheetWmm, sheetHmm])

  const zoomIndex = ZOOM_STEPS.reduce((best, z, i) => (Math.abs(z - zoom) < Math.abs(ZOOM_STEPS[best] - zoom) ? i : best), 0)

  const font: React.CSSProperties = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }

  const saveLabel = state.status === 'saving' ? t('journey.studio.saveSaving')
    : state.status === 'saved' ? t('journey.studio.saveSaved')
    : state.status === 'error' ? t('journey.studio.saveError')
    : state.status === 'readonly' ? t('journey.studio.saveReadonly')
    : state.status === 'newer' ? t('journey.studio.saveNewer')
    : ''

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', ...font }}>
      {/* Header */}
      <div className="!flex !items-center !justify-between !p-[10px_16px] ![border-bottom:1px_solid_var(--border-secondary)] !shrink-[0]">
        <button className="!flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={backToJourney}>
          <ArrowLeft size={15} /> {t('journey.studio.backToJourney')}
        </button>

        <div className="!flex !items-center !gap-[8px]">
          <BookOpen size={16} color="var(--text-muted)" />
          <span className="!text-[length:14px] !font-[700] ![color:var(--text-primary)]">{t('journey.studio.title')}</span>
          <span className="!p-[2px_8px] !rounded-[99px] !text-[length:10px] !font-[700] !uppercase !tracking-[0.04em] ![background:var(--bg-tertiary)] ![color:var(--text-faint)]">{t('journey.studio.betaBadge')}</span>
        </div>

        <div className="!flex !items-center !gap-[10px]">
          <PeerBadges peers={peers} t={t} />
          {doc && (
            <button className="!flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[10px] ![color:var(--text-primary)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={() => setBookView(v => !v)} aria-pressed={bookView} title={t('journey.studio.bookView')} style={{ border: bookView ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: bookView ? 'var(--bg-tertiary)' : 'none' }}>
              <BookOpen size={14} /> {t('journey.studio.bookView')}
            </button>
          )}
          {doc && (
            <PageFormatMenu
              page={doc.page}
              t={t}
              onPreset={(preset, reflow) => { if (preset !== doc.page.preset) setResizeNotice(true); setDocPagePreset(preset, reflow); setAutoFit(true) }}
              onSize={(axis, v, reflow) => { setResizeNotice(true); setDocPageSize(axis, v, reflow); setAutoFit(true) }}
              onEdge={(which, v, reflow) => setDocPageEdge(which, v, reflow)}
            />
          )}
          {doc && autoInput && (
            <AutoLayoutMenu
              t={t}
              style={autoStyle}
              onStyle={setAutoStyle}
              canSpread={!!spread?.entryId}
              building={autoBookBuilding}
              onSpread={handleAutoSpread}
              onDesign={handleDesign}
              onBook={() => { void handleAutoBook() }}
            />
          )}
          {doc && (
            <>
              <button className="!w-[30px] !h-[30px] !flex !items-center !justify-center !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)]" onClick={undo} disabled={!canUndo} title={t('journey.studio.undo')}
                style={{ cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.4 }}>
                <Undo2 size={14} />
              </button>
              <button className="!w-[30px] !h-[30px] !flex !items-center !justify-center !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)]" onClick={redo} disabled={!canRedo} title={t('journey.studio.redo')}
                style={{ cursor: canRedo ? 'pointer' : 'default', opacity: canRedo ? 1 : 0.4 }}>
                <Redo2 size={14} />
              </button>
              <button className="!w-[30px] !h-[30px] !flex !items-center !justify-center !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)]" onClick={() => copySelection(activeSpread, selection)} disabled={!selection.length} title={t('journey.studio.copy')}
                style={{ cursor: selection.length ? 'pointer' : 'default', opacity: selection.length ? 1 : 0.4 }}>
                <Clipboard size={14} />
              </button>
              <button className="!w-[30px] !h-[30px] !flex !items-center !justify-center !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)]" onClick={() => pasteClipboard(activeSpread)} disabled={!clipboard.length} title={t('journey.studio.paste')}
                style={{ cursor: clipboard.length ? 'pointer' : 'default', opacity: clipboard.length ? 1 : 0.4 }}>
                <ClipboardPaste size={14} />
              </button>
              <button className="!flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[10px] ![border:none] ![background:var(--text-primary)] ![color:var(--bg-primary)] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]" onClick={() => { void saveNow(); setShowExport(true) }} title={t('journey.studio.export')}>
                <Printer size={14} /> {t('journey.studio.export')}
              </button>
            </>
          )}
          {saveLabel && (
            <span className="!text-[length:11px] !min-w-[60px]" style={{ color: state.status === 'error' ? '#dc2626' : 'var(--text-faint)' }}>{saveLabel}</span>
          )}
        </div>
      </div>

      {!bookLoaded ? (
        <div className="!flex-[1] !flex !justify-center !items-center">
          <div className="w-8 h-8 border-2 rounded-full animate-spin ![border-color:var(--border-primary)] ![border-top-color:var(--text-primary)]" />
        </div>
      ) : !doc ? (
        <div className="!flex-[1] !flex !flex-col !items-center !justify-center !p-[80px_20px] !text-center">
          <BookOpen size={40} style={{ color: 'var(--text-faint)', marginBottom: 14 }} />
          <h2 className="!m-[0_0_6px] !text-[length:18px] !font-[700] ![color:var(--text-primary)]">
            {t('journey.studio.emptyTitle')}
          </h2>
          <p className="!m-[0_0_20px] !text-[length:13px] ![color:var(--text-muted)] !max-w-[380px] !leading-[1.5]">
            {t('journey.studio.emptyHint')}
          </p>

          <div className="!mb-[20px]">
            <div className="!text-[length:11px] !font-[700] !uppercase !tracking-[0.05em] ![color:var(--text-faint)] !mb-[8px]">
              {t('journey.studio.pageSize')}
            </div>
            <div className="!flex !flex-wrap !gap-[6px] !justify-center !max-w-[420px]">
              {(Object.keys(PAGE_PRESETS) as (keyof typeof PAGE_PRESETS)[]).map(key => (
                <button className="!p-[7px_12px] !rounded-[8px] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-primary)]" key={key} onClick={() => setPagePreset(key)} aria-pressed={pagePreset === key} style={{ border: pagePreset === key ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: pagePreset === key ? 'var(--bg-tertiary)' : 'none' }}>
                  {t(PAGE_PRESETS[key].labelKey)}
                </button>
              ))}
              <button className="!p-[7px_12px] !rounded-[8px] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-primary)]" onClick={() => setPagePreset('custom')} aria-pressed={pagePreset === 'custom'} style={{ border: pagePreset === 'custom' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: pagePreset === 'custom' ? 'var(--bg-tertiary)' : 'none' }}>
                {t('journey.studio.pagePreset.custom')}
              </button>
            </div>

            {pagePreset === 'custom' && (
              <div className="!flex !gap-[8px] !justify-center !mt-[10px]">
                {(['pageWidth', 'pageHeight', 'bleed'] as const).map(field => (
                  <label className="!flex !flex-col !gap-[3px] !text-[length:10px] ![color:var(--text-faint)]" key={field}>
                    {t(`journey.studio.pageField.${field}`)}
                    <input className="!w-[72px] !p-[6px_8px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] ![font-family:inherit] !text-[length:12px]"
                      type="number" min={0} step={0.1} value={customPage[field]}
                      onChange={e => setCustomPage(c => ({ ...c, [field]: Number(e.target.value) || 0 }))}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <button className="!p-[10px_20px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[600] !cursor-pointer ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={createBook}>
            {t('journey.studio.createBook')}
          </button>
        </div>
      ) : (
        <div className="!flex-[1] !flex !min-h-[0]">
          <StudioSidebar journeyId={journeyId} galleryPhotos={galleryPhotos} journeyStats={autoInput?.journeyStats} onGenerateMap={generateMapImage} onGeneratePlaces={generatePlacesList} onGeneratePacking={generatePackingList} onGenerateAccommodations={generateAccommodationsList} />

          <div className="!flex-[1] !flex !flex-col !min-w-[0]">
            {state.status === 'newer' && (
              <div className="!flex !items-center !gap-[10px] !flex-wrap !p-[8px_14px] !shrink-[0] ![border-bottom:1px_solid_#f59e0b] ![background:rgba(245,158,11,0.12)] !text-[length:12px] ![color:var(--text-primary)]" role="alert" data-testid="newer-notice">
                <Lock size={14} style={{ flexShrink: 0 }} />
                <span className="!flex-[1] !min-w-[200px]">{t('journey.studio.newerNotice')}</span>
                <button className="!flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[8px] ![border:none] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={() => window.location.reload()}>
                  <RefreshCw size={13} /> {t('journey.studio.reload')}
                </button>
              </div>
            )}
            {resizeNotice && (
              <div className="!flex !items-center !gap-[10px] !flex-wrap !p-[8px_14px] !shrink-[0] ![border-bottom:1px_solid_var(--border-secondary)] ![background:var(--bg-tertiary)] !text-[length:12px] ![color:var(--text-primary)]" role="status" data-testid="resize-notice">
                <span className="!flex-[1] !min-w-[200px]">
                  {t('journey.studio.resizeNotice', { w: Math.round(doc.page.pageWidth * 10) / 10, h: Math.round(doc.page.pageHeight * 10) / 10 })}
                </span>
                {autoInput && (
                  <button className="!flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[8px] ![border:none] !text-[length:12px] !font-[600] ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={handleAutoBook} disabled={autoBookBuilding} style={{ cursor: autoBookBuilding ? 'default' : 'pointer', opacity: autoBookBuilding ? 0.6 : 1 }}>
                    <Sparkles size={13} /> {t('journey.studio.relayoutBook')}
                  </button>
                )}
                <button className="!p-[6px_10px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setResizeNotice(false)}>
                  {t('journey.studio.keepLayout')}
                </button>
              </div>
            )}
            <div ref={viewportRef} style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div className="![box-shadow:0_8px_32px_rgba(0,0,0,0.18)] !rounded-[4px] !overflow-hidden">
                <StudioCanvas
                  spread={spread}
                  spreadIndex={activeSpread}
                  page={doc.page}
                  zoom={zoom}
                  pxPerMm={BASE_PX_PER_MM}
                  bookView={bookView}
                  dropLabel={t('journey.studio.dropLabel')}
                  cursors={cursors}
                  onCursor={(x, y) => moveCursor(activeSpread, x, y)}
                />
              </div>
            </div>

            {/* Zoom */}
            <div className="!flex !items-center !justify-center !gap-[10px] !p-[8px_16px] ![border-top:1px_solid_var(--border-secondary)] !shrink-[0]">
              <button className="!w-[26px] !h-[26px] !flex !items-center !justify-center !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={() => { setAutoFit(false); setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)]) }}>
                <Minus size={13} />
              </button>
              <span className="!text-[length:12px] ![color:var(--text-muted)] !min-w-[40px] !text-center">{Math.round(zoom * 100)}%</span>
              <button className="!w-[26px] !h-[26px] !flex !items-center !justify-center !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={() => { setAutoFit(false); setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)]) }}>
                <Plus size={13} />
              </button>
              <button className="!h-[26px] !p-[0_9px] !flex !items-center !rounded-[6px] !text-[length:11px] ![font-family:inherit] !cursor-pointer ![color:var(--text-muted)]" onClick={() => setAutoFit(true)} aria-pressed={autoFit} title={t('journey.studio.zoomFit')}
                style={{ border: autoFit ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: autoFit ? 'var(--bg-tertiary)' : 'none' }}>
                {t('journey.studio.zoomFit')}
              </button>
            </div>
          </div>

          <StudioInspector spreadIndex={activeSpread} />
        </div>
      )}

      {/* Conflict modal */}
      {state.status === 'conflict' && (
        <div className="!fixed !inset-[0] !z-[1000] ![background:rgba(0,0,0,0.5)] !flex !items-center !justify-center !p-[20px]">
          <div className="![background:var(--bg-card)] !rounded-[16px] !p-[24px] !max-w-[400px] !w-[100%]">
            <h3 className="!m-[0_0_8px] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">{t('journey.studio.saveConflictTitle')}</h3>
            <p className="!m-[0_0_20px] !text-[length:13px] ![color:var(--text-muted)] !leading-[1.5]">{t('journey.studio.saveConflictHint')}</p>
            <div className="!flex !gap-[8px] !justify-end">
              <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:13px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => { const d = acceptTheirs(state.current); loadDoc(d) }}>
                {t('journey.studio.takeTheirs')}
              </button>
              <button className="!p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[600] !cursor-pointer ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={() => keepMine(state.current)}>
                {t('journey.studio.keepMine')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExport && doc && (
        <StudioExport doc={doc} title={current?.title || doc.title} onClose={() => setShowExport(false)}
          printOnDemandAvailable={printOnDemandAvailable}
          onOrderPrint={() => { setShowExport(false); setShowPrintOrder(true) }} />
      )}

      {showPrintOrder && doc && (
        <PrintOrderModal journeyId={journeyId} title={current?.title || doc.title} doc={doc} onClose={() => setShowPrintOrder(false)} />
      )}

    </div>
  )
}

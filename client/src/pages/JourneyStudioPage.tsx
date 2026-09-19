import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Minus, Plus, Printer, Redo2, Sparkles, Undo2 } from 'lucide-react'
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
import { BOOK_FONTS_GOOGLE_HREF } from '../components/Studio/bookFonts'
import { buildBook, emptyBook, relayoutSpread, type AutoInput } from '../components/Studio/autoLayout'
import { buildRouteImagesByDate } from '../components/Studio/buildRouteImages'
import { fetchJourneyGpxTracks } from '../components/Journey/journeyGpx'
import { DEFAULT_TILE_URL, type PdfGpxTrack } from '../components/PDF/gpxDrawing'
import { useToast } from '../components/shared/Toast'

/**
 * TREK Studio — Phase 2 (editing canvas) + Phase 3 (auto layout from the
 * journal) + Phase 4 (print export). The travel-specific elements (route
 * maps, country lists, stat badges) and real-time multi-cursor presence
 * are the remaining, explicitly deferred pieces — see autoLayout.ts for
 * why "the whole book" is built from the 12 programmatic templates rather
 * than upstream's hand-drawn set.
 */

const DEFAULT_PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

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

  const [zoom, setZoom] = useState(0.4)
  const [showExport, setShowExport] = useState(false)
  const [autoBookBuilding, setAutoBookBuilding] = useState(false)
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

  const { record, loaded: bookLoaded, state, queueSave, saveNow, acceptTheirs, keepMine } = useBookStore(journeyId, loadDoc)
  const { peers, cursors, moveCursor } = useBookPresence(journeyId)

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
  // record change would throw away the user's in-progress work.
  useEffect(() => {
    if (!bookLoaded || builtRef.current.built) return
    if (record) {
      loadDoc(record.document)
    }
    builtRef.current.built = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookLoaded, record])

  // Autosave: every doc change is queued, debounced inside useBookStore.
  useEffect(() => {
    if (!doc || !bookLoaded) return
    queueSave(doc, current?.title || '')
  }, [doc, bookLoaded, queueSave, current?.title])

  const backToJourney = () => {
    void saveNow()
    navigate(`/journey/${journeyId}`)
  }

  const createBook = () => loadDoc(emptyBook(DEFAULT_PAGE, current?.title || ''))

  const galleryPhotos = useMemo(() =>
    (current?.gallery || []).map(p => ({ photoId: p.photo_id, caption: p.caption ?? null, taken_at: p.taken_at, created_at: p.created_at })),
    [current])

  const autoInput: AutoInput | null = useMemo(() => {
    if (!current || !doc) return null
    const entries = (current.entries || []).filter(e => e.type !== 'skeleton')
    const allPhotos = entries.flatMap(e => e.photos || [])
    const withContent = entries.filter(e => (e.photos?.length || 0) > 0 || !!e.story?.trim())
    const days = new Set(withContent.map(e => e.entry_date).filter(Boolean)).size
    return {
      locale,
      title: current.title,
      subtitle: current.subtitle || null,
      coverPhotoId: allPhotos[0]?.photo_id ?? null,
      entries: entries.map(e => ({
        id: e.id,
        title: e.title ?? null,
        story: e.story ?? null,
        location: e.location_name ?? null,
        date: e.entry_date ?? null,
        photos: (e.photos || []).map(p => ({ photoId: p.photo_id })),
      })),
      page: doc.page,
      journeyStats: {
        days,
        entries: current.stats?.entries ?? withContent.length,
        photos: current.stats?.photos ?? allPhotos.length,
        places: current.stats?.places ?? 0,
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, doc?.page, locale])

  const spread = doc?.spreads[activeSpread] ?? null

  const handleAutoSpread = () => {
    if (!autoInput || !spread) return
    commit(d => ({
      ...d,
      spreads: d.spreads.map((sp, i) => (i !== activeSpread ? sp : relayoutSpread(sp, autoInput, activeSpread) ?? sp)),
    }))
    toast.success(t('journey.studio.autoLayoutDone'))
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
      const routeImagesByDate = gpxTracks.length
        ? await buildRouteImagesByDate(gpxTracks, knownDates, mapTileUrl || DEFAULT_TILE_URL)
        : undefined
      commit(() => buildBook({ ...autoInput, routeImagesByDate }))
      toast.success(t('journey.studio.autoLayoutDone'))
    } finally {
      setAutoBookBuilding(false)
    }
  }
  const zoomIndex = ZOOM_STEPS.reduce((best, z, i) => (Math.abs(z - zoom) < Math.abs(ZOOM_STEPS[best] - zoom) ? i : best), 0)

  const font: React.CSSProperties = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }

  const saveLabel = state.status === 'saving' ? t('journey.studio.saveSaving')
    : state.status === 'saved' ? t('journey.studio.saveSaved')
    : state.status === 'error' ? t('journey.studio.saveError')
    : state.status === 'readonly' ? t('journey.studio.saveReadonly')
    : ''

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', ...font }}>
      <link rel="stylesheet" href={BOOK_FONTS_GOOGLE_HREF} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border-secondary)', flexShrink: 0,
      }}>
        <button onClick={backToJourney} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10,
          border: '1px solid var(--border-primary)', background: 'none', color: 'var(--text-muted)',
          fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <ArrowLeft size={15} /> {t('journey.studio.backToJourney')}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={16} color="var(--text-muted)" />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('journey.studio.title')}</span>
          <span style={{
            padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            background: 'var(--bg-tertiary)', color: 'var(--text-faint)',
          }}>{t('journey.studio.betaBadge')}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PeerBadges peers={peers} t={t} />
          {doc && autoInput && (
            <div className="relative group" style={{ position: 'relative' }}>
              <button style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10,
                border: '1px solid var(--border-primary)', background: 'none', color: 'var(--text-muted)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <Sparkles size={14} /> {t('journey.studio.autoLayout')}
              </button>
              <div className="st-auto-menu" style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 160, borderRadius: 10,
                border: '1px solid var(--border-primary)', background: 'var(--bg-card)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                padding: 4, zIndex: 20, opacity: 0, visibility: 'hidden', transition: 'opacity 0.1s',
              }}>
                <button onClick={handleAutoSpread} disabled={!spread?.entryId}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'none', fontSize: 12, cursor: spread?.entryId ? 'pointer' : 'default', opacity: spread?.entryId ? 1 : 0.4, color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                  {t('journey.studio.autoLayoutSpread')}
                </button>
                <button onClick={handleAutoBook} disabled={autoBookBuilding}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'none', fontSize: 12, cursor: autoBookBuilding ? 'default' : 'pointer', opacity: autoBookBuilding ? 0.5 : 1, color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                  {autoBookBuilding ? t('journey.studio.autoLayoutBookBuilding') : t('journey.studio.autoLayoutBook')}
                </button>
              </div>
            </div>
          )}
          {doc && (
            <>
              <button onClick={undo} disabled={!canUndo} title={t('journey.studio.undo')}
                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'none', cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.4, color: 'var(--text-muted)' }}>
                <Undo2 size={14} />
              </button>
              <button onClick={redo} disabled={!canRedo} title={t('journey.studio.redo')}
                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'none', cursor: canRedo ? 'pointer' : 'default', opacity: canRedo ? 1 : 0.4, color: 'var(--text-muted)' }}>
                <Redo2 size={14} />
              </button>
              <button onClick={() => { void saveNow(); setShowExport(true) }} title={t('journey.studio.export')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: 'none', background: 'var(--text-primary)', color: 'var(--bg-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Printer size={14} /> {t('journey.studio.export')}
              </button>
            </>
          )}
          {saveLabel && (
            <span style={{ fontSize: 11, color: state.status === 'error' ? '#dc2626' : 'var(--text-faint)', minWidth: 60 }}>{saveLabel}</span>
          )}
        </div>
      </div>

      {!bookLoaded ? (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--border-primary)', borderTopColor: 'var(--text-primary)' }} />
        </div>
      ) : !doc ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
          <BookOpen size={40} style={{ color: 'var(--text-faint)', marginBottom: 14 }} />
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('journey.studio.emptyTitle')}
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, lineHeight: 1.5 }}>
            {t('journey.studio.emptyHint')}
          </p>
          <button onClick={createBook} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', background: 'var(--text-primary)', color: 'var(--bg-primary)',
          }}>
            {t('journey.studio.createBook')}
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <StudioSidebar galleryPhotos={galleryPhotos} />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18)', borderRadius: 4, overflow: 'hidden' }}>
                <StudioCanvas
                  spread={spread}
                  spreadIndex={activeSpread}
                  page={doc.page}
                  zoom={zoom}
                  pxPerMm={BASE_PX_PER_MM}
                  bookView
                  dropLabel={t('journey.studio.dropLabel')}
                  cursors={cursors}
                  onCursor={(x, y) => moveCursor(activeSpread, x, y)}
                />
              </div>
            </div>

            {/* Zoom */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 16px', borderTop: '1px solid var(--border-secondary)', flexShrink: 0 }}>
              <button onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)])}
                style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <Minus size={13} />
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)])}
                style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <Plus size={13} />
              </button>
            </div>
          </div>

          <StudioInspector spreadIndex={activeSpread} />
        </div>
      )}

      {/* Conflict modal */}
      {state.status === 'conflict' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 24, maxWidth: 400, width: '100%' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('journey.studio.saveConflictTitle')}</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('journey.studio.saveConflictHint')}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { const d = acceptTheirs(state.current); loadDoc(d) }}
                style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-muted)' }}>
                {t('journey.studio.takeTheirs')}
              </button>
              <button onClick={() => keepMine(state.current)}
                style={{ padding: '8px 16px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
                {t('journey.studio.keepMine')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExport && doc && (
        <StudioExport doc={doc} title={current?.title || doc.title} onClose={() => setShowExport(false)} />
      )}

      <style>{`.group:hover .st-auto-menu { opacity: 1 !important; visibility: visible !important; }`}</style>
    </div>
  )
}

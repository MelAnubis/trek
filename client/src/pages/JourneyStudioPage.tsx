import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useJourneyStore } from '../store/journeyStore'
import { useStudioStore } from '../store/studioStore'
import { useBookStore } from '../components/Studio/useBookStore'
import { StudioCanvas } from '../components/Studio/StudioCanvas'
import { StudioSidebar } from '../components/Studio/StudioSidebar'
import { StudioInspector } from '../components/Studio/StudioInspector'
import { BOOK_FONTS_GOOGLE_HREF } from '../components/Studio/bookFonts'
import type { BookDocument } from '../types/book'

/**
 * TREK Studio — Phase 2: the editing canvas. Loads/creates the journey's
 * book, wires it to studioStore (undo/redo, selection) and useBookStore
 * (debounced autosave, conflict handling), and lays out the sidebar /
 * canvas / inspector around StudioCanvas.
 *
 * Auto-layout ("This spread" / "the whole book" from journal entries) and
 * the travel-specific elements land in Phase 3; export/print in Phase 4.
 */

function emptyBookDocument(): BookDocument {
  return {
    version: 1,
    title: '',
    page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
    spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      { id: 'spread-1', role: 'inner', background: null, elements: [], parked: [], entryId: null },
    ],
  }
}

/** Base CSS px-per-mm; StudioCanvas multiplies this by the zoom level. */
const BASE_PX_PER_MM = 96 / 25.4
const ZOOM_STEPS = [0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1]

export default function JourneyStudioPage() {
  const { id } = useParams()
  const journeyId = Number(id)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const current = useJourneyStore(s => s.current)
  const loadJourney = useJourneyStore(s => s.loadJourney)

  const doc = useStudioStore(s => s.doc)
  const loadDoc = useStudioStore(s => s.load)
  const activeSpread = useStudioStore(s => s.activeSpread)
  const undo = useStudioStore(s => s.undo)
  const redo = useStudioStore(s => s.redo)
  const canUndo = useStudioStore(s => s.canUndo())
  const canRedo = useStudioStore(s => s.canRedo())

  const [zoom, setZoom] = useState(0.4)

  const { record, loaded: bookLoaded, state, queueSave, saveNow, acceptTheirs, keepMine } = useBookStore(journeyId, loadDoc)

  const builtRef = useRef({ built: false })

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

  const createBook = () => loadDoc(emptyBookDocument())

  const galleryPhotos = useMemo(() =>
    (current?.gallery || []).map(p => ({ photoId: p.photo_id, caption: p.caption ?? null })),
    [current])

  const spread = doc?.spreads[activeSpread] ?? null
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
    </div>
  )
}

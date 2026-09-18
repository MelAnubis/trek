import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { journeyApi } from '../api/client'
import { useTranslation } from '../i18n'
import { useToast } from '../components/shared/Toast'
import { SpreadView } from '../components/Studio/SpreadView'
import { BOOK_FONTS_GOOGLE_HREF } from '../components/Studio/bookFonts'
import type { BookDocument, BookRecord } from '../types/book'

/**
 * TREK Studio — Phase 1: a read-only view of the journey's photo book.
 * Editing (drag/resize/rotate, undo/redo, autosave) lands in Phase 2; this
 * page exists so a book can be created and persisted, and so the render
 * pipeline (SpreadView) that Phase 2's canvas will build on top of is real
 * and exercised end to end.
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

// mm → px for the read-only preview. Phase 2's canvas computes its own zoom;
// this is just enough to see the pages, not to design on.
const PX_PER_MM = 2.2

export default function JourneyStudioPage() {
  const { id } = useParams()
  const journeyId = Number(id)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<BookRecord | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    journeyApi.getBook(journeyId)
      .then(res => { if (!cancelled) setBook(res.book) })
      .catch(() => { if (!cancelled) toast.error(t('journey.studio.loadError')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId])

  const createBook = async () => {
    setCreating(true)
    try {
      const res = await journeyApi.saveBook(journeyId, { title: '', document: emptyBookDocument() })
      setBook(res.book)
    } catch {
      toast.error(t('journey.studio.createError'))
    } finally {
      setCreating(false)
    }
  }

  const backToJourney = () => navigate(`/journey/${journeyId}`)

  const font: React.CSSProperties = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', ...font }}>
      <link rel="stylesheet" href={BOOK_FONTS_GOOGLE_HREF} />

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid var(--border-secondary)',
        position: 'sticky', top: 0, background: 'var(--bg-primary)', zIndex: 10,
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
        <div style={{ width: 120 }} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--border-primary)', borderTopColor: 'var(--text-primary)' }} />
        </div>
      ) : !book ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
          <BookOpen size={40} style={{ color: 'var(--text-faint)', marginBottom: 14 }} />
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('journey.studio.emptyTitle')}
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, lineHeight: 1.5 }}>
            {t('journey.studio.emptyHint')}
          </p>
          <button onClick={createBook} disabled={creating} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600,
            cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit',
            background: 'var(--text-primary)', color: 'var(--bg-primary)', opacity: creating ? 0.6 : 1,
          }}>
            {t('journey.studio.createBook')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, padding: '32px 20px' }}>
          {book.document.spreads.map(spread => {
            const isSingle = spread.role !== 'inner'
            const wMm = isSingle ? book.document.page.pageWidth : book.document.page.pageWidth * 2
            const hMm = book.document.page.pageHeight
            return (
              <div key={spread.id} style={{
                position: 'relative', width: wMm * PX_PER_MM, height: hMm * PX_PER_MM,
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)', borderRadius: 4, overflow: 'hidden',
                flexShrink: 0,
              }}>
                <SpreadView spread={spread} page={book.document.page} big={false} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

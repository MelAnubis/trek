import { useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, Printer, Scissors, X } from 'lucide-react'
import type { BookDocument } from '../../types/book'
import { BookSheetsView } from './BookSheetsView'
import { sheetBox, sheetsFor, type SheetMode } from './bookSheets'
import { printSheets } from './printSheets'
import { useTranslation } from '../../i18n'

/**
 * Getting the book out. Ported from liketrek/trek's
 * client/src/components/Studio/StudioExport.tsx (same AGPLv3 license),
 * restyled with this fork's inline-style convention instead of upstream's
 * studio.css classes.
 *
 * Two questions, not a settings panel: leaves or spreads, and marks or no
 * marks. The sheets are rendered here (off screen, inside the live app)
 * rather than built as a markup string, because they're the editor's own
 * components and read context — the active locale, most visibly.
 */
export function StudioExport({ doc, title, onClose }: { doc: BookDocument; title: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<SheetMode>('pages')
  const [marks, setMarks] = useState(true)
  const [building, setBuilding] = useState(false)
  const stage = useRef<HTMLDivElement>(null)

  const sheets = sheetsFor(doc, mode)
  const widest = Math.max(...sheets.map(s => s.width), doc.page.pageWidth)
  const box = sheetBox(widest, doc.page.pageHeight, doc.page.bleed, marks)
  const single = sheetBox(doc.page.pageWidth, doc.page.pageHeight, doc.page.bleed, marks)

  useEffect(() => {
    if (!building) return
    const html = stage.current?.innerHTML
    if (!html) return

    printSheets({
      html,
      sheetWidth: box.width,
      sheetHeight: box.height,
      singleWidth: single.width,
      singleHeight: single.height,
      title,
      labels: {
        save: t('journey.studio.exportSave'),
        close: t('common.close'),
        count: t('journey.studio.exportSheetCount', { count: sheets.length }),
        preparing: t('journey.studio.exportPreparing'),
      },
    })
    setBuilding(false)
    onClose()
    // Runs once per build — re-running on every render of the options
    // would open a second print view behind the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building])

  const opt = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 10,
    border: active ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
    background: active ? 'var(--bg-tertiary)' : 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    color: 'var(--text-primary)', marginBottom: 6,
  })

  return (
    <div role="dialog" aria-modal="true" aria-label={t('journey.studio.export')}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-secondary)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('journey.studio.export')}</span>
          <button onClick={onClose} aria-label={t('common.close')}
            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 8 }}>
            {t('journey.studio.exportLayout')}
          </div>
          <button style={opt(mode === 'pages')} onClick={() => setMode('pages')} aria-pressed={mode === 'pages'}>
            <FileText size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportPages')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.exportPagesHint')}</div>
            </div>
          </button>
          <button style={opt(mode === 'spreads')} onClick={() => setMode('spreads')} aria-pressed={mode === 'spreads'}>
            <BookOpen size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportSpreads')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.exportSpreadsHint')}</div>
            </div>
          </button>

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '14px 0 8px' }}>
            {t('journey.studio.exportFinishing')}
          </div>
          <button style={opt(marks)} onClick={() => setMarks(!marks)} aria-pressed={marks}>
            <Scissors size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportMarks')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.exportMarksHint', { bleed: doc.page.bleed })}</div>
            </div>
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '10px 0 0', lineHeight: 1.5 }}>
            {t('journey.studio.exportNote', { sheets: sheets.length, width: round1(box.width), height: round1(box.height) })}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--border-secondary)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-muted)' }}>
            {t('common.cancel')}
          </button>
          <button onClick={() => setBuilding(true)} disabled={building}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600, cursor: building ? 'default' : 'pointer', opacity: building ? 0.6 : 1, fontFamily: 'inherit', background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
            <Printer size={14} /> {t('journey.studio.exportOpen')}
          </button>
        </div>
      </div>

      {/* The sheets, rendered where nobody can see them — off screen rather
          than display:none, so they're actually laid out (millimetres, the
          same CSS that will print them) rather than measuring zero. */}
      {building && (
        <div ref={stage} aria-hidden="true" style={{ position: 'fixed', left: '-20000mm', top: 0, pointerEvents: 'none' }}>
          <BookSheetsView doc={doc} mode={mode} marks={marks} />
        </div>
      )}
    </div>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

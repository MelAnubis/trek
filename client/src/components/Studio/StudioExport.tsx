import { useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, FoldHorizontal, Layers, Printer, Scissors, X } from 'lucide-react'
import type { BookDocument } from '../../types/book'
import { BookSheetsView } from './BookSheetsView'
import { BookletSheetsView } from './BookletSheetsView'
import { sheetBox, sheetsFor, type SheetMode } from './bookSheets'
import { printSheets } from './printSheets'
import { useTranslation } from '../../i18n'

type HomeFinish = 'none' | 'duplex' | 'booklet'

/**
 * Getting the book out. Ported from liketrek/trek's
 * client/src/components/Studio/StudioExport.tsx (same AGPLv3 license),
 * restyled with this fork's inline-style convention instead of upstream's
 * studio.css classes.
 *
 * Layout (leaves or spreads), finishing (marks or no marks), and — this
 * fork's own addition — home finishing: printing on a plain double-sided
 * home inkjet in an order that's easy to bind by hand, either straight
 * duplex for a side-bound book (punched, stapled or spiraled along one
 * edge) or saddle-stitch imposition for a folded booklet. Either forces
 * single leaves (a home fold has no use for the "spreads" preview layout)
 * and neither can tell the printer *which* edge it flips on for duplex —
 * that's a driver setting, not something a web page can reach — so the
 * hint text says to check it, not to trust a default.
 *
 * The sheets are rendered here (off screen, inside the live app) rather
 * than built as a markup string, because they're the editor's own
 * components and read context — the active locale, most visibly.
 */
export function StudioExport({ doc, title, onClose }: { doc: BookDocument; title: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<SheetMode>('pages')
  const [marks, setMarks] = useState(true)
  const [homeFinish, setHomeFinish] = useState<HomeFinish>('none')
  const [building, setBuilding] = useState(false)
  const stage = useRef<HTMLDivElement>(null)

  const isBooklet = homeFinish === 'booklet'
  const effectiveMode: SheetMode = homeFinish === 'none' ? mode : 'pages'
  const effectiveMarks = isBooklet ? false : marks

  const leaves = sheetsFor(doc, 'pages')
  const sheets = sheetsFor(doc, effectiveMode)
  const widest = Math.max(...sheets.map(s => s.width), doc.page.pageWidth)
  const box = isBooklet
    ? { width: doc.page.pageWidth * 2, height: doc.page.pageHeight, margin: 0, bleed: 0 }
    : sheetBox(widest, doc.page.pageHeight, doc.page.bleed, effectiveMarks)
  const single = sheetBox(doc.page.pageWidth, doc.page.pageHeight, doc.page.bleed, effectiveMarks)
  // A saddle-stitch signature always pads to a multiple of 4 leaves (2 per side) — see imposeBooklet.
  const bookletSideCount = Math.ceil(leaves.length / 4) * 2
  const sheetCount = isBooklet ? bookletSideCount : sheets.length

  useEffect(() => {
    if (!building) return
    const html = stage.current?.innerHTML
    if (!html) return

    printSheets({
      html,
      sheetWidth: box.width,
      sheetHeight: box.height,
      singleWidth: isBooklet ? undefined : single.width,
      singleHeight: isBooklet ? undefined : single.height,
      title,
      labels: {
        save: t('journey.studio.exportSave'),
        close: t('common.close'),
        count: t('journey.studio.exportSheetCount', { count: sheetCount }),
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
          <button style={opt(effectiveMode === 'pages')} onClick={() => setMode('pages')} aria-pressed={effectiveMode === 'pages'}>
            <FileText size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportPages')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.exportPagesHint')}</div>
            </div>
          </button>
          <button style={{ ...opt(effectiveMode === 'spreads'), cursor: homeFinish === 'none' ? 'pointer' : 'default', opacity: homeFinish === 'none' ? 1 : 0.45 }}
            onClick={() => homeFinish === 'none' && setMode('spreads')} disabled={homeFinish !== 'none'} aria-pressed={effectiveMode === 'spreads'}>
            <BookOpen size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportSpreads')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {homeFinish === 'none' ? t('journey.studio.exportSpreadsHint') : t('journey.studio.exportSpreadsDisabledHint')}
              </div>
            </div>
          </button>

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '14px 0 8px' }}>
            {t('journey.studio.exportHomeFinish')}
          </div>
          <button style={opt(homeFinish === 'duplex')} onClick={() => setHomeFinish(f => f === 'duplex' ? 'none' : 'duplex')} aria-pressed={homeFinish === 'duplex'}>
            <Layers size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportDuplex')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.exportDuplexHint')}</div>
            </div>
          </button>
          <button style={opt(isBooklet)} onClick={() => setHomeFinish(f => f === 'booklet' ? 'none' : 'booklet')} aria-pressed={isBooklet}>
            <FoldHorizontal size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportBooklet')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.exportBookletHint')}</div>
            </div>
          </button>
          {homeFinish !== 'none' && (
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '2px 0 0', lineHeight: 1.5 }}>
              {t('journey.studio.exportHomeFinishNote')}
            </p>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '14px 0 8px' }}>
            {t('journey.studio.exportFinishing')}
          </div>
          <button style={{ ...opt(effectiveMarks), cursor: isBooklet ? 'default' : 'pointer', opacity: isBooklet ? 0.45 : 1 }}
            onClick={() => !isBooklet && setMarks(!marks)} disabled={isBooklet} aria-pressed={effectiveMarks}>
            <Scissors size={16} color="var(--text-muted)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('journey.studio.exportMarks')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {isBooklet ? t('journey.studio.exportMarksDisabledHint') : t('journey.studio.exportMarksHint', { bleed: doc.page.bleed })}
              </div>
            </div>
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '10px 0 0', lineHeight: 1.5 }}>
            {t('journey.studio.exportNote', { sheets: sheetCount, width: round1(box.width), height: round1(box.height) })}
          </p>

          {/* The single most common way this comes out wrong: the print
              dialog silently defaults its own paper size to A4/Letter,
              which is a different size from the sheet CSS actually
              declares — the browser then scales the (correctly sized)
              content into a corner of that bigger sheet, and it prints
              or saves looking mostly blank. Nothing in the app can force
              the dialog's own paper-size field, so the fix is telling
              people to set it themselves, right before they hit print. */}
          <p style={{
            fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, padding: '8px 10px', margin: '10px 0 0', lineHeight: 1.5,
          }}>
            {t('journey.studio.exportPaperSizeWarning', { width: round1(box.width), height: round1(box.height) })}
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
          {isBooklet ? <BookletSheetsView doc={doc} /> : <BookSheetsView doc={doc} mode={effectiveMode} marks={effectiveMarks} />}
        </div>
      )}
    </div>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

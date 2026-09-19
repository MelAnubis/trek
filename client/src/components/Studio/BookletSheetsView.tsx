import type { BookDocument } from '../../types/book'
import { SpreadView } from './SpreadView'
import { imposeBooklet, sheetsFor, type Sheet } from './bookSheets'

/**
 * The book laid out for a home duplex printer and a fold, not a press. A
 * pressed sheet keeps its bleed and gets crop marks because a trimming
 * blade needs to know where the edge is; a sheet someone is about to fold
 * by hand doesn't get trimmed at all, so both are skipped here — see
 * BookSheetsView.tsx for the version that does carry them.
 *
 * Each physical printed side holds two *unrelated* leaves (page 1 and the
 * book's last page share a sheet, not page 1 and 2) — imposeBooklet works
 * out which two, from `sheetsFor(doc, 'pages')`'s own reading-order list —
 * so this can't reuse BookSheetsView's one-leaf-per-sheet layout at all.
 */
export function BookletSheetsView({ doc }: { doc: BookDocument }) {
  const { pageWidth, pageHeight } = doc.page
  const leaves = sheetsFor(doc, 'pages')
  const imposed = imposeBooklet(leaves)

  const sides: (Sheet | null)[][] = []
  for (let i = 0; i < imposed.length; i += 2) sides.push([imposed[i], imposed[i + 1] ?? null])

  return (
    <div className="bx-book">
      {sides.map((side, i) => (
        <BookletSide key={i} side={side} pageWidth={pageWidth} pageHeight={pageHeight} doc={doc} last={i === sides.length - 1} />
      ))}
    </div>
  )
}

function BookletSide({ side, pageWidth, pageHeight, doc, last }: {
  side: (Sheet | null)[]; pageWidth: number; pageHeight: number; doc: BookDocument; last: boolean
}) {
  return (
    <div
      className="bx-sheet"
      style={{
        position: 'relative',
        width: `${pageWidth * 2}mm`,
        height: `${pageHeight}mm`,
        background: '#ffffff',
        breakAfter: last ? 'auto' : 'page',
        overflow: 'hidden',
      }}
    >
      {side.map((leaf, i) => (
        <div
          key={i}
          style={{ position: 'absolute', left: `${i * pageWidth}mm`, top: 0, width: `${pageWidth}mm`, height: `${pageHeight}mm`, overflow: 'hidden' }}
        >
          {leaf && (
            // Same window-onto-the-spread trick BookSheetsView's SheetView
            // uses — a leaf is a page-wide opening into its parent spread,
            // shifted left by however far into that spread this leaf sits.
            <div style={{ position: 'absolute', left: `${-leaf.offset}mm`, top: 0, width: `${leaf.spreadWidth}mm`, height: `${pageHeight}mm` }}>
              <SpreadView spread={leaf.spread} page={doc.page} big print />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

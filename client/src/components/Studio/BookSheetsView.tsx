import type { BookDocument } from '../../types/book'
import { SpreadView } from './SpreadView'
import { MARK_LENGTH, MARK_WEIGHT, sheetBox, sheetsFor, type Sheet, type SheetMode } from './bookSheets'

/**
 * The book laid out for a press. Ported from liketrek/trek's
 * client/src/components/Studio/BookSheetsView.tsx (same AGPLv3 license).
 *
 * These are the same `SpreadView`s the editor draws, at 1:1 with `print`
 * on — the whole reason Studio renders in DOM and positions in
 * millimetres: a second renderer for output would be a second renderer to
 * proofread against, and the day it drifts is the day someone finds out by
 * opening a printed book. What's added on top is only what a press needs
 * and a screen does not: the bleed carried out past the trim on all four
 * sides, and crop marks outside it saying where to cut.
 */
export function BookSheetsView({ doc, mode, marks }: { doc: BookDocument; mode: SheetMode; marks: boolean }) {
  const sheets = sheetsFor(doc, mode)
  return (
    <div className="bx-book">
      {sheets.map((sheet, i) => (
        <SheetView key={`${sheet.spread.id}-${sheet.offset}`} sheet={sheet} doc={doc} marks={marks} last={i === sheets.length - 1} />
      ))}
    </div>
  )
}

function SheetView({ sheet, doc, marks, last }: { sheet: Sheet; doc: BookDocument; marks: boolean; last: boolean }) {
  // Each sheet is sized to what is on it, not to the widest in the book —
  // a cover is one page wide and a spread is two, and spread mode has both
  // in the same document. The print CSS carries a named page rule for the
  // narrow ones (see printSheets.ts's singleRule).
  const box = sheetBox(sheet.width, sheet.height, doc.page.bleed, marks)

  return (
    <div
      className={`bx-sheet${sheet.single ? ' is-single' : ''}`}
      data-label={sheet.label}
      style={{
        position: 'relative',
        width: `${box.width}mm`,
        height: `${box.height}mm`,
        background: '#ffffff',
        breakAfter: last ? 'auto' : 'page',
        overflow: 'hidden',
      }}
    >
      {/* The window on the spread — one page wide plus bleed on both sides,
          which is why a photograph crossing the gutter comes out aligned:
          both halves are the same spread seen through openings a page apart. */}
      <div
        style={{
          position: 'absolute',
          left: `${box.margin - box.bleed}mm`,
          top: `${box.margin - box.bleed}mm`,
          width: `${sheet.width + box.bleed * 2}mm`,
          height: `${sheet.height + box.bleed * 2}mm`,
          background: sheet.spread.background ?? '#ffffff',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${box.bleed - sheet.offset}mm`,
            top: `${box.bleed}mm`,
            width: `${sheet.spreadWidth}mm`,
            height: `${sheet.height}mm`,
          }}
        >
          <SpreadView spread={sheet.spread} page={doc.page} big print />
        </div>
      </div>

      {marks && <CropMarks box={box} width={sheet.width} height={sheet.height} />}
    </div>
  )
}

/** Where to cut. Eight hairlines, two per corner, starting at the bleed edge and reaching outward — never crossing the trim. */
function CropMarks({ box, width, height }: { box: ReturnType<typeof sheetBox>; width: number; height: number }) {
  const left = box.margin
  const top = box.margin
  const right = left + width
  const bottom = top + height
  const gap = box.bleed

  const line = (x: number, y: number, w: number, h: number, key: string) => (
    <div key={key} style={{ position: 'absolute', left: `${x}mm`, top: `${y}mm`, width: `${w}mm`, height: `${h}mm`, background: '#000000' }} />
  )

  const marks: React.ReactNode[] = []
  for (const [x, dx] of [[left, -1], [right, 1]] as const) {
    for (const [y, dy] of [[top, -1], [bottom, 1]] as const) {
      marks.push(line(dx < 0 ? x - gap - MARK_LENGTH : x + gap, y - MARK_WEIGHT / 2, MARK_LENGTH, MARK_WEIGHT, `h${x}-${y}`))
      marks.push(line(x - MARK_WEIGHT / 2, dy < 0 ? y - gap - MARK_LENGTH : y + gap, MARK_WEIGHT, MARK_LENGTH, `v${x}-${y}`))
    }
  }
  return <>{marks}</>
}

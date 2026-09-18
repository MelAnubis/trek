import type { BookDocument, BookSpread } from '../../types/book'

/**
 * Cutting a book into printable sheets. Ported from liketrek/trek's
 * client/src/components/Studio/bookSheets.ts (same AGPLv3 license) — pure
 * millimetre math, fully portable.
 *
 * The document is made of spreads, because that is the unit a person
 * designs in: a picture crossing the gutter is one decision, not two. A
 * printer takes pages — single leaves, each with its own bleed on all four
 * sides, in reading order — so export cuts every inner spread down the
 * middle and hands over the halves. The cut is a window, not a re-layout:
 * each sheet shows the same spread through an opening the size of one
 * page, shifted by a page width for the right-hand leaf, which is why a
 * photograph that crosses the gutter comes out of the press aligned.
 *
 * Spread mode (uncut, two pages per sheet) exists for reading rather than
 * printing — the PDF you send someone to look at, where cutting a
 * photograph across the gutter into two sheets would look broken.
 */

/** How far a crop mark reaches out past the bleed. */
export const MARK_LENGTH = 4
/** How thick it is drawn — hairline. */
export const MARK_WEIGHT = 0.2

export type SheetMode = 'pages' | 'spreads'

export interface Sheet {
  spread: BookSpread
  spreadIndex: number
  /** How far into the spread the window sits, in mm — 0 for a left-hand leaf, one page width for a right-hand one. */
  offset: number
  width: number
  height: number
  /** Width of the whole spread behind the window, for positioning it. */
  spreadWidth: number
  /** Covers are single sheets in both modes — matters for the print CSS's named page rule. */
  single: boolean
  label: string
}

export interface SheetBox {
  width: number
  height: number
  margin: number
  bleed: number
}

export function sheetBox(trimWidth: number, trimHeight: number, bleed: number, marks: boolean): SheetBox {
  // Marks are drawn outside the bleed, not inside it — inside would mean
  // printing them onto the part of the sheet that gets cut off.
  const margin = marks ? bleed + MARK_LENGTH : bleed
  return { width: trimWidth + margin * 2, height: trimHeight + margin * 2, margin, bleed }
}

/** Where the folio numbering starts — this fork doesn't yet expose page-number configuration, so this mirrors upstream's own default (2: the cover is a separate sheet and doesn't count). */
const FOLIO_START_AT = 2

function folio(spreadIndex: number): number {
  return FOLIO_START_AT + (spreadIndex - 1) * 2
}
function folioRange(spreadIndex: number): string {
  const left = folio(spreadIndex)
  return `${left} – ${left + 1}`
}

/** A book, as leaves. Covers stay whole in both modes — half a cover is not a thing anybody prints. */
export function sheetsFor(doc: BookDocument, mode: SheetMode): Sheet[] {
  const { pageWidth, pageHeight } = doc.page
  const out: Sheet[] = []

  doc.spreads.forEach((spread, spreadIndex) => {
    const single = spread.role !== 'inner'
    const spreadWidth = single ? pageWidth : pageWidth * 2

    if (single || mode === 'spreads') {
      out.push({
        spread, spreadIndex, offset: 0, width: spreadWidth, height: pageHeight, spreadWidth, single,
        label: single ? '' : folioRange(spreadIndex),
      })
      return
    }

    for (const half of [0, 1]) {
      out.push({
        spread, spreadIndex, offset: half * pageWidth, width: pageWidth, height: pageHeight, spreadWidth,
        single: true, label: String(folio(spreadIndex) + half),
      })
    }
  })

  return out
}

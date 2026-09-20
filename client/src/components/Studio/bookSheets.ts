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

/** Which of a sheet's four edges get bleed (and, when on, a crop mark) at all. */
export interface BleedEdges {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

const ALL_EDGES: BleedEdges = { left: true, right: true, top: true, bottom: true }

export interface SheetBox {
  width: number
  height: number
  /** Room reserved on each edge — bleed, plus mark room when marks are on. 0 on an edge that isn't a real trim edge. */
  left: number
  right: number
  top: number
  bottom: number
  bleed: number
}

/** `edges` defaults to all four — a plain rectangular sheet with bleed and a crop mark all the way round. Pass `edgesFor(sheet)`'s result for a leaf cut from a spread, where the gutter side isn't a trim edge at all. */
export function sheetBox(trimWidth: number, trimHeight: number, bleed: number, marks: boolean, edges: BleedEdges = ALL_EDGES): SheetBox {
  // Marks are drawn outside the bleed, not inside it — inside would mean
  // printing them onto the part of the sheet that gets cut off.
  const room = marks ? bleed + MARK_LENGTH : bleed
  const left = edges.left ? room : 0
  const right = edges.right ? room : 0
  const top = edges.top ? room : 0
  const bottom = edges.bottom ? room : 0
  return { width: trimWidth + left + right, height: trimHeight + top + bottom, left, right, top, bottom, bleed }
}

/**
 * Which of a sheet's edges are real trim edges. A sheet that isn't cut from
 * a wider spread — a cover, or an uncut "Dobles páginas" sheet — has no
 * gutter at all, so all four are trim edges. A leaf cut from a spread
 * ("Páginas sueltas" export) has one edge that is the gutter — the fold
 * where it joins the facing leaf, not a cut — and bleeding past it just
 * shows a sliver of the facing leaf's own artwork through the window.
 */
export function edgesFor(sheet: Sheet): BleedEdges {
  if (sheet.width >= sheet.spreadWidth) return ALL_EDGES
  return { top: true, bottom: true, left: sheet.offset === 0, right: sheet.offset !== 0 }
}

/** Where the folio numbering starts — this fork doesn't yet expose page-number configuration, so this mirrors upstream's own default (2: the cover is a separate sheet and doesn't count). */
const FOLIO_START_AT = 2

/** The left page's number for an inner spread at this position — the right page is one more. Exported for SpreadView's own on-page folio numbers, which need the same arithmetic as the Pages panel's label. */
export function folio(spreadIndex: number): number {
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
      // In "spreads" mode every sheet shares one physical size, cover
      // included — a lone-page cover next to full-width inner spreads
      // gives the two a different aspect ratio (portrait-ish vs.
      // landscape), and some print engines auto-rotate whichever sheet
      // doesn't match the orientation the person picked, no matter which
      // they pick. The room next to the cover's own content is left
      // blank, standing in for the inside of the cover.
      const width = mode === 'spreads' ? pageWidth * 2 : spreadWidth
      out.push({
        spread, spreadIndex, offset: 0, width, height: pageHeight, spreadWidth, single,
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

/**
 * Saddle-stitch imposition: reorder a book's leaves (in reading order, as
 * `sheetsFor(doc, 'pages')` already returns them) into physical-sheet
 * front/back pairs, so that printing double-sided and folding the whole
 * stack once down the middle puts every leaf back in reading order.
 *
 * Standard single-signature formula: pad to a multiple of 4 (a folded sheet
 * always carries 4 pages), then for sheet `s` of `N/4`, its front holds
 * leaves `N-1-2s` and `2s` side by side, its back holds `2s+1` and
 * `N-2-2s`. `null` marks a padding blank — there is no leaf N+1 of a
 * 27-page book, but the fold still needs a 28th page-sized blank there.
 *
 * Returned flat, two entries per physical side, in the order a printer
 * should receive them: sheet 0's front, sheet 0's back, sheet 1's front, …
 * — pair them up by twos to get each physical side's two leaves.
 */
export function imposeBooklet<T>(leaves: T[]): (T | null)[] {
  const padded: (T | null)[] = [...leaves]
  while (padded.length % 4 !== 0) padded.push(null)
  const n = padded.length
  const out: (T | null)[] = []
  for (let s = 0; s < n / 4; s++) {
    out.push(padded[n - 1 - 2 * s], padded[2 * s])
    out.push(padded[2 * s + 1], padded[n - 2 - 2 * s])
  }
  return out
}

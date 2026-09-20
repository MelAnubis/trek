// FE-BOOKSHEETS-001 to FE-BOOKSHEETS-019
import { edgesFor, imposeBooklet, sheetBox, sheetsFor } from './bookSheets'
import type { BookDocument, BookSpread } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function spread(role: BookSpread['role']): BookSpread {
  return { id: `${role}-1`, role, background: null, elements: [], parked: [], entryId: null }
}

function doc(spreads: BookSpread[]): BookDocument {
  return { version: 1, title: '', page: PAGE, spreads }
}

describe('sheetBox', () => {
  it('FE-BOOKSHEETS-001: with marks, each edge reserves bleed plus mark length', () => {
    const box = sheetBox(210, 210, 3, true)
    expect(box.left).toBe(3 + 4) // MARK_LENGTH = 4
    expect(box.width).toBe(210 + box.left * 2)
    expect(box.height).toBe(210 + box.top * 2)
  })

  it('FE-BOOKSHEETS-002: without marks, each edge reserves just the bleed', () => {
    const box = sheetBox(210, 210, 3, false)
    expect(box.left).toBe(3)
    expect(box.width).toBe(216)
  })

  it('FE-BOOKSHEETS-017: an edge marked false in `edges` reserves no room at all', () => {
    const box = sheetBox(210, 210, 3, true, { left: false, right: true, top: true, bottom: true })
    expect(box.left).toBe(0)
    expect(box.right).toBe(7)
    expect(box.width).toBe(210 + 0 + 7)
  })
})

describe('edgesFor', () => {
  it('FE-BOOKSHEETS-018: a leaf cut from a spread has no bleed on its gutter side, but does on the other three', () => {
    const spreadWidth = 420
    const left = edgesFor({ spread: spread('inner'), spreadIndex: 0, offset: 0, width: 210, height: 210, spreadWidth, single: true, label: '' })
    expect(left).toEqual({ left: true, right: false, top: true, bottom: true })

    const right = edgesFor({ spread: spread('inner'), spreadIndex: 0, offset: 210, width: 210, height: 210, spreadWidth, single: true, label: '' })
    expect(right).toEqual({ left: false, right: true, top: true, bottom: true })
  })

  it('FE-BOOKSHEETS-019: a sheet that isn\'t cut from a wider spread (a cover, or an uncut spread) gets bleed on all four edges', () => {
    expect(edgesFor({ spread: spread('cover'), spreadIndex: 0, offset: 0, width: 210, height: 210, spreadWidth: 210, single: true, label: '' }))
      .toEqual({ left: true, right: true, top: true, bottom: true })
    expect(edgesFor({ spread: spread('inner'), spreadIndex: 0, offset: 0, width: 420, height: 210, spreadWidth: 420, single: false, label: '' }))
      .toEqual({ left: true, right: true, top: true, bottom: true })
  })
})

describe('sheetsFor — pages mode', () => {
  it('FE-BOOKSHEETS-003: a cover stays one whole sheet, never cut in half', () => {
    const sheets = sheetsFor(doc([spread('cover')]), 'pages')
    expect(sheets).toHaveLength(1)
    expect(sheets[0].single).toBe(true)
    expect(sheets[0].width).toBe(210)
  })

  it('FE-BOOKSHEETS-004: an inner spread is cut into two single-page leaves', () => {
    const sheets = sheetsFor(doc([spread('inner')]), 'pages')
    expect(sheets).toHaveLength(2)
    expect(sheets[0].single).toBe(true)
    expect(sheets[1].single).toBe(true)
    expect(sheets[0].offset).toBe(0)
    expect(sheets[1].offset).toBe(210) // one page width
    // Both leaves are windows onto the same spread, same full width behind them.
    expect(sheets[0].spreadWidth).toBe(420)
    expect(sheets[1].spreadWidth).toBe(420)
  })

  it('FE-BOOKSHEETS-005: cover, inner, back produces 1 + 2 + 1 = 4 sheets in order', () => {
    const sheets = sheetsFor(doc([spread('cover'), spread('inner'), spread('back')]), 'pages')
    expect(sheets.map(s => s.single)).toEqual([true, true, true, true])
    expect(sheets).toHaveLength(4)
  })
})

describe('sheetsFor — spreads mode', () => {
  it('FE-BOOKSHEETS-006: an inner spread stays one uncut sheet, twice the page width', () => {
    const sheets = sheetsFor(doc([spread('inner')]), 'spreads')
    expect(sheets).toHaveLength(1)
    expect(sheets[0].single).toBe(false)
    expect(sheets[0].width).toBe(420)
  })

  it('FE-BOOKSHEETS-007: the cover is still one sheet in spread mode too', () => {
    const sheets = sheetsFor(doc([spread('cover')]), 'spreads')
    expect(sheets).toHaveLength(1)
    expect(sheets[0].single).toBe(true)
  })

  it('FE-BOOKSHEETS-008: sheet count is always <= pages-mode count for the same book', () => {
    const book = doc([spread('cover'), spread('inner'), spread('inner'), spread('back')])
    const pages = sheetsFor(book, 'pages')
    const spreads = sheetsFor(book, 'spreads')
    expect(spreads.length).toBeLessThan(pages.length)
  })
})

describe('imposeBooklet', () => {
  const leaves = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

  it('FE-BOOKSHEETS-009: a single folded sheet (4 pages) pairs back-cover+front-cover, then page2+page3', () => {
    expect(imposeBooklet(leaves(4))).toEqual(['p4', 'p1', 'p2', 'p3'])
  })

  it('FE-BOOKSHEETS-010: an 8-page booklet (2 nested sheets) matches the standard saddle-stitch order', () => {
    // Sheet 1 front: 8,1 · back: 2,7 — Sheet 2 front: 6,3 · back: 4,5
    expect(imposeBooklet(leaves(8))).toEqual([
      'p8', 'p1', 'p2', 'p7',
      'p6', 'p3', 'p4', 'p5',
    ])
  })

  it('FE-BOOKSHEETS-011: a count not divisible by 4 is padded with blanks (null) to the next multiple of 4', () => {
    const out = imposeBooklet(leaves(6))
    expect(out).toHaveLength(8)
    expect(out.filter(x => x === null)).toHaveLength(2)
  })

  it('FE-BOOKSHEETS-012: every leaf appears in the imposed order exactly once, for any page count', () => {
    for (const n of [4, 8, 12, 16, 28]) {
      const original = leaves(n)
      const imposed = imposeBooklet(original).filter((x): x is string => x !== null)
      expect([...imposed].sort()).toEqual([...original].sort())
    }
  })

  it('FE-BOOKSHEETS-013: an already-multiple-of-4 count needs no padding', () => {
    expect(imposeBooklet(leaves(12))).toHaveLength(12)
    expect(imposeBooklet(leaves(12)).filter(x => x === null)).toHaveLength(0)
  })
})

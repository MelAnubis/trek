// FE-BOOKSHEETS-001 to FE-BOOKSHEETS-008
import { sheetBox, sheetsFor } from './bookSheets'
import type { BookDocument, BookSpread } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function spread(role: BookSpread['role']): BookSpread {
  return { id: `${role}-1`, role, background: null, elements: [], parked: [], entryId: null }
}

function doc(spreads: BookSpread[]): BookDocument {
  return { version: 1, title: '', page: PAGE, spreads }
}

describe('sheetBox', () => {
  it('FE-BOOKSHEETS-001: with marks, the margin is bleed plus mark length', () => {
    const box = sheetBox(210, 210, 3, true)
    expect(box.margin).toBe(3 + 4) // MARK_LENGTH = 4
    expect(box.width).toBe(210 + box.margin * 2)
    expect(box.height).toBe(210 + box.margin * 2)
  })

  it('FE-BOOKSHEETS-002: without marks, the margin is just the bleed', () => {
    const box = sheetBox(210, 210, 3, false)
    expect(box.margin).toBe(3)
    expect(box.width).toBe(216)
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

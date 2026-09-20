// FE-BOOKSHEETSVIEW-001 to FE-BOOKSHEETSVIEW-003
import { render } from '@testing-library/react'
import { BookSheetsView } from './BookSheetsView'
import type { BookDocument, BookPhotoElement } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function photo(id: string, x: number, w: number): BookPhotoElement {
  return {
    id, kind: 'photo', frame: { x, y: -3, w, h: 216 }, rotation: 0, opacity: 1, locked: false,
    photoId: Number(id.replace(/\D/g, '')), fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null,
  }
}

function doc(): BookDocument {
  return {
    version: 1,
    title: '',
    page: PAGE,
    spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      // Mirrors 'two-up': one full-bleed photo per page, each stopping exactly at the gutter.
      {
        id: 'sp-1', role: 'inner', background: null, entryId: null, parked: [],
        elements: [photo('p1', -3, 213), photo('p2', 210, 213)],
      },
    ],
  }
}

describe('BookSheetsView — single-leaf export never bleeds a neighbour into the gutter window', () => {
  it('FE-BOOKSHEETSVIEW-001: the left leaf\'s clipping window stops exactly at the gutter, not 3mm past it', () => {
    const { container } = render(<BookSheetsView doc={doc()} mode="pages" marks={false} />)
    const leftLeaf = container.querySelectorAll('.bx-sheet.is-leaf')[0]
    // The window (background/bleed-area) div is the sheet's first child.
    const window_ = leftLeaf.firstElementChild as HTMLElement
    expect(window_.style.width).toBe('213mm') // 210 (page) + 3 (real outer bleed) + 0 (no gutter bleed)
  })

  it('FE-BOOKSHEETSVIEW-002: the right leaf\'s clipping window is offset so it doesn\'t reach left of the gutter either', () => {
    const { container } = render(<BookSheetsView doc={doc()} mode="pages" marks={false} />)
    const rightLeaf = container.querySelectorAll('.bx-sheet.is-leaf')[1]
    const window_ = rightLeaf.firstElementChild as HTMLElement
    expect(window_.style.width).toBe('213mm')
    expect(window_.style.left).toBe('0mm') // no gutter-side bleed to start further left
  })

  it('FE-BOOKSHEETSVIEW-003: a cover (no gutter at all) keeps bleed on all four sides', () => {
    const { container } = render(<BookSheetsView doc={doc()} mode="pages" marks={false} />)
    const cover = container.querySelectorAll('.bx-sheet.is-single:not(.is-leaf)')[0]
    const window_ = cover.firstElementChild as HTMLElement
    expect(window_.style.width).toBe('216mm') // 210 + 3 + 3, both sides real trim edges
  })
})

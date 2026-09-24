// FE-PUBLICBOOKVIEW-001 to FE-PUBLICBOOKVIEW-003
import { render } from '@testing-library/react'
import { PublicBookView } from './PublicBookView'
import type { BookDocument } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function doc(overrides: Partial<BookDocument> = {}): BookDocument {
  return {
    version: 1,
    title: 'My Book',
    page: PAGE,
    spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      {
        id: 'spread-1', role: 'inner', background: null, parked: [], entryId: null,
        elements: [{ id: 'p1', kind: 'photo', frame: { x: 0, y: 0, w: 40, h: 40 }, rotation: 0, opacity: 1, locked: false, photoId: 55, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null }],
      },
    ],
    ...overrides,
  }
}

describe('PublicBookView', () => {
  it('FE-PUBLICBOOKVIEW-001: renders one page per spread', () => {
    const { container } = render(<PublicBookView document={doc()} publicToken="tok" />)
    // Each BookPage wraps its spread in a fixed-height container.
    expect(container.querySelectorAll('.w-full.max-w-\\[900px\\]').length).toBe(2)
  })

  it('FE-PUBLICBOOKVIEW-002: routes a photo element through the public proxy using the given token', () => {
    const { container } = render(<PublicBookView document={doc()} publicToken="my-token" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/api/public/journey/my-token/photos/55/original')
  })

  it('FE-PUBLICBOOKVIEW-003: an empty spread with no photos renders no <img>', () => {
    const single = doc({ spreads: [{ id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null }] })
    const { container } = render(<PublicBookView document={single} publicToken="tok" />)
    expect(container.querySelector('img')).toBeNull()
  })
})

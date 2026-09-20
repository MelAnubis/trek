// FE-SPREADVIEW-001 to FE-SPREADVIEW-005
import { render } from '@testing-library/react'
import { SpreadView } from './SpreadView'
import type { BookPageSetup, BookSpread } from '../../types/book'

const PAGE: BookPageSetup = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5, pageNumbers: { show: true } }

function spread(role: BookSpread['role'] = 'inner'): BookSpread {
  return { id: 'sp-1', role, background: null, elements: [], parked: [], entryId: null }
}

describe('SpreadView — page numbers', () => {
  it('FE-SPREADVIEW-001: with pageNumbers.show off, no folio text is rendered', () => {
    const { container } = render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: false } }} spreadIndex={1} />)
    expect(container.textContent).toBe('')
  })

  it('FE-SPREADVIEW-002: with pageNumbers undefined entirely (a document saved before the field existed), no folio text is rendered', () => {
    const { container } = render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: undefined }} spreadIndex={1} />)
    expect(container.textContent).toBe('')
  })

  it('FE-SPREADVIEW-003: a cover never carries a folio, even with pageNumbers on', () => {
    const { container } = render(<SpreadView spread={spread('cover')} page={PAGE} spreadIndex={0} />)
    expect(container.textContent).toBe('')
  })

  it('FE-SPREADVIEW-004: with no spreadIndex given at all, no folio is rendered (e.g. a template swatch shown out of book context)', () => {
    const { container } = render(<SpreadView spread={spread()} page={PAGE} />)
    expect(container.textContent).toBe('')
  })

  it('FE-SPREADVIEW-005: an inner spread at position 1 (the first inner spread, right after the cover) shows folios 2 and 3', () => {
    const { container } = render(<SpreadView spread={spread()} page={PAGE} spreadIndex={1} />)
    expect(container.textContent).toBe('23')
  })
})

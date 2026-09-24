// FE-SPREADVIEW-001 to FE-SPREADVIEW-014
import { render } from '@testing-library/react'
import { ElementView, SpreadView } from './SpreadView'
import type { BookPageSetup, BookPhotoElement, BookShapeElement, BookSpread } from '../../types/book'

const PAGE: BookPageSetup = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5, pageNumbers: { show: true } }

function spread(role: BookSpread['role'] = 'inner'): BookSpread {
  return { id: 'sp-1', role, background: null, elements: [], parked: [], entryId: null }
}

const elBase = { id: 'el-1', frame: { x: 0, y: 0, w: 40, h: 40 }, rotation: 0, opacity: 1, locked: false }

function shapeEl(overrides: Partial<BookShapeElement> = {}): BookShapeElement {
  return { ...elBase, kind: 'shape', shape: 'rect', fill: '#111827', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0, ...overrides }
}

function photoEl(overrides: Partial<BookPhotoElement> = {}): BookPhotoElement {
  return {
    ...elBase, kind: 'photo', photoId: 101, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0,
    filter: 'none', frameStyle: 'none', mask: null, ...overrides,
  }
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

describe('ShapeView — decorative shape library', () => {
  it('FE-SPREADVIEW-006: rect and ellipse still render as a plain <div>, not an <svg>', () => {
    const { container: rectC } = render(<ElementView el={shapeEl({ shape: 'rect' })} big />)
    const { container: ellC } = render(<ElementView el={shapeEl({ shape: 'ellipse' })} big />)
    expect(rectC.querySelector('svg')).toBeNull()
    expect(ellC.querySelector('svg')).toBeNull()
  })

  it('FE-SPREADVIEW-007: a decorative shape (e.g. star-5) renders as an <svg><path>, scaled to the element\'s own frame', () => {
    const { container } = render(<ElementView el={shapeEl({ shape: 'star-5', frame: { x: 0, y: 0, w: 40, h: 20 } })} big />)
    const path = container.querySelector('svg path')
    expect(path).not.toBeNull()
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 40 20')
  })

  it('FE-SPREADVIEW-008: a shape with fill and a gradient renders a <linearGradient> the path references', () => {
    const { container } = render(<ElementView el={shapeEl({ shape: 'heart', fill: '#ff0000', gradient: 'up' })} big />)
    const grad = container.querySelector('linearGradient')
    expect(grad).not.toBeNull()
    expect(container.querySelector('path')?.getAttribute('fill')).toContain('url(#')
  })

  it('FE-SPREADVIEW-009: a shape with a stroke sets stroke-width and stroke color on the path', () => {
    const { container } = render(<ElementView el={shapeEl({ shape: 'triangle', stroke: '#0000ff', strokeWidth: 2, strokeStyle: 'dashed' })} big />)
    const path = container.querySelector('path')
    expect(path?.getAttribute('stroke')).toBe('#0000ff')
    expect(path?.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('FE-SPREADVIEW-010: gear (a HOLED_SHAPES member) uses fill-rule evenodd so its hole actually shows', () => {
    const { container } = render(<ElementView el={shapeEl({ shape: 'gear' })} big />)
    expect(container.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd')
  })
})

describe('PhotoView — shape masking', () => {
  it('FE-SPREADVIEW-011: a photo with no mask has no clip-path', () => {
    const { container } = render(<ElementView el={photoEl({ mask: null })} big print={false} dropLabel="" />)
    expect(container.querySelector('clipPath')).toBeNull()
  })

  it('FE-SPREADVIEW-012: a photo masked to a decorative shape (e.g. heart) gets an objectBoundingBox clipPath', () => {
    const { container } = render(<ElementView el={photoEl({ mask: 'heart' })} big print={false} dropLabel="" />)
    const clip = container.querySelector('clipPath')
    expect(clip).not.toBeNull()
    expect(clip?.getAttribute('clipPathUnits')).toBe('objectBoundingBox')
    // objectBoundingBox coordinates are 0..1, never raw 0..100 shape units.
    const d = clip?.querySelector('path')?.getAttribute('d') ?? ''
    const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number)
    expect(nums.every(n => n >= -0.2 && n <= 1.2)).toBe(true)
  })

  it('FE-SPREADVIEW-013: ellipse mask keeps the cheap border-radius:50% path, no clip-path needed', () => {
    const { container } = render(<ElementView el={photoEl({ mask: 'ellipse' })} big print={false} dropLabel="" />)
    expect(container.querySelector('clipPath')).toBeNull()
  })

  it('FE-SPREADVIEW-014: a publicToken passed to SpreadView reaches BookPhotoImg\'s <img src>, routing through the token-gated public proxy', () => {
    const s = { ...spread(), elements: [photoEl({ photoId: 55 })] }
    const { container } = render(<SpreadView spread={s} page={PAGE} big print publicToken="share-tok" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/public/journey/share-tok/photos/55/original')
  })
})

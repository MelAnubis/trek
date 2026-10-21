// FE-SPREADVIEW-001 to FE-SPREADVIEW-026
import { render } from '@testing-library/react'
import { ElementView, SpreadView } from './SpreadView'
import type { BookPageSetup, BookPhotoElement, BookShapeElement, BookSpread, BookTextElement } from '../../types/book'

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

describe('SpreadView — page numbers', () => {
  const folios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-folio]'))

  it('FE-SPREADVIEW-015: an inner spread numbers both pages from startAt; the cover carries none', () => {
    const { container } = render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: true, startAt: 10 } }} spreadIndex={2} />)
    expect(folios(container).map(f => f.textContent)).toEqual(['12', '13'])
    const cover = render(<SpreadView spread={spread('cover')} page={PAGE} spreadIndex={0} />)
    expect(folios(cover.container)).toHaveLength(0)
  })

  it('FE-SPREADVIEW-016: outer puts the numbers at the outside edges, inner next to the gutter, centre centred', () => {
    const outer = folios(render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: true, position: 'outer', margin: 10 } }} spreadIndex={1} />).container)
    expect(outer[0].style.left).toBe('10mm')
    expect(outer[0].style.textAlign).toBe('left')
    expect(outer[1].style.textAlign).toBe('right')
    const inner = folios(render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: true, position: 'inner', margin: 10 } }} spreadIndex={1} />).container)
    expect(inner[0].style.textAlign).toBe('right')
    expect(inner[1].style.left).toBe('220mm')
    const centre = folios(render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: true, position: 'centre' } }} spreadIndex={1} />).container)
    expect(centre.map(f => f.style.textAlign)).toEqual(['center', 'center'])
  })

  it('FE-SPREADVIEW-017: size and margin set the type and its distance from the bottom trim', () => {
    const [f] = folios(render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: true, size: 11, margin: 20 } }} spreadIndex={1} />).container)
    expect(f.style.fontSize).toBe('11pt')
    expect(f.style.top).toBe('190mm')
  })

  it('FE-SPREADVIEW-018: auto colour goes light over a full-bleed photo; a fixed colour is used as given', () => {
    const sp = { ...spread(), elements: [photoEl({ frame: { x: -3, y: -3, w: 426, h: 216 } })] }
    const auto = folios(render(<SpreadView spread={sp} page={PAGE} spreadIndex={1} />).container)
    expect(auto[0].style.color).toBe('rgb(255, 255, 255)')
    const fixed = folios(render(<SpreadView spread={sp} page={{ ...PAGE, pageNumbers: { show: true, autoColor: false, color: '#112233' } }} spreadIndex={1} />).container)
    expect(fixed[0].style.color).toBe('rgb(17, 34, 51)')
  })
})

describe('SpreadView — styles', () => {
  const textEl = (o: Partial<BookTextElement> = {}): BookTextElement => ({
    ...elBase, kind: 'text', text: 'Hola', font: 'sans', size: 20, weight: 400, italic: false, align: 'left',
    leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: false, ...o,
  })
  const imgOf = (c: HTMLElement) => c.querySelector('img') as HTMLImageElement

  it('FE-SPREADVIEW-019: new filters apply their CSS filter to the photo', () => {
    const { container } = render(<ElementView el={photoEl({ filter: 'vintage' })} big print />)
    expect(imgOf(container).style.filter).toContain('sepia(0.35)')
    const noir = render(<ElementView el={photoEl({ filter: 'noir' })} big print />)
    expect(imgOf(noir.container).style.filter).toContain('grayscale(1)')
  })

  it('FE-SPREADVIEW-020: an unknown filter (an older/newer book) renders the photo unfiltered', () => {
    const { container } = render(<ElementView el={photoEl({ filter: 'made-up' as any })} big print />)
    expect(imgOf(container).style.filter).toBe('')
  })

  it('FE-SPREADVIEW-021: tape draws two strips and corners draws four, over the photo', () => {
    const tape = render(<ElementView el={photoEl({ frameStyle: 'tape' })} big print />)
    const frame = tape.container.querySelector('[data-frame="tape"]')!
    expect(frame.children.length).toBe(3) // picture + 2 strips
    const corners = render(<ElementView el={photoEl({ frameStyle: 'corners' })} big print />)
    expect(corners.container.querySelectorAll('[data-frame="corners"] > svg')).toHaveLength(4)
  })

  it('FE-SPREADVIEW-022: padded frames (stamp, double) inset the picture; the stamp gets a perforation mask', () => {
    const { container } = render(<ElementView el={photoEl({ frameStyle: 'stamp' })} big print />)
    const outer = container.querySelector('[data-frame="stamp"]') as HTMLElement
    expect(outer.style.background).toContain('rgb(255, 255, 255)')
    const picture = outer.firstElementChild as HTMLElement
    expect(parseFloat(picture.style.left)).toBeGreaterThan(0)
  })

  it('FE-SPREADVIEW-023: text effects and uppercase render', () => {
    const shadow = render(<ElementView el={textEl({ effect: 'shadow' })} big />)
    expect((shadow.container.querySelector('span') as HTMLElement).style.textShadow).not.toBe('')
    const hl = render(<ElementView el={textEl({ effect: 'highlight', highlight: '#00ff00' })} big />)
    expect((hl.container.querySelector('span') as HTMLElement).style.backgroundImage).toContain('rgb(0, 255, 0)')
    const up = render(<ElementView el={textEl({ uppercase: true })} big />)
    expect((up.container.firstElementChild as HTMLElement).style.textTransform).toBe('uppercase')
  })

  it('FE-SPREADVIEW-024: text saved before effects existed renders as before (no decoration)', () => {
    const { container } = render(<ElementView el={textEl()} big />)
    const span = container.querySelector('span') as HTMLElement
    expect(span.style.textShadow).toBe('')
    expect(span.style.backgroundImage).toBe('')
  })
})

describe('SpreadView — page numbers on single pages', () => {
  const folios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-folio]'))

  it('FE-SPREADVIEW-025: the first page carries its one number on the right (outer) edge; the last page on the left', () => {
    const first = folios(render(<SpreadView spread={spread('first')} page={{ ...PAGE, pageNumbers: { show: true, margin: 10 } }} spreadIndex={1} folios={[1]} />).container)
    expect(first.map(f => f.textContent)).toEqual(['1'])
    expect(first[0].style.textAlign).toBe('right')
    const last = folios(render(<SpreadView spread={spread('last')} page={{ ...PAGE, pageNumbers: { show: true, margin: 10 } }} spreadIndex={5} folios={[6]} />).container)
    expect(last[0].style.textAlign).toBe('left')
    expect(last[0].style.left).toBe('10mm')
  })

  it('FE-SPREADVIEW-026: given folios win over the old arithmetic (a spread behind a first page reads 2 – 3)', () => {
    const f = folios(render(<SpreadView spread={spread()} page={{ ...PAGE, pageNumbers: { show: true, startAt: 1 } }} spreadIndex={2} folios={[2, 3]} />).container)
    expect(f.map(x => x.textContent)).toEqual(['2', '3'])
  })
})

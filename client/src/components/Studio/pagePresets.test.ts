// FE-PAGEPRESETS-001 to FE-PAGEPRESETS-014
import { PAGE_PRESETS, pageSetupFor, clampPageSize, clampPageEdge, presetMatching, reflowDocument } from './pagePresets'
import type { BookDocument, BookElement, BookPageSetup } from '../../types/book'

describe('pageSetupFor', () => {
  it('FE-PAGEPRESETS-001: a named preset resolves to its table dimensions', () => {
    const setup = pageSetupFor('a4-portrait')
    expect(setup).toEqual({ preset: 'a4-portrait', pageWidth: 210, pageHeight: 297, bleed: 3, safe: 5 })
  })

  it('FE-PAGEPRESETS-002: custom uses the given dimensions, not a table lookup', () => {
    const setup = pageSetupFor('custom', { pageWidth: 203.2, pageHeight: 254, bleed: 3.18 })
    expect(setup).toEqual({ preset: 'custom', pageWidth: 203.2, pageHeight: 254, bleed: 3.18, safe: 5 })
  })

  it('FE-PAGEPRESETS-003: custom with no dimensions given falls back to a sane default rather than throwing', () => {
    const setup = pageSetupFor('custom')
    expect(setup.pageWidth).toBeGreaterThan(0)
    expect(setup.pageHeight).toBeGreaterThan(0)
  })

  it('FE-PAGEPRESETS-004: every named preset has a positive width and height', () => {
    for (const key of Object.keys(PAGE_PRESETS) as (keyof typeof PAGE_PRESETS)[]) {
      expect(PAGE_PRESETS[key].pageWidth).toBeGreaterThan(0)
      expect(PAGE_PRESETS[key].pageHeight).toBeGreaterThan(0)
    }
  })
})

const SQ: BookPageSetup = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function photo(id: string, frame: BookElement['frame']): BookElement {
  return { id, kind: 'photo', frame, rotation: 0, opacity: 1, locked: false, photoId: 1, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 4, filter: 'none', frameStyle: 'none', mask: null } as BookElement
}
function text(id: string, frame: BookElement['frame'], size = 12): BookElement {
  return { id, kind: 'text', frame, rotation: 0, opacity: 1, locked: false, text: 'x', font: 'sans', size, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0, color: '#000', binding: null, overridden: false } as BookElement
}
function bookWith(cover: BookElement[], inner: BookElement[], parked: BookElement[] = []): BookDocument {
  return {
    version: 1, title: 'T', page: SQ,
    spreads: [
      { id: 'c', role: 'cover', background: null, elements: cover, parked: [], entryId: null },
      { id: 's', role: 'inner', background: null, elements: inner, parked, entryId: 7 },
    ],
  }
}

describe('page size limits', () => {
  it('FE-PAGEPRESETS-005: clampPageSize keeps a trim between 50 and 600 mm, to a tenth', () => {
    expect(clampPageSize(10)).toBe(50)
    expect(clampPageSize(9999)).toBe(600)
    expect(clampPageSize(203.24)).toBe(203.2)
    expect(clampPageSize(Number.NaN)).toBe(50)
  })

  it('FE-PAGEPRESETS-006: clampPageEdge caps bleed at 20 and the safe margin at 40, never negative', () => {
    expect(clampPageEdge('bleed', 25)).toBe(20)
    expect(clampPageEdge('safe', 55)).toBe(40)
    expect(clampPageEdge('bleed', -2)).toBe(0)
    expect(clampPageEdge('safe', 7.25)).toBe(7.3)
  })

  it('FE-PAGEPRESETS-007: presetMatching names a preset when the pair matches one, custom otherwise', () => {
    expect(presetMatching(210, 297)).toBe('a4-portrait')
    expect(presetMatching(297, 210)).toBe('a4-landscape')
    expect(presetMatching(200, 250)).toBe('custom')
  })

  it('FE-PAGEPRESETS-008: a custom setup can never be created with a zero or absurd size', () => {
    const setup = pageSetupFor('custom', { pageWidth: 0, pageHeight: 5000, bleed: 3 })
    expect(setup.pageWidth).toBe(50)
    expect(setup.pageHeight).toBe(600)
  })
})

describe('reflowDocument', () => {
  const A5L: BookPageSetup = { ...SQ, preset: 'a5-landscape', pageWidth: 210, pageHeight: 148 }
  const A4P: BookPageSetup = { ...SQ, preset: 'a4-portrait', pageWidth: 210, pageHeight: 297 }

  it('FE-PAGEPRESETS-009: a full-bleed cover photo still runs exactly to the new bleed edge', () => {
    const d = reflowDocument(bookWith([photo('p', { x: -3, y: -3, w: 216, h: 216 })], []), { ...A4P, bleed: 5 })
    expect(d.spreads[0].elements[0].frame).toEqual({ x: -5, y: -5, w: 220, h: 307 })
  })

  it('FE-PAGEPRESETS-010: a photo filling the left page of a spread still fills exactly the left page', () => {
    const d = reflowDocument(bookWith([], [photo('p', { x: -3, y: -3, w: 213, h: 216 })]), A5L)
    expect(d.spreads[1].elements[0].frame).toEqual({ x: -3, y: -3, w: 213, h: 154 })
  })

  it('FE-PAGEPRESETS-011: an element centred on the page stays centred', () => {
    const d = reflowDocument(bookWith([text('t', { x: 80, y: 95, w: 50, h: 20 })], []), A4P)
    const f = d.spreads[0].elements[0].frame
    expect(f.x + f.w / 2).toBeCloseTo(105, 1)
    expect(f.y + f.h / 2).toBeCloseTo(148.5, 1)
  })

  it('FE-PAGEPRESETS-012: type scales by the smaller factor, so a shorter page never widens its text', () => {
    const d = reflowDocument(bookWith([text('t', { x: 10, y: 10, w: 100, h: 20 }, 20)], []), A5L)
    const el = d.spreads[0].elements[0] as Extract<BookElement, { kind: 'text' }>
    expect(el.size).toBeLessThan(20)
    expect(el.size).toBeGreaterThan(13)
    // A taller page (x unchanged) leaves type alone.
    const d2 = reflowDocument(bookWith([text('t', { x: 10, y: 10, w: 100, h: 20 }, 20)], []), A4P)
    expect((d2.spreads[0].elements[0] as Extract<BookElement, { kind: 'text' }>).size).toBe(20)
  })

  it('FE-PAGEPRESETS-013: parked elements move with their spread, and ids, order and content survive', () => {
    const before = bookWith([], [photo('a', { x: 0, y: 0, w: 10, h: 10 }), text('b', { x: 300, y: 100, w: 40, h: 10 })], [photo('z', { x: 20, y: 20, w: 30, h: 30 })])
    const d = reflowDocument(before, A4P)
    expect(d.spreads[1].elements.map(e => e.id)).toEqual(['a', 'b'])
    expect(d.spreads[1].parked[0].frame.h).toBeGreaterThan(30)
    expect(d.spreads[1].entryId).toBe(7)
    expect(d.page).toEqual(A4P)
    expect(before.spreads[1].elements[0].frame).toEqual({ x: 0, y: 0, w: 10, h: 10 }) // input untouched
  })

  it('FE-PAGEPRESETS-014: same size and bleed is a no-op on geometry', () => {
    const before = bookWith([photo('p', { x: 1, y: 2, w: 3, h: 4 })], [])
    const d = reflowDocument(before, { ...SQ, safe: 12 })
    expect(d.spreads).toBe(before.spreads)
    expect(d.page.safe).toBe(12)
  })
})

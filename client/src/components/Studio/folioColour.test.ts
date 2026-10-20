// FE-FOLIOCOLOUR-001 to FE-FOLIOCOLOUR-005
import { brightness, folioInk } from './folioColour'
import type { BookElement, BookSpread } from '../../types/book'

const base = { rotation: 0, opacity: 1, locked: false }
const photo = (frame: BookElement['frame'], extra: Partial<BookElement> = {}) => ({ ...base, id: 'p', kind: 'photo', frame, photoId: 1, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null, ...extra }) as BookElement
const shape = (fill: string | null) => ({ ...base, id: 's', kind: 'shape', frame: { x: 0, y: 0, w: 100, h: 100 }, shape: 'rect', fill, gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0 }) as BookElement
const spread = (elements: BookElement[], background: string | null = null): BookSpread => ({ id: 'x', role: 'inner', background, elements, parked: [], entryId: null })

describe('folioInk', () => {
  it('FE-FOLIOCOLOUR-001: dark ink on plain white paper, light ink on a dark page', () => {
    expect(folioInk(spread([]), 10, 10).color).toBe('#3f3a33')
    expect(folioInk(spread([], '#101820'), 10, 10).color).toBe('#ffffff')
  })

  it('FE-FOLIOCOLOUR-002: over a photo it goes light, with a shadow', () => {
    const ink = folioInk(spread([photo({ x: 0, y: 0, w: 50, h: 50 })]), 10, 10)
    expect(ink.color).toBe('#ffffff')
    expect(ink.shadow).toBeTruthy()
  })

  it('FE-FOLIOCOLOUR-003: only what is actually under the number counts', () => {
    expect(folioInk(spread([photo({ x: 60, y: 60, w: 10, h: 10 })]), 10, 10).color).toBe('#3f3a33')
  })

  it('FE-FOLIOCOLOUR-004: an unfilled or nearly transparent element is looked through', () => {
    expect(folioInk(spread([photo({ x: 0, y: 0, w: 50, h: 50 }), shape(null)]), 10, 10).color).toBe('#ffffff')
    expect(folioInk(spread([photo({ x: 0, y: 0, w: 50, h: 50 }, { opacity: 0.2 })]), 10, 10).color).toBe('#3f3a33')
    expect(folioInk(spread([shape('#fafafa')], '#000000'), 10, 10).color).toBe('#3f3a33')
  })

  it('FE-FOLIOCOLOUR-005: brightness reads 3- and 6-digit hex, and treats junk as white', () => {
    expect(brightness('#fff')).toBeCloseTo(1)
    expect(brightness('#000000')).toBe(0)
    expect(brightness('red')).toBe(1)
  })
})

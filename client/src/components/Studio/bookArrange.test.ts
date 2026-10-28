// FE-BOOKARRANGE-001 to FE-BOOKARRANGE-008
import { describe, it, expect } from 'vitest'
import type { BookElement, BookFrame, BookPageSetup, BookSpread } from '../../types/book'
import { alignElements, arrangeElements, arrangeWithinGroup, distributableCount, distributeElements } from './bookArrange'

const PAGE: BookPageSetup = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 10 }

function shape(id: string, frame: BookFrame, group?: string): BookElement {
  return {
    id, kind: 'shape', frame, rotation: 0, opacity: 1, locked: false, ...(group ? { group } : {}),
    shape: 'rect', fill: '#111111', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
  }
}
const spread = (elements: BookElement[]): BookSpread => ({ id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null })
const at = (sp: BookSpread, id: string) => sp.elements.find(e => e.id === id)!.frame

describe('bookArrange', () => {
  it('FE-BOOKARRANGE-001: align left lines the selection up on its own leftmost edge', () => {
    const sp = spread([shape('a', { x: 20, y: 0, w: 10, h: 10 }), shape('b', { x: 50, y: 30, w: 20, h: 10 })])
    const next = alignElements(sp, PAGE, sp.elements, 'left', 'selection')
    expect(at(next, 'a').x).toBe(20)
    expect(at(next, 'b').x).toBe(20)
    expect(at(next, 'b').y).toBe(30)
  })

  it('FE-BOOKARRANGE-002: a single element centred on the page it sits on — the right page of a spread', () => {
    const sp = spread([shape('a', { x: 300, y: 0, w: 10, h: 10 })])
    const next = alignElements(sp, PAGE, sp.elements, 'center', 'page')
    expect(at(next, 'a').x).toBe(210 + 100)
  })

  it('FE-BOOKARRANGE-003: aligning to the safe area respects the margin', () => {
    const sp = spread([shape('a', { x: 50, y: 50, w: 10, h: 10 })])
    const next = alignElements(sp, PAGE, sp.elements, 'top', 'safe')
    expect(at(next, 'a').y).toBe(10)
  })

  it('FE-BOOKARRANGE-004: a group aligns as one box, its members keeping their places inside it', () => {
    const sp = spread([
      shape('a', { x: 40, y: 0, w: 10, h: 10 }, 'g'), shape('b', { x: 60, y: 0, w: 10, h: 10 }, 'g'),
      shape('c', { x: 10, y: 50, w: 10, h: 10 }),
    ])
    const next = alignElements(sp, PAGE, sp.elements, 'left', 'selection')
    expect(at(next, 'a').x).toBe(10)
    expect(at(next, 'b').x).toBe(30)
    expect(at(next, 'c').x).toBe(10)
  })

  it('FE-BOOKARRANGE-005: distribute spaces three boxes evenly between the outer two', () => {
    const sp = spread([shape('a', { x: 0, y: 0, w: 10, h: 10 }), shape('b', { x: 15, y: 0, w: 10, h: 10 }), shape('c', { x: 90, y: 0, w: 10, h: 10 })])
    const next = distributeElements(sp, sp.elements, 'horizontal')
    expect(at(next, 'a').x).toBe(0)
    expect(at(next, 'b').x).toBe(45)
    expect(at(next, 'c').x).toBe(90)
  })

  it('FE-BOOKARRANGE-006: fewer than three units is not something to distribute', () => {
    const sp = spread([shape('a', { x: 0, y: 0, w: 10, h: 10 }, 'g'), shape('b', { x: 15, y: 0, w: 10, h: 10 }, 'g'), shape('c', { x: 90, y: 0, w: 10, h: 10 })])
    expect(distributableCount(sp, sp.elements)).toBe(2)
    expect(distributeElements(sp, sp.elements, 'horizontal')).toBe(sp)
  })

  it('FE-BOOKARRANGE-007: a step forward goes past a whole group at once, never into it', () => {
    const f = { x: 0, y: 0, w: 1, h: 1 }
    const sp = spread([shape('a', f), shape('g1', f, 'g'), shape('g2', f, 'g'), shape('z', f)])
    expect(arrangeElements(sp, ['a'], 'forward').elements.map(e => e.id)).toEqual(['g1', 'g2', 'a', 'z'])
    expect(arrangeElements(sp, ['g1', 'g2'], 'front').elements.map(e => e.id)).toEqual(['a', 'z', 'g1', 'g2'])
    expect(arrangeElements(sp, ['z'], 'back').elements.map(e => e.id)).toEqual(['z', 'a', 'g1', 'g2'])
  })

  it('FE-BOOKARRANGE-008: inside a group, a member moves among the members only', () => {
    const f = { x: 0, y: 0, w: 1, h: 1 }
    const sp = spread([shape('a', f), shape('g1', f, 'g'), shape('g2', f, 'g'), shape('g3', f, 'g'), shape('z', f)])
    expect(arrangeWithinGroup(sp, 'g', ['g1'], 'front').elements.map(e => e.id)).toEqual(['a', 'g2', 'g3', 'g1', 'z'])
  })
})

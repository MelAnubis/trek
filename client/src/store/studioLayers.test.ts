// FE-STORE-STUDIOLAYERS-001 to FE-STORE-STUDIOLAYERS-014
import { describe, it, expect, beforeEach } from 'vitest'
import { useStudioStore } from './studioStore'
import type { BookDocument, BookElement, BookFrame, BookTextElement } from '../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function shape(id: string, frame: BookFrame = { x: 10, y: 10, w: 10, h: 10 }, extra: Partial<BookElement> = {}): BookElement {
  return {
    id, kind: 'shape', frame, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill: '#111111', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
    ...extra,
  } as BookElement
}
function text(id: string, extra: Partial<BookTextElement> = {}): BookTextElement {
  return {
    id, kind: 'text', frame: { x: 0, y: 0, w: 40, h: 10 }, rotation: 0, opacity: 1, locked: false,
    text: 'hi', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0,
    color: '#000000', binding: null, overridden: false, ...extra,
  }
}
function doc(elements: BookElement[]): BookDocument {
  return {
    version: 1, title: '', page: PAGE,
    spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      { id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null },
    ],
  }
}
const S = () => useStudioStore.getState()
const els = () => S().doc!.spreads[1].elements
const initial = useStudioStore.getState()

beforeEach(() => { useStudioStore.setState(initial, true) })

function setup(elements: BookElement[]) {
  S().load(doc(elements))
  S().setActiveSpread(1)
}

describe('studio store — groups and layers', () => {
  it('FE-STORE-STUDIOLAYERS-001: Ctrl+G groups the unlocked selection; a click on a member then picks the whole group', () => {
    setup([shape('a'), shape('b'), shape('c', undefined, { locked: true })])
    S().select(['a', 'b', 'c'])
    S().group(1)
    const g = els().find(e => e.id === 'a')!.group
    expect(g).toBeTruthy()
    expect(els().find(e => e.id === 'b')!.group).toBe(g)
    expect(els().find(e => e.id === 'c')!.group).toBeUndefined()
    S().select([])
    S().pick(1, 'b', false)
    expect(S().selection.sort()).toEqual(['a', 'b'])
  })

  it('FE-STORE-STUDIOLAYERS-002: entering a group picks one member; Escape (leaveGroup) gives the whole group back', () => {
    setup([shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' })])
    S().enterGroup(1, 'a')
    expect(S().selection).toEqual(['a'])
    S().pick(1, 'b', false)
    expect(S().selection).toEqual(['b'])
    expect(S().leaveGroup(1)).toBe(true)
    expect(S().selection).toEqual(['a', 'b'])
    expect(S().enteredGroup).toBeNull()
  })

  it('FE-STORE-STUDIOLAYERS-003: ungroup is one undo step', () => {
    setup([shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' })])
    S().select(['a', 'b'])
    S().ungroup(1)
    expect(els().every(e => !e.group)).toBe(true)
    S().undo()
    expect(els().every(e => e.group === 'g')).toBe(true)
  })

  it('FE-STORE-STUDIOLAYERS-004: deleting one of two members dissolves the group', () => {
    setup([shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' })])
    S().removeElements(1, ['a'])
    expect(els()).toHaveLength(1)
    expect(els()[0].group).toBeUndefined()
  })

  it('FE-STORE-STUDIOLAYERS-005: holding an arrow is one undo step, and a locked element stays put', () => {
    setup([shape('a'), shape('b', undefined, { locked: true })])
    S().select(['a', 'b'])
    S().beginGesture()
    S().nudge(1, 1, 0)
    S().nudge(1, 1, 0)
    S().nudge(1, 0, 10)
    S().endGesture()
    expect(els()[0].frame).toMatchObject({ x: 12, y: 20 })
    expect(els()[1].frame).toMatchObject({ x: 10, y: 10 })
    S().undo()
    expect(els()[0].frame).toMatchObject({ x: 10, y: 10 })
  })

  it('FE-STORE-STUDIOLAYERS-006: align and distribute through the store', () => {
    setup([shape('a', { x: 0, y: 0, w: 10, h: 10 }), shape('b', { x: 30, y: 40, w: 10, h: 10 }), shape('c', { x: 100, y: 5, w: 10, h: 10 })])
    S().select(['a', 'b', 'c'])
    S().align(1, 'top', 'selection')
    expect(els().map(e => e.frame.y)).toEqual([0, 0, 0])
    S().distribute(1, 'horizontal')
    expect(els().map(e => e.frame.x)).toEqual([0, 50, 100])
  })

  it('FE-STORE-STUDIOLAYERS-007: restack — dropping above a member joins its group, dragging it out leaves it', () => {
    setup([shape('x'), shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' })])
    S().restack(1, ['x'], 'b', 'above', true)
    expect(els().map(e => e.id)).toEqual(['a', 'b', 'x'])
    expect(els().every(e => e.group === 'g')).toBe(true)
    S().restack(1, ['x'], 'a', 'below', false)
    expect(els().map(e => e.id)).toEqual(['x', 'a', 'b'])
    expect(els()[0].group).toBeUndefined()
  })

  it('FE-STORE-STUDIOLAYERS-008: hiding a layer takes it out of the selection', () => {
    setup([shape('a'), shape('b')])
    S().select(['a', 'b'])
    S().setHidden(1, ['a'], true)
    expect(els()[0].hidden).toBe(true)
    expect(S().selection).toEqual(['b'])
    S().selectAll(1)
    expect(S().selection).toEqual(['b'])
  })

  it('FE-STORE-STUDIOLAYERS-009: lock and rename are undoable steps', () => {
    setup([shape('a')])
    S().setLocked(1, ['a'], true)
    S().renameLayer(1, { elementId: 'a' }, 'Background')
    expect(els()[0]).toMatchObject({ locked: true, name: 'Background' })
    S().undo()
    expect(els()[0].name).toBeUndefined()
    expect(els()[0].locked).toBe(true)
  })

  it('FE-STORE-STUDIOLAYERS-010: copy style from one text and paste it onto another — one undo step', () => {
    setup([text('a', { font: 'serif', size: 30, color: '#aa0000' }), text('b', { text: 'keep me' })])
    S().select(['a'])
    S().copyStyle(1)
    S().select(['b'])
    S().pasteStyle(1)
    const b = els()[1] as BookTextElement
    expect(b).toMatchObject({ font: 'serif', size: 30, color: '#aa0000', text: 'keep me' })
    S().undo()
    expect((els()[1] as BookTextElement).font).toBe('sans')
  })

  it('FE-STORE-STUDIOLAYERS-011: duplicating a group makes a new group, not more members of the old one', () => {
    setup([shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' })])
    S().duplicate(1, ['a', 'b'])
    const groups = new Set(els().map(e => e.group))
    expect(els()).toHaveLength(4)
    expect(groups.size).toBe(2)
    expect(S().selection).toHaveLength(2)
  })

  it('FE-STORE-STUDIOLAYERS-012: pasting a group onto another page keeps it a group of its own', () => {
    setup([shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' })])
    S().copy(1, ['a', 'b'])
    S().setActiveSpread(0)
    S().paste(0)
    const pasted = S().doc!.spreads[0].elements
    expect(pasted).toHaveLength(2)
    expect(pasted[0].group).toBeTruthy()
    expect(pasted[0].group).toBe(pasted[1].group)
    expect(pasted[0].group).not.toBe('g')
  })

  it('FE-STORE-STUDIOLAYERS-013: raising a member of a group takes the whole group to the front', () => {
    setup([shape('a', undefined, { group: 'g' }), shape('b', undefined, { group: 'g' }), shape('z')])
    S().raise(1, ['a'], 'front')
    expect(els().map(e => e.id)).toEqual(['z', 'a', 'b'])
  })

  it('FE-STORE-STUDIOLAYERS-014: read-only refuses every change, undo included', () => {
    setup([shape('a')])
    S().select(['a'])
    S().setReadOnly(true)
    const before = S().doc
    S().nudge(1, 5, 5)
    S().group(1)
    S().setHidden(1, ['a'], true)
    S().addElement(1, shape('new'))
    S().removeElements(1, ['a'])
    S().undo()
    expect(S().doc).toBe(before)
    expect(S().canUndo()).toBe(false)
  })
})

// FE-BOOKGROUPS-001 to FE-BOOKGROUPS-010
import { describe, it, expect } from 'vitest'
import type { BookElement, BookShapeElement, BookSpread } from '../../types/book'
import {
  commonGroup, expandToGroups, gatherGroups, groupElements, isWholeGroup, regroupCopies, renameElement,
  renameGroup, setElementsHidden, tidyGroups, ungroupElements, visibleSpread,
} from './bookGroups'

function shape(id: string, extra: Partial<BookShapeElement> = {}): BookElement {
  return {
    id, kind: 'shape', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill: '#111111', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
    ...extra,
  }
}
const spread = (elements: BookElement[], groups?: BookSpread['groups']): BookSpread =>
  ({ id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null, ...(groups ? { groups } : {}) })
const ids = (sp: BookSpread) => sp.elements.map(e => e.id)

describe('bookGroups', () => {
  it('FE-BOOKGROUPS-001: grouping gathers the members at the place of the topmost one, keeping their order', () => {
    const sp = groupElements(spread([shape('a'), shape('b'), shape('c'), shape('d')]), ['a', 'c'], 'g1', 'Pair')
    expect(ids(sp)).toEqual(['b', 'a', 'c', 'd'])
    expect(sp.elements.filter(e => e.group === 'g1').map(e => e.id)).toEqual(['a', 'c'])
    expect(sp.groups).toEqual([{ id: 'g1', name: 'Pair' }])
  })

  it('FE-BOOKGROUPS-002: a group of one is not a group — it dissolves, and its name goes with it', () => {
    const sp = tidyGroups(spread([shape('a', { group: 'g1' }), shape('b')], [{ id: 'g1', name: 'X' }]))
    expect(sp.elements[0].group).toBeUndefined()
    expect(sp.groups).toBeUndefined()
  })

  it('FE-BOOKGROUPS-003: an untouched spread comes back as the same object', () => {
    const sp = spread([shape('a', { group: 'g1' }), shape('b', { group: 'g1' })])
    expect(tidyGroups(sp)).toBe(sp)
    expect(gatherGroups(sp)).toBe(sp)
  })

  it('FE-BOOKGROUPS-004: expandToGroups takes every member of a touched group along', () => {
    const sp = spread([shape('a', { group: 'g1' }), shape('b'), shape('c', { group: 'g1' })])
    expect(expandToGroups(sp, ['a'])).toEqual(['a', 'c'])
    expect(expandToGroups(sp, ['b'])).toEqual(['b'])
  })

  it('FE-BOOKGROUPS-005: commonGroup / isWholeGroup tell a whole group from part of one', () => {
    const sp = spread([shape('a', { group: 'g1' }), shape('b', { group: 'g1' }), shape('c', { group: 'g1' })])
    expect(commonGroup(sp, ['a', 'b'])).toBe('g1')
    expect(isWholeGroup(sp, ['a', 'b'])).toBe(false)
    expect(isWholeGroup(sp, ['a', 'b', 'c'])).toBe(true)
  })

  it('FE-BOOKGROUPS-006: ungrouping puts the members back on their own, where they are', () => {
    const sp = ungroupElements(spread([shape('a', { group: 'g1' }), shape('b', { group: 'g1' })], [{ id: 'g1', name: 'X' }]), 'g1')
    expect(sp.elements.every(e => e.group === undefined)).toBe(true)
    expect(sp.groups).toBeUndefined()
  })

  it('FE-BOOKGROUPS-007: hiding stores `hidden: true`, showing drops the field; visibleSpread leaves hidden ones out', () => {
    const hidden = setElementsHidden(spread([shape('a'), shape('b')]), ['a'], true)
    expect(hidden.elements[0].hidden).toBe(true)
    expect(ids(visibleSpread(hidden))).toEqual(['b'])
    const shown = setElementsHidden(hidden, ['a'], false)
    expect('hidden' in shown.elements[0]).toBe(false)
  })

  it('FE-BOOKGROUPS-008: renaming sets or clears a name; an empty name clears it', () => {
    let sp = renameElement(spread([shape('a')]), 'a', '  Sky  ')
    expect(sp.elements[0].name).toBe('Sky')
    sp = renameElement(sp, 'a', '   ')
    expect('name' in sp.elements[0]).toBe(false)
    const g = renameGroup(spread([shape('a', { group: 'g' }), shape('b', { group: 'g' })]), 'g', 'Header')
    expect(g.groups).toEqual([{ id: 'g', name: 'Header' }])
  })

  it('FE-BOOKGROUPS-009: copies get groups of their own, names carried over; a lone copy goes ungrouped', () => {
    const source = spread([shape('a', { group: 'g1' }), shape('b', { group: 'g1' }), shape('c', { group: 'g2' }), shape('d', { group: 'g2' })], [{ id: 'g1', name: 'Pair' }])
    let n = 0
    const copied = regroupCopies([shape('a2', { group: 'g1' }), shape('b2', { group: 'g1' }), shape('c2', { group: 'g2' })], source, p => `${p}-new${++n}`)
    expect(copied.elements[0].group).toBe('g-new1')
    expect(copied.elements[1].group).toBe('g-new1')
    expect(copied.elements[2].group).toBeUndefined()
    expect(copied.groups).toEqual([{ id: 'g-new1', name: 'Pair' }])
  })

  it('FE-BOOKGROUPS-010: grouping elements already in another group makes one new group of all of them', () => {
    const sp = groupElements(spread([shape('a', { group: 'g1' }), shape('b', { group: 'g1' }), shape('c')]), ['b', 'c'], 'g2')
    // `a` is left alone in g1, so g1 dissolves.
    expect(sp.elements.find(e => e.id === 'a')?.group).toBeUndefined()
    expect(sp.elements.filter(e => e.group === 'g2').map(e => e.id)).toEqual(['b', 'c'])
  })
})

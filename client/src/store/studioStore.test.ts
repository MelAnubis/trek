// FE-STORE-STUDIO-001 to FE-STORE-STUDIO-020
import { useStudioStore } from './studioStore'
import type { BookDocument, BookTextElement } from '../types/book'

const initialState = useStudioStore.getState()

function textEl(id: string, overrides: Partial<BookTextElement> = {}): BookTextElement {
  return {
    id, kind: 'text', frame: { x: 0, y: 0, w: 20, h: 10 }, rotation: 0, opacity: 1, locked: false,
    text: 'hi', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0,
    color: '#000000', binding: null, overridden: false,
    ...overrides,
  }
}

function doc(overrides: Partial<BookDocument> = {}): BookDocument {
  return {
    version: 1,
    title: '',
    page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
    spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      { id: 'sp-1', role: 'inner', background: null, elements: [textEl('t-1')], parked: [], entryId: null },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  useStudioStore.setState(initialState, true)
})

describe('studioStore — load / selection', () => {
  it('FE-STORE-STUDIO-001: load resets selection, active spread and history', () => {
    useStudioStore.getState().load(doc())
    expect(useStudioStore.getState().doc).not.toBeNull()
    expect(useStudioStore.getState().selection).toEqual([])
    expect(useStudioStore.getState().activeSpread).toBe(0)
    expect(useStudioStore.getState().past).toEqual([])
  })

  it('FE-STORE-STUDIO-002: toggleSelect adds/removes additively, replaces otherwise', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().select(['a'])
    useStudioStore.getState().toggleSelect('b', true)
    expect(useStudioStore.getState().selection).toEqual(['a', 'b'])
    useStudioStore.getState().toggleSelect('a', true)
    expect(useStudioStore.getState().selection).toEqual(['b'])
    useStudioStore.getState().toggleSelect('c', false)
    expect(useStudioStore.getState().selection).toEqual(['c'])
  })
})

describe('studioStore — commit / undo / redo', () => {
  it('FE-STORE-STUDIO-003: commit pushes history and undo restores the previous document', () => {
    useStudioStore.getState().load(doc())
    const before = useStudioStore.getState().doc
    useStudioStore.getState().commit(d => ({ ...d, title: 'changed' }))
    expect(useStudioStore.getState().doc?.title).toBe('changed')
    expect(useStudioStore.getState().canUndo()).toBe(true)

    useStudioStore.getState().undo()
    expect(useStudioStore.getState().doc).toBe(before)
    expect(useStudioStore.getState().canRedo()).toBe(true)

    useStudioStore.getState().redo()
    expect(useStudioStore.getState().doc?.title).toBe('changed')
  })

  it('FE-STORE-STUDIO-004: a no-op commit (returns the same doc) does not push history', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().commit(d => d)
    expect(useStudioStore.getState().canUndo()).toBe(false)
  })

  it('FE-STORE-STUDIO-005: beginGesture/endGesture collapse many apply() calls into one undo step', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().beginGesture()
    for (let i = 0; i < 5; i++) {
      useStudioStore.getState().apply(d => ({ ...d, title: `t${i}` }))
    }
    useStudioStore.getState().endGesture()
    expect(useStudioStore.getState().doc?.title).toBe('t4')
    expect(useStudioStore.getState().past).toHaveLength(1)

    useStudioStore.getState().undo()
    expect(useStudioStore.getState().doc?.title).toBe('')
  })

  it('FE-STORE-STUDIO-006: endGesture with no actual change pushes nothing', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().beginGesture()
    useStudioStore.getState().endGesture()
    expect(useStudioStore.getState().past).toHaveLength(0)
  })
})

describe('studioStore — element operations', () => {
  it('FE-STORE-STUDIO-007: addElement appends to the spread and selects it', () => {
    useStudioStore.getState().load(doc())
    const el = textEl('t-2')
    useStudioStore.getState().addElement(1, el)
    expect(useStudioStore.getState().doc?.spreads[1].elements.map(e => e.id)).toEqual(['t-1', 't-2'])
    expect(useStudioStore.getState().selection).toEqual(['t-2'])
  })

  it('FE-STORE-STUDIO-008: setFrame updates only the target element', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().setFrame(1, 't-1', { x: 5, y: 5, w: 30, h: 15 })
    const el = useStudioStore.getState().doc?.spreads[1].elements[0]
    expect(el?.frame).toEqual({ x: 5, y: 5, w: 30, h: 15 })
  })

  it('FE-STORE-STUDIO-009: removeElements filters by id and clears selection', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().select(['t-1'])
    useStudioStore.getState().removeElements(1, ['t-1'])
    expect(useStudioStore.getState().doc?.spreads[1].elements).toEqual([])
    expect(useStudioStore.getState().selection).toEqual([])
  })

  it('FE-STORE-STUDIO-010: duplicate offsets the copy and selects the new id(s)', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().duplicate(1, ['t-1'])
    const els = useStudioStore.getState().doc!.spreads[1].elements
    expect(els).toHaveLength(2)
    expect(els[1].frame.x).toBe(4)
    expect(els[1].frame.y).toBe(4)
    expect(els[1].id).not.toBe('t-1')
    expect(useStudioStore.getState().selection).toEqual([els[1].id])
  })

  it('FE-STORE-STUDIO-011: raise reorders within the elements array', () => {
    const d = doc({ spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      { id: 'sp-1', role: 'inner', background: null, elements: [textEl('a'), textEl('b'), textEl('c')], parked: [], entryId: null },
    ] })
    useStudioStore.getState().load(d)
    useStudioStore.getState().raise(1, 'a', 'front')
    expect(useStudioStore.getState().doc?.spreads[1].elements.map(e => e.id)).toEqual(['b', 'c', 'a'])

    useStudioStore.getState().raise(1, 'a', 'back')
    expect(useStudioStore.getState().doc?.spreads[1].elements.map(e => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('studioStore — spread management', () => {
  it('FE-STORE-STUDIO-012: canEditSpread is true only for inner spreads', () => {
    useStudioStore.getState().load(doc())
    expect(useStudioStore.getState().canEditSpread(0)).toBe(false) // cover
    expect(useStudioStore.getState().canEditSpread(1)).toBe(true) // inner
  })

  it('FE-STORE-STUDIO-013: addSpread inserts after the given index, inside the covers', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().addSpread(1)
    const spreads = useStudioStore.getState().doc!.spreads
    expect(spreads).toHaveLength(3)
    expect(spreads[0].role).toBe('cover')
    expect(spreads[1].role).toBe('inner')
    expect(spreads[2].role).toBe('inner')
    expect(useStudioStore.getState().activeSpread).toBe(2)
  })

  it('FE-STORE-STUDIO-014: duplicateSpread copies elements with fresh ids', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().duplicateSpread(1)
    const spreads = useStudioStore.getState().doc!.spreads
    expect(spreads).toHaveLength(3)
    expect(spreads[2].elements[0].id).not.toBe('t-1')
    expect(spreads[2].elements[0].text).toBe('hi')
  })

  it('FE-STORE-STUDIO-015: removeSpread refuses to remove the cover', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().removeSpread(0)
    expect(useStudioStore.getState().doc?.spreads).toHaveLength(2)
  })

  it('FE-STORE-STUDIO-016: moveSpread only swaps with another inner spread', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().addSpread(1)
    // spreads: [cover, inner sp-1, inner new]
    useStudioStore.getState().moveSpread(1, -1) // would swap into the cover slot — refused
    expect(useStudioStore.getState().doc?.spreads[0].role).toBe('cover')
    expect(useStudioStore.getState().doc?.spreads[1].id).toBe('sp-1')

    useStudioStore.getState().moveSpread(1, 1) // swaps with the other inner spread — allowed
    expect(useStudioStore.getState().doc?.spreads[2].id).toBe('sp-1')
  })
})

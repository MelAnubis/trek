// FE-COMP-STUDIOCANVAS-001 to FE-COMP-STUDIOCANVAS-010
import { act, render } from '@testing-library/react'
import { StudioCanvas } from './StudioCanvas'
import { useStudioStore } from '../../store/studioStore'
import type { BookDocument, BookSpread, BookTextElement } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function textEl(id: string): BookTextElement {
  return {
    id, kind: 'text', frame: { x: 0, y: 0, w: 20, h: 10 }, rotation: 0, opacity: 1, locked: false,
    text: 'hi', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0,
    color: '#000000', binding: null, overridden: false,
  }
}

function spread(id: string, role: BookSpread['role'] = 'inner', elements: BookSpread['elements'] = []): BookSpread {
  return { id, role, background: null, elements, parked: [], entryId: null }
}

function doc(spreadCount: number): BookDocument {
  return {
    version: 1,
    title: '',
    page: PAGE,
    spreads: Array.from({ length: spreadCount }, (_, i) => spread(`sp-${i}`, i === 0 ? 'cover' : 'inner', i === 1 ? [textEl('t-1')] : [])),
  }
}

function pasteEvent(data: { items?: { kind: string; type: string; getAsFile: () => File | null }[]; text?: string }): Event {
  const e = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'clipboardData', {
    value: {
      items: data.items ?? [],
      getData: (type: string) => (type === 'text/plain' ? data.text ?? '' : ''),
    },
  })
  return e
}
const emptyPasteEvent = () => pasteEvent({})
const textPasteEvent = (text: string) => pasteEvent({ text })

const initialState = useStudioStore.getState()

function renderCanvas() {
  const state = useStudioStore.getState()
  return render(
    <StudioCanvas
      spread={state.doc!.spreads[state.activeSpread]}
      spreadIndex={state.activeSpread}
      page={state.doc!.page}
      zoom={0.4}
      pxPerMm={96 / 25.4}
      bookView
      dropLabel=""
    />,
  )
}

beforeEach(() => {
  useStudioStore.setState(initialState, true)
})

describe('StudioCanvas — PageDown/PageUp navigation', () => {
  it('FE-COMP-STUDIOCANVAS-001: PageDown moves to the next spread', () => {
    useStudioStore.getState().load(doc(3))
    renderCanvas()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' })) })
    expect(useStudioStore.getState().activeSpread).toBe(1)
  })

  it('FE-COMP-STUDIOCANVAS-002: PageUp moves to the previous spread', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(2)
    renderCanvas()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' })) })
    expect(useStudioStore.getState().activeSpread).toBe(1)
  })

  it('FE-COMP-STUDIOCANVAS-003: PageDown on the last spread does nothing (no wraparound, no out-of-range index)', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(2)
    renderCanvas()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' })) })
    expect(useStudioStore.getState().activeSpread).toBe(2)
  })

  it('FE-COMP-STUDIOCANVAS-004: PageUp on the first spread does nothing', () => {
    useStudioStore.getState().load(doc(3))
    renderCanvas()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' })) })
    expect(useStudioStore.getState().activeSpread).toBe(0)
  })

  it('FE-COMP-STUDIOCANVAS-005: PageDown/PageUp are ignored while typing in a text field, so they don\'t hijack normal text editing', () => {
    useStudioStore.getState().load(doc(3))
    renderCanvas()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })) })
    expect(useStudioStore.getState().activeSpread).toBe(0)
    document.body.removeChild(input)
  })
})

describe('StudioCanvas — Ctrl/Cmd+C / Ctrl/Cmd+V', () => {
  it('FE-COMP-STUDIOCANVAS-006: Ctrl+C copies the selection, Ctrl+V pastes a fresh, offset copy', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(1)
    useStudioStore.getState().select(['t-1'])
    renderCanvas()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })) })
    expect(useStudioStore.getState().clipboard).toHaveLength(1)

    // Ctrl+V itself is a native `paste` event, not a keydown — the OS
    // clipboard is empty here (no items/text), so it falls through to
    // Studio's own in-app clipboard.
    act(() => { window.dispatchEvent(emptyPasteEvent()) })
    const els = useStudioStore.getState().doc!.spreads[1].elements
    expect(els).toHaveLength(2)
    expect(els[1].id).not.toBe('t-1')
    expect(els[1].frame.x).toBe(4)
  })

  it('FE-COMP-STUDIOCANVAS-007: Ctrl+C with nothing selected does not touch the clipboard', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(1)
    renderCanvas()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })) })
    expect(useStudioStore.getState().clipboard).toEqual([])
  })
})

describe('StudioCanvas — pasting from outside the app', () => {
  it('FE-COMP-STUDIOCANVAS-008: pasting OS clipboard text (with nothing copied in-app) adds a new text element', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(1)
    renderCanvas()
    act(() => { window.dispatchEvent(textPasteEvent('Pasted from outside')) })
    const els = useStudioStore.getState().doc!.spreads[1].elements
    expect(els).toHaveLength(2)
    const pasted = els.find(e => e.id !== 't-1')!
    expect(pasted.kind).toBe('text')
    expect((pasted as BookTextElement).text).toBe('Pasted from outside')
  })

  it('FE-COMP-STUDIOCANVAS-009: OS clipboard text is ignored in favour of Studio\'s own clipboard when something was copied in-app', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(1)
    useStudioStore.getState().select(['t-1'])
    useStudioStore.getState().copy(1, ['t-1'])
    renderCanvas()
    act(() => { window.dispatchEvent(textPasteEvent('Unrelated OS clipboard text')) })
    const els = useStudioStore.getState().doc!.spreads[1].elements
    expect(els).toHaveLength(2)
    // The in-app copy of t-1 was pasted, not a new text element from the OS clipboard.
    expect(els.some(e => e.kind === 'text' && (e as BookTextElement).text === 'Unrelated OS clipboard text')).toBe(false)
    expect(els.some(e => e.kind === 'text' && (e as BookTextElement).text === 'hi')).toBe(true)
  })

  it('FE-COMP-STUDIOCANVAS-010: pasting while focus is in a text field is left to the browser\'s own default paste', () => {
    useStudioStore.getState().load(doc(3))
    useStudioStore.getState().setActiveSpread(1)
    renderCanvas()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    act(() => { input.dispatchEvent(textPasteEvent('should not be intercepted')) })
    expect(useStudioStore.getState().doc?.spreads[1].elements).toHaveLength(1)
    document.body.removeChild(input)
  })
})

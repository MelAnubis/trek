// FE-COMP-STUDIOCANVAS-001 to FE-COMP-STUDIOCANVAS-007
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

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true })) })
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

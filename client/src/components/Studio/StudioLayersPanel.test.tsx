// FE-COMP-STUDIOLAYERS-001 to FE-COMP-STUDIOLAYERS-006
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { StudioLayersPanel } from './StudioLayersPanel'
import { useStudioStore } from '../../store/studioStore'
import type { BookDocument, BookElement } from '../../types/book'

const t = (k: string) => k

function shape(id: string, extra: Partial<BookElement> = {}): BookElement {
  return {
    id, kind: 'shape', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill: '#111111', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
    ...extra,
  } as BookElement
}
function doc(elements: BookElement[]): BookDocument {
  return {
    version: 1, title: '', page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
    spreads: [{ id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null, groups: [{ id: 'g', name: 'Header' }] }],
  }
}
const initial = useStudioStore.getState()
const els = () => useStudioStore.getState().doc!.spreads[0].elements

beforeEach(() => {
  useStudioStore.setState(initial, true)
  useStudioStore.getState().load(doc([shape('back', { name: 'Background' }), shape('m1', { group: 'g' }), shape('m2', { group: 'g' })]))
})

const row = (key: string) => document.querySelector(`[data-layer-key="${key}"]`) as HTMLElement

describe('StudioLayersPanel', () => {
  it('FE-COMP-STUDIOLAYERS-001: lists layers front to back, a named group with its members under it', () => {
    render(<StudioLayersPanel t={t} />)
    const keys = Array.from(document.querySelectorAll('[data-layer-key]')).map(n => (n as HTMLElement).dataset.layerKey)
    expect(keys).toEqual(['g:g', 'm2', 'm1', 'back'])
    expect(screen.getByText('Header')).toBeTruthy()
    expect(screen.getByText('Background')).toBeTruthy()
  })

  it('FE-COMP-STUDIOLAYERS-002: clicking a group row selects the whole group; a member row selects it alone inside', () => {
    render(<StudioLayersPanel t={t} />)
    fireEvent.click(row('g:g'))
    expect(useStudioStore.getState().selection).toEqual(['m1', 'm2'])
    fireEvent.click(row('m1'))
    expect(useStudioStore.getState().selection).toEqual(['m1'])
    expect(useStudioStore.getState().enteredGroup).toBe('g')
  })

  it('FE-COMP-STUDIOLAYERS-003: the eye hides a layer, and again shows it', () => {
    render(<StudioLayersPanel t={t} />)
    const hide = row('back').querySelector('[aria-label="journey.studio.layers.hide"]') as HTMLElement
    fireEvent.click(hide)
    expect(els()[0].hidden).toBe(true)
    const show = row('back').querySelector('[aria-label="journey.studio.layers.show"]') as HTMLElement
    fireEvent.click(show)
    expect(els()[0].hidden).toBeUndefined()
  })

  it('FE-COMP-STUDIOLAYERS-004: keyboard — L locks, H hides, F2 + Enter renames', () => {
    render(<StudioLayersPanel t={t} />)
    const r = row('back')
    fireEvent.keyDown(r, { key: 'l' })
    expect(els()[0].locked).toBe(true)
    fireEvent.keyDown(r, { key: 'h' })
    expect(els()[0].hidden).toBe(true)
    fireEvent.keyDown(r, { key: 'F2' })
    const input = screen.getByLabelText('journey.studio.layers.rename') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Paper' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(els()[0].name).toBe('Paper')
  })

  it('FE-COMP-STUDIOLAYERS-005: Alt+↑ brings a layer forward past the whole group', () => {
    render(<StudioLayersPanel t={t} />)
    act(() => { fireEvent.keyDown(row('back'), { key: 'ArrowUp', altKey: true }) })
    expect(els().map(e => e.id)).toEqual(['m1', 'm2', 'back'])
  })

  it('FE-COMP-STUDIOLAYERS-006: read-only hides the toggles and refuses changes', () => {
    useStudioStore.getState().setReadOnly(true)
    render(<StudioLayersPanel t={t} />)
    expect(row('back').querySelector('[aria-label="journey.studio.layers.hide"]')).toBeNull()
    fireEvent.keyDown(row('back'), { key: 'l' })
    expect(els()[0].locked).toBe(false)
  })
})

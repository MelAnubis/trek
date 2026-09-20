// FE-COMP-STUDIOINSPECTOR-001 to FE-COMP-STUDIOINSPECTOR-013
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioInspector } from './StudioInspector'
import { useStudioStore } from '../../store/studioStore'
import type {
  BookBadgeElement, BookCountriesElement, BookDocument, BookIconElement, BookListElement, BookMapElement, BookSpread, BookStatsElement,
} from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }
const base = { frame: { x: 0, y: 0, w: 40, h: 40 }, rotation: 0, opacity: 1, locked: false }
const typeset = { font: 'sans' as const, color: '#1a1a1a', accent: '#111111' }

function statsEl(): BookStatsElement {
  return { ...base, ...typeset, id: 'stats-1', kind: 'stats', metrics: ['distance'], layout: 'grid', showIcons: true, units: 'metric', values: { distance: 1000 } }
}
function countriesEl(): BookCountriesElement {
  return { ...base, ...typeset, id: 'ctry-1', kind: 'countries', codes: ['IS'], names: ['Iceland'], layout: 'list', showFlag: true, showName: true, align: 'center' }
}
function badgeEl(): BookBadgeElement {
  return { ...base, ...typeset, id: 'badge-1', kind: 'badge', variant: 'date', text: '13', sub: '', code: null, style: 'plain' }
}
function iconEl(): BookIconElement {
  return { ...base, id: 'icon-1', kind: 'icon', name: 'Compass', color: '#111827', lineWidth: 2 }
}
function listEl(): BookListElement {
  return { ...base, ...typeset, id: 'list-1', kind: 'list', items: [{ text: 'Great views', tone: 'pro' }], layout: 'columns', showMarks: true, proLabel: 'Pros', conLabel: 'Cons' }
}
function mapEl(): BookMapElement {
  return { ...base, id: 'map-1', kind: 'map', src: null, fit: 'cover', radius: 0 }
}

function spread(id: string, elements: BookSpread['elements']): BookSpread {
  return { id, role: 'inner', background: null, elements, parked: [], entryId: null }
}

function doc(elements: BookSpread['elements']): BookDocument {
  return { version: 1, title: '', page: PAGE, spreads: [spread('cover', []), spread('sp-1', elements)] }
}

const initialState = useStudioStore.getState()

beforeEach(() => {
  useStudioStore.setState(initialState, true)
})

function selectedEl() {
  return useStudioStore.getState().doc!.spreads[1].elements[0]
}

describe('StudioInspector — travel element fields', () => {
  it('FE-COMP-STUDIOINSPECTOR-001: a map element shows its Fit control', () => {
    useStudioStore.getState().load(doc([mapEl()]))
    useStudioStore.getState().select(['map-1'])
    render(<StudioInspector spreadIndex={1} />)
    expect(screen.getByText('Map')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOINSPECTOR-002: changing a map element\'s fit updates the store', () => {
    useStudioStore.getState().load(doc([mapEl()]))
    useStudioStore.getState().select(['map-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('Cover'), { target: { value: 'contain' } })
    expect((selectedEl() as BookMapElement).fit).toBe('contain')
  })

  it('FE-COMP-STUDIOINSPECTOR-003: toggling a metric button on a stats element adds it to metrics', () => {
    useStudioStore.getState().load(doc([statsEl()]))
    useStudioStore.getState().select(['stats-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('days'))
    expect((selectedEl() as BookStatsElement).metrics).toContain('days')
  })

  it('FE-COMP-STUDIOINSPECTOR-004: toggling an already-selected metric removes it', () => {
    useStudioStore.getState().load(doc([statsEl()]))
    useStudioStore.getState().select(['stats-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('distance'))
    expect((selectedEl() as BookStatsElement).metrics).not.toContain('distance')
  })

  it('FE-COMP-STUDIOINSPECTOR-005: editing a stats element\'s value input updates values', () => {
    useStudioStore.getState().load(doc([statsEl()]))
    useStudioStore.getState().select(['stats-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('1000'), { target: { value: '5000' } })
    expect((selectedEl() as BookStatsElement).values.distance).toBe(5000)
  })

  it('FE-COMP-STUDIOINSPECTOR-006: adding a country by ISO code resolves a name and appends it', () => {
    useStudioStore.getState().load(doc([countriesEl()]))
    useStudioStore.getState().select(['ctry-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByPlaceholderText('IS'), { target: { value: 'fr' } })
    fireEvent.keyDown(screen.getByPlaceholderText('IS'), { key: 'Enter' })
    const el = selectedEl() as BookCountriesElement
    expect(el.codes).toEqual(['IS', 'FR'])
    expect(el.names.length).toBe(2)
  })

  it('FE-COMP-STUDIOINSPECTOR-007: removing a country removes both the code and the paired name', () => {
    useStudioStore.getState().load(doc([countriesEl()]))
    useStudioStore.getState().select(['ctry-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('Iceland').parentElement!.querySelector('button')!)
    const el = selectedEl() as BookCountriesElement
    expect(el.codes).toEqual([])
    expect(el.names).toEqual([])
  })

  it('FE-COMP-STUDIOINSPECTOR-008: a malformed country code (not 2 letters) is ignored, not added', () => {
    useStudioStore.getState().load(doc([countriesEl()]))
    useStudioStore.getState().select(['ctry-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByPlaceholderText('IS'), { target: { value: 'ISL' } })
    fireEvent.keyDown(screen.getByPlaceholderText('IS'), { key: 'Enter' })
    expect((selectedEl() as BookCountriesElement).codes).toEqual(['IS'])
  })

  it('FE-COMP-STUDIOINSPECTOR-009: changing a badge\'s style updates the store', () => {
    useStudioStore.getState().load(doc([badgeEl()]))
    useStudioStore.getState().select(['badge-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('plain'), { target: { value: 'chip' } })
    expect((selectedEl() as BookBadgeElement).style).toBe('chip')
  })

  it('FE-COMP-STUDIOINSPECTOR-010: editing an icon element\'s name updates the store', () => {
    useStudioStore.getState().load(doc([iconEl()]))
    useStudioStore.getState().select(['icon-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('Compass'), { target: { value: 'Plane' } })
    expect((selectedEl() as BookIconElement).name).toBe('Plane')
  })

  it('FE-COMP-STUDIOINSPECTOR-011: adding a list item appends a blank pro item', () => {
    useStudioStore.getState().load(doc([listEl()]))
    useStudioStore.getState().select(['list-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('Add item'))
    const el = selectedEl() as BookListElement
    expect(el.items).toHaveLength(2)
    expect(el.items[1]).toEqual({ text: '', tone: 'pro' })
  })

  it('FE-COMP-STUDIOINSPECTOR-012: editing a list item\'s text updates only that item', () => {
    useStudioStore.getState().load(doc([listEl()]))
    useStudioStore.getState().select(['list-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('Great views'), { target: { value: 'Amazing views' } })
    expect((selectedEl() as BookListElement).items[0].text).toBe('Amazing views')
  })

  it('FE-COMP-STUDIOINSPECTOR-013: switching a list to stacked layout hides the pro/con label fields', () => {
    useStudioStore.getState().load(doc([listEl()]))
    useStudioStore.getState().select(['list-1'])
    render(<StudioInspector spreadIndex={1} />)
    expect(screen.getByText('Pro label')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('Columns (pro / con)'), { target: { value: 'stacked' } })
    expect(screen.queryByText('Pro label')).not.toBeInTheDocument()
  })
})

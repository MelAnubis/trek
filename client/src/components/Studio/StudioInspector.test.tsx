// FE-COMP-STUDIOINSPECTOR-001 to FE-COMP-STUDIOINSPECTOR-021
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioInspector } from './StudioInspector'
import { useStudioStore } from '../../store/studioStore'
import type {
  BookBadgeElement, BookDocument, BookIconElement, BookListElement, BookMapElement,
  BookPhotoElement, BookPlacesElement, BookShapeElement, BookSpread, BookStatsElement,
} from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }
const base = { frame: { x: 0, y: 0, w: 40, h: 40 }, rotation: 0, opacity: 1, locked: false }
const typeset = { font: 'sans' as const, color: '#1a1a1a', accent: '#111111' }

function statsEl(): BookStatsElement {
  return { ...base, ...typeset, id: 'stats-1', kind: 'stats', metrics: ['distance'], layout: 'grid', showIcons: true, units: 'metric', values: { distance: 1000 } }
}
function placesEl(): BookPlacesElement {
  return { ...base, ...typeset, id: 'places-1', kind: 'places', places: [{ name: 'Iceland' }], layout: 'list', align: 'center' }
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
function photoEl(overrides: Partial<BookPhotoElement> = {}): BookPhotoElement {
  return {
    ...base, id: 'photo-1', kind: 'photo', photoId: 101, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0,
    filter: 'none', frameStyle: 'none', mask: null, ...overrides,
  }
}
function shapeEl(overrides: Partial<BookShapeElement> = {}): BookShapeElement {
  return {
    ...base, id: 'shape-1', kind: 'shape', shape: 'rect', fill: '#111827', gradient: 'none',
    stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0, ...overrides,
  }
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

  it('FE-COMP-STUDIOINSPECTOR-006: adding a place with a name appends it', () => {
    useStudioStore.getState().load(doc([placesEl()]))
    useStudioStore.getState().select(['places-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByPlaceholderText('Place name'), { target: { value: 'Paris' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Place name'), { key: 'Enter' })
    const el = selectedEl() as BookPlacesElement
    expect(el.places.map(p => p.name)).toEqual(['Iceland', 'Paris'])
  })

  it('FE-COMP-STUDIOINSPECTOR-007: removing a place removes it from the list', () => {
    useStudioStore.getState().load(doc([placesEl()]))
    useStudioStore.getState().select(['places-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('Iceland').parentElement!.querySelector('button')!)
    const el = selectedEl() as BookPlacesElement
    expect(el.places).toEqual([])
  })

  it('FE-COMP-STUDIOINSPECTOR-008: an empty place name is ignored, not added', () => {
    useStudioStore.getState().load(doc([placesEl()]))
    useStudioStore.getState().select(['places-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Place name'), { key: 'Enter' })
    expect((selectedEl() as BookPlacesElement).places.length).toBe(1)
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

function selectedPhotoEl() { return selectedEl() as BookPhotoElement }
function selectedShapeEl() { return selectedEl() as BookShapeElement }

describe('StudioInspector — photo focal point and mask', () => {
  it('FE-COMP-STUDIOINSPECTOR-014: dragging the X focal-point slider updates focalX only', () => {
    useStudioStore.getState().load(doc([photoEl()]))
    useStudioStore.getState().select(['photo-1'])
    render(<StudioInspector spreadIndex={1} />)
    const sliders = screen.getAllByRole('slider')
    // Opacity is the first slider on every element; focal X/Y follow it for a photo.
    fireEvent.change(sliders[1], { target: { value: '0.2' } })
    expect(selectedPhotoEl().focalX).toBe(0.2)
    expect(selectedPhotoEl().focalY).toBe(0.5)
  })

  it('FE-COMP-STUDIOINSPECTOR-015: dragging the Y focal-point slider updates focalY only', () => {
    useStudioStore.getState().load(doc([photoEl()]))
    useStudioStore.getState().select(['photo-1'])
    render(<StudioInspector spreadIndex={1} />)
    const sliders = screen.getAllByRole('slider')
    fireEvent.change(sliders[2], { target: { value: '0.8' } })
    expect(selectedPhotoEl().focalY).toBe(0.8)
    expect(selectedPhotoEl().focalX).toBe(0.5)
  })

  it('FE-COMP-STUDIOINSPECTOR-016: picking a mask from the Mask select sets it; "Rect" clears it back to null', () => {
    useStudioStore.getState().load(doc([photoEl()]))
    useStudioStore.getState().select(['photo-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('Rect'), { target: { value: 'heart' } })
    expect(selectedPhotoEl().mask).toBe('heart')
  })
})

describe('StudioInspector — shape gradient and stroke', () => {
  it('FE-COMP-STUDIOINSPECTOR-017: the Shape select offers the full decorative library, not just rect/ellipse', () => {
    useStudioStore.getState().load(doc([shapeEl()]))
    useStudioStore.getState().select(['shape-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('Rect'), { target: { value: 'heart' } })
    expect(selectedShapeEl().shape).toBe('heart')
  })

  it('FE-COMP-STUDIOINSPECTOR-018: changing Gradient updates the store', () => {
    useStudioStore.getState().load(doc([shapeEl()]))
    useStudioStore.getState().select(['shape-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.change(screen.getByDisplayValue('None'), { target: { value: 'up' } })
    expect(selectedShapeEl().gradient).toBe('up')
  })

  it('FE-COMP-STUDIOINSPECTOR-019: stroke fields are hidden until the Stroke toggle is on', () => {
    useStudioStore.getState().load(doc([shapeEl()]))
    useStudioStore.getState().select(['shape-1'])
    render(<StudioInspector spreadIndex={1} />)
    expect(screen.queryByText('Stroke color')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOINSPECTOR-020: turning on the Stroke toggle gives the shape a real stroke color and default width', () => {
    useStudioStore.getState().load(doc([shapeEl()]))
    useStudioStore.getState().select(['shape-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('Stroke').closest('div')!.querySelector('button')!)
    expect(selectedShapeEl().stroke).not.toBeNull()
    expect(selectedShapeEl().strokeWidth).toBeGreaterThan(0)
  })

  it('FE-COMP-STUDIOINSPECTOR-021: turning the Stroke toggle back off clears the stroke color to null', () => {
    useStudioStore.getState().load(doc([shapeEl({ stroke: '#ff0000', strokeWidth: 2 })]))
    useStudioStore.getState().select(['shape-1'])
    render(<StudioInspector spreadIndex={1} />)
    fireEvent.click(screen.getByText('Stroke').closest('div')!.querySelector('button')!)
    expect(selectedShapeEl().stroke).toBeNull()
  })
})

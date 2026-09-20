// FE-COMP-STUDIOSIDEBAR-001 to FE-COMP-STUDIOSIDEBAR-013
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StudioSidebar } from './StudioSidebar'
import { useStudioStore } from '../../store/studioStore'
import type { BookDocument, BookSpread } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function spread(id: string, role: BookSpread['role'] = 'inner'): BookSpread {
  return { id, role, background: null, elements: [], parked: [], entryId: null }
}

function doc(): BookDocument {
  return { version: 1, title: '', page: PAGE, spreads: [spread('cover', 'cover'), spread('sp-1')] }
}

const initialState = useStudioStore.getState()

beforeEach(() => {
  useStudioStore.setState(initialState, true)
  localStorage.clear()
})

describe('StudioSidebar — collapsible sections', () => {
  it('FE-COMP-STUDIOSIDEBAR-001: every section starts expanded by default', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar galleryPhotos={[]} />)
    // The Elements panel's "add text" button is only in the DOM while its section is expanded.
    expect(screen.getByText('journey.studio.addText')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-002: clicking a section header collapses its body', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.elementsTab'))
    expect(screen.queryByText('journey.studio.addText')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-003: clicking a collapsed section\'s header expands it again', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar galleryPhotos={[]} />)
    const header = screen.getByText('journey.studio.elementsTab')
    fireEvent.click(header)
    fireEvent.click(header)
    expect(screen.getByText('journey.studio.addText')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-004: collapse state persists to localStorage and survives a remount', () => {
    useStudioStore.getState().load(doc())
    const { unmount } = render(<StudioSidebar galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.elementsTab'))
    expect(screen.queryByText('journey.studio.addText')).not.toBeInTheDocument()
    unmount()

    render(<StudioSidebar galleryPhotos={[]} />)
    expect(screen.queryByText('journey.studio.addText')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-005: collapsing the Pages section still leaves its "add spread" button clickable', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.pageTab'))
    const addButton = screen.getByTitle('journey.studio.addSpread')
    expect(addButton).toBeInTheDocument()
    fireEvent.click(addButton)
    expect(useStudioStore.getState().doc?.spreads.length).toBe(3)
  })
})

describe('StudioSidebar — cover vs inner layout set', () => {
  it('FE-COMP-STUDIOSIDEBAR-006: on the cover page, only the 5 single-page layouts show, with a hint explaining why', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar galleryPhotos={[]} />)
    // doc()'s active spread (index 0) is the cover.
    expect(screen.getByText('journey.studio.layoutsCoverHint')).toBeInTheDocument()
    expect(screen.getByTitle('Full')).toBeInTheDocument()
    expect(screen.queryByTitle('Grid 3')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-007: on an inner page, the full spread layout set shows, with no cover hint', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().setActiveSpread(1)
    render(<StudioSidebar galleryPhotos={[]} />)
    expect(screen.queryByText('journey.studio.layoutsCoverHint')).not.toBeInTheDocument()
    expect(screen.getByTitle('Grid 3')).toBeInTheDocument()
    expect(screen.queryByTitle('Full')).not.toBeInTheDocument()
  })
})

function lastElement() {
  const els = useStudioStore.getState().doc!.spreads[1].elements
  return els[els.length - 1]
}

describe('StudioSidebar — Travel panel', () => {
  beforeEach(() => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().setActiveSpread(1)
  })

  it('FE-COMP-STUDIOSIDEBAR-008: adding a map inserts it immediately with no src, before the render finishes', () => {
    render(<StudioSidebar galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.addMap'))
    const el = lastElement()
    expect(el.kind).toBe('map')
    expect((el as any).src).toBeNull()
  })

  it('FE-COMP-STUDIOSIDEBAR-009: once onGenerateMap resolves, the just-added map element is patched with the src', async () => {
    const onGenerateMap = vi.fn().mockResolvedValue('data:image/png;base64,AAAA')
    render(<StudioSidebar galleryPhotos={[]} onGenerateMap={onGenerateMap} />)
    fireEvent.click(screen.getByText('journey.studio.addMap'))
    await waitFor(() => expect((lastElement() as any).src).toBe('data:image/png;base64,AAAA'))
  })

  it('FE-COMP-STUDIOSIDEBAR-010: onGenerateMap rejecting leaves the map element with a null src rather than throwing', async () => {
    const onGenerateMap = vi.fn().mockRejectedValue(new Error('network'))
    render(<StudioSidebar galleryPhotos={[]} onGenerateMap={onGenerateMap} />)
    fireEvent.click(screen.getByText('journey.studio.addMap'))
    await waitFor(() => expect(onGenerateMap).toHaveBeenCalled())
    expect((lastElement() as any).src).toBeNull()
  })

  it('FE-COMP-STUDIOSIDEBAR-011: adding stats prefills its values from the journeyStats prop', () => {
    render(<StudioSidebar galleryPhotos={[]} journeyStats={{ days: 7, entries: 12, photos: 240, places: 9 }} />)
    fireEvent.click(screen.getByText('journey.studio.addStats'))
    const el = lastElement() as any
    expect(el.kind).toBe('stats')
    expect(el.values).toEqual({ days: 7, photos: 240, places: 9 })
  })

  it('FE-COMP-STUDIOSIDEBAR-012: adding stats with no journeyStats prop starts with empty values, not a crash', () => {
    render(<StudioSidebar galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.addStats'))
    expect((lastElement() as any).values).toEqual({})
  })

  it.each([
    ['journey.studio.addCountries', 'countries'],
    ['journey.studio.addBadge', 'badge'],
    ['journey.studio.addIcon', 'icon'],
    ['journey.studio.addList', 'list'],
  ])('FE-COMP-STUDIOSIDEBAR-013: clicking "%s" adds an element of kind "%s"', (label, kind) => {
    render(<StudioSidebar galleryPhotos={[]} />)
    fireEvent.click(screen.getByText(label))
    expect(lastElement().kind).toBe(kind)
  })
})

// FE-COMP-STUDIOSIDEBAR-001 to FE-COMP-STUDIOSIDEBAR-005
import { render, screen, fireEvent } from '@testing-library/react'
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

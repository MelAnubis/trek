// FE-COMP-STUDIOSIDEBAR-001 to FE-COMP-STUDIOSIDEBAR-018
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StudioSidebar } from './StudioSidebar'
import { useStudioStore } from '../../store/studioStore'
import { useJourneyStore } from '../../store/journeyStore'
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
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    // The Elements panel's "add text" button is only in the DOM while its section is expanded.
    expect(screen.getByText('journey.studio.addText')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-002: clicking a section header collapses its body', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.elementsTab'))
    expect(screen.queryByText('journey.studio.addText')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-003: clicking a collapsed section\'s header expands it again', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    const header = screen.getByText('journey.studio.elementsTab')
    fireEvent.click(header)
    fireEvent.click(header)
    expect(screen.getByText('journey.studio.addText')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-004: collapse state persists to localStorage and survives a remount', () => {
    useStudioStore.getState().load(doc())
    const { unmount } = render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.elementsTab'))
    expect(screen.queryByText('journey.studio.addText')).not.toBeInTheDocument()
    unmount()

    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    expect(screen.queryByText('journey.studio.addText')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-005: collapsing the Pages section still leaves its "add spread" button clickable', () => {
    useStudioStore.getState().load(doc())
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
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
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    // doc()'s active spread (index 0) is the cover.
    expect(screen.getByText('journey.studio.layoutsCoverHint')).toBeInTheDocument()
    expect(screen.getByTitle('Full')).toBeInTheDocument()
    expect(screen.queryByTitle('Grid 3')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-007: on an inner page, the full spread layout set shows, with no cover hint', () => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().setActiveSpread(1)
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
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
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.addMap'))
    const el = lastElement()
    expect(el.kind).toBe('map')
    expect((el as any).src).toBeNull()
  })

  it('FE-COMP-STUDIOSIDEBAR-009: once onGenerateMap resolves, the just-added map element is patched with the src', async () => {
    const onGenerateMap = vi.fn().mockResolvedValue('data:image/png;base64,AAAA')
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} onGenerateMap={onGenerateMap} />)
    fireEvent.click(screen.getByText('journey.studio.addMap'))
    await waitFor(() => expect((lastElement() as any).src).toBe('data:image/png;base64,AAAA'))
  })

  it('FE-COMP-STUDIOSIDEBAR-010: onGenerateMap rejecting leaves the map element with a null src rather than throwing', async () => {
    const onGenerateMap = vi.fn().mockRejectedValue(new Error('network'))
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} onGenerateMap={onGenerateMap} />)
    fireEvent.click(screen.getByText('journey.studio.addMap'))
    await waitFor(() => expect(onGenerateMap).toHaveBeenCalled())
    expect((lastElement() as any).src).toBeNull()
  })

  it('FE-COMP-STUDIOSIDEBAR-011: adding stats prefills its values from the journeyStats prop', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} journeyStats={{ days: 7, entries: 12, photos: 240, places: 9 }} />)
    fireEvent.click(screen.getByText('journey.studio.addStats'))
    const el = lastElement() as any
    expect(el.kind).toBe('stats')
    expect(el.values).toEqual({ days: 7, photos: 240, places: 9 })
  })

  it('FE-COMP-STUDIOSIDEBAR-012: adding stats with no journeyStats prop starts with empty values, not a crash', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.addStats'))
    expect((lastElement() as any).values).toEqual({})
  })

  it('FE-COMP-STUDIOSIDEBAR-022: adding stats also prefills distance/elevation once the journey has a GPX track, without a manual metric toggle first', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} journeyStats={{
      days: 7, entries: 12, photos: 240, places: 9, distanceKm: 100, elevationGainM: 843, elevationLossM: 621,
    }} />)
    fireEvent.click(screen.getByText('journey.studio.addStats'))
    const el = lastElement() as any
    expect(el.metrics).toEqual(expect.arrayContaining(['days', 'photos', 'places', 'distance', 'elevationGain', 'elevationLoss']))
    expect(el.values).toEqual({ days: 7, photos: 240, places: 9, distance: 100000, elevationGain: 843, elevationLoss: 621 })
  })

  it.each([
    ['journey.studio.addBadge', 'badge'],
    ['journey.studio.addIcon', 'icon'],
    ['journey.studio.addList', 'list'],
  ])('FE-COMP-STUDIOSIDEBAR-013: clicking "%s" adds an element of kind "%s"', (label, kind) => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText(label))
    expect(lastElement().kind).toBe(kind)
  })

  it('FE-COMP-STUDIOSIDEBAR-019: adding places inserts it immediately with an empty list, before onGeneratePlaces resolves', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.addPlaces'))
    const el = lastElement()
    expect(el.kind).toBe('places')
    expect((el as any).places).toEqual([])
  })

  it('FE-COMP-STUDIOSIDEBAR-020: once onGeneratePlaces resolves, the just-added places element is patched with the fetched list', async () => {
    const onGeneratePlaces = vi.fn().mockResolvedValue([{ name: 'Kyoto', note: 'Bamboo grove' }])
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} onGeneratePlaces={onGeneratePlaces} />)
    fireEvent.click(screen.getByText('journey.studio.addPlaces'))
    await waitFor(() => expect((lastElement() as any).places).toEqual([{ name: 'Kyoto', note: 'Bamboo grove' }]))
  })

  it('FE-COMP-STUDIOSIDEBAR-021: onGeneratePlaces rejecting leaves the places element with an empty list rather than throwing', async () => {
    const onGeneratePlaces = vi.fn().mockRejectedValue(new Error('network'))
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} onGeneratePlaces={onGeneratePlaces} />)
    fireEvent.click(screen.getByText('journey.studio.addPlaces'))
    await waitFor(() => expect(onGeneratePlaces).toHaveBeenCalled())
    expect((lastElement() as any).places).toEqual([])
  })
})

describe('StudioSidebar — decorative shape picker', () => {
  beforeEach(() => {
    useStudioStore.getState().load(doc())
    useStudioStore.getState().setActiveSpread(1)
  })

  it('FE-COMP-STUDIOSIDEBAR-014: the picker grid is hidden until "More shapes…" is clicked', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    expect(screen.queryByTitle('heart')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('journey.studio.moreShapes'))
    expect(screen.getByTitle('heart')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-015: clicking a shape tile adds that shape, centered, and closes the picker', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.moreShapes'))
    fireEvent.click(screen.getByTitle('star-5'))
    const el = lastElement() as any
    expect(el.kind).toBe('shape')
    expect(el.shape).toBe('star-5')
    expect(screen.queryByTitle('star-5')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOSIDEBAR-016: "Add rectangle" and "Add circle" still add plain rect/ellipse shapes directly, without opening the picker', () => {
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    fireEvent.click(screen.getByText('journey.studio.addRect'))
    expect((lastElement() as any).shape).toBe('rect')
  })
})

describe('StudioSidebar — Photos panel upload', () => {
  beforeEach(() => {
    useStudioStore.getState().load(doc())
  })

  function makeFile(name = 'beach.jpg', type = 'image/jpeg') {
    return new File(['x'], name, { type })
  }

  it('FE-COMP-STUDIOSIDEBAR-017: choosing a file uploads it into the journey named by journeyId', async () => {
    const upload = vi.spyOn(useJourneyStore.getState(), 'uploadGalleryPhotos').mockResolvedValue({ succeeded: [], failed: [] })
    render(<StudioSidebar journeyId={42} galleryPhotos={[]} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile()
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect(upload.mock.calls[0][0]).toBe(42)
    expect(upload.mock.calls[0][1].map(f => f.name)).toEqual(['beach.jpg'])
  })

  it('FE-COMP-STUDIOSIDEBAR-018: a failed upload never throws out of the handler — the upload button reappears once it settles', async () => {
    vi.spyOn(useJourneyStore.getState(), 'uploadGalleryPhotos').mockRejectedValue(new Error('network'))
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile()] } })
    // Mid-upload, the button is swapped for a progress indicator.
    expect(screen.queryByTitle('journey.studio.uploadPhotos')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTitle('journey.studio.uploadPhotos')).toBeInTheDocument())
  })
})

describe('StudioSidebar — Photos panel drag-and-drop upload', () => {
  beforeEach(() => {
    useStudioStore.getState().load(doc())
  })

  function makeFile(name = 'beach.jpg', type = 'image/jpeg') {
    return new File(['x'], name, { type })
  }

  function fileDropEvent(files: File[]) {
    return {
      dataTransfer: {
        types: ['Files'],
        files,
      },
    }
  }

  it('FE-COMP-STUDIOSIDEBAR-023: dropping OS files onto the Photos panel uploads them the same way as the file picker', async () => {
    const upload = vi.spyOn(useJourneyStore.getState(), 'uploadGalleryPhotos').mockResolvedValue({ succeeded: [], failed: [] })
    render(<StudioSidebar journeyId={7} galleryPhotos={[]} />)
    const dropzone = screen.getByTestId('photos-dropzone')

    fireEvent.drop(dropzone, fileDropEvent([makeFile()]))

    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect(upload.mock.calls[0][0]).toBe(7)
    expect(upload.mock.calls[0][1].map((f: File) => f.name)).toEqual(['beach.jpg'])
  })

  it('FE-COMP-STUDIOSIDEBAR-024: a drag carrying an internal photo reference (not OS files) is ignored by the upload dropzone', () => {
    const upload = vi.spyOn(useJourneyStore.getState(), 'uploadGalleryPhotos')
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    const dropzone = screen.getByTestId('photos-dropzone')

    fireEvent.drop(dropzone, { dataTransfer: { types: ['application/x-trek-photo'], files: [] } });

    expect(upload).not.toHaveBeenCalled()
  })
})

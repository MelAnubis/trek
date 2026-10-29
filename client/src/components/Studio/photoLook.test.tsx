// FE-STUDIO-LOOK-001 to FE-STUDIO-LOOK-012 — the photo look (5.7.2), ported from liketrek/TREK.
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  adjustFilter, duotoneMatrix, photoLookOf, photoZoomOf, pictureFilter, rgba, silhouetteShadows, svgFilterMatrices,
  warmthMatrix, zoomPlacement, type PhotoLook,
} from './photoLook'
import { ElementView } from './SpreadView'
import { PhotoCropExtras, PhotoLookSections, usePhotoLookPatch } from './StudioPhotoLook'
import { useStudioStore } from '../../store/studioStore'
import { emptyBook } from './autoLayout'
import type { BookPhotoElement } from '../../types/book'

vi.mock('./BookPhotoImg', () => ({
  BookPhotoImg: ({ style }: { style?: React.CSSProperties }) => <img data-testid="pic" alt="" style={style} />,
}))

const look = (over: Partial<PhotoLook> = {}): PhotoLook => ({ ...photoLookOf({}), ...over })
const adjust = (a: Partial<NonNullable<PhotoLook['adjust']>>) => ({ brightness: 0, contrast: 0, saturation: 0, warmth: 0, ...a })

describe('photo look rendering', () => {
  it('FE-STUDIO-LOOK-001: turns adjustments into filter functions, leaving out what does not move', () => {
    expect(adjustFilter(null)).toEqual([])
    expect(adjustFilter(adjust({ brightness: 0.2, contrast: -1, saturation: -1 }))).toEqual([
      'brightness(1.1)',
      'contrast(0.5)',
      'saturate(0)',
    ])
    expect(adjustFilter(adjust({ warmth: 0.5 }))).toEqual([])
  })

  it('FE-STUDIO-LOOK-002: chains the preset, the adjustments and the SVG filter, and draws nothing for none', () => {
    expect(pictureFilter(undefined, look(), null)).toBeUndefined()
    expect(pictureFilter('grayscale(1)', look({ adjust: adjust({ contrast: 0.4 }) }), 'f-x')).toBe(
      'grayscale(1) contrast(1.2) url(#f-x)'
    )
  })

  it('FE-STUDIO-LOOK-003: warms by raising red and lowering blue, and cools the other way', () => {
    expect(warmthMatrix(0)).toBeNull()
    expect(warmthMatrix(1)).toBe('1.12 0 0 0 0 0 1.03 0 0 0 0 0 0.88 0 0 0 0 0 1 0')
    expect(warmthMatrix(-1)).toBe('0.88 0 0 0 0 0 0.97 0 0 0 0 0 1.12 0 0 0 0 0 1 0')
  })

  it('FE-STUDIO-LOOK-004: maps black to the dark ink and white to the light one', () => {
    const values = duotoneMatrix({ dark: '#000000', light: '#ffffff' }).split(' ').map(Number)
    // Each colour row reads the luminance weights and starts from the dark ink.
    expect(values.slice(0, 5)).toEqual([0.213, 0.715, 0.072, 0, 0])
    expect(values.slice(15)).toEqual([0, 0, 0, 1, 0])
    const navy = duotoneMatrix({ dark: '#ff0000', light: '#ff0000' }).split(' ').map(Number)
    // The same ink at both ends is that ink, whatever the picture.
    expect(navy.slice(0, 5)).toEqual([0, 0, 0, 0, 1])
    expect(navy.slice(5, 10)).toEqual([0, 0, 0, 0, 0])
  })

  it('FE-STUDIO-LOOK-005: needs an SVG filter only for warmth or a duotone, warmth first', () => {
    expect(svgFilterMatrices(look())).toEqual([])
    expect(svgFilterMatrices(look({ adjust: adjust({ brightness: 0.3 }) }))).toEqual([])
    const both = svgFilterMatrices(
      look({ adjust: adjust({ warmth: 1 }), duotone: { dark: '#000000', light: '#ffffff' } })
    )
    expect(both).toHaveLength(2)
    expect(both[0]).toBe(warmthMatrix(1))
  })

  it('FE-STUDIO-LOOK-006: draws the cutout and a shadow grown by it as flat box shadows', () => {
    expect(silhouetteShadows(null, null)).toEqual([])
    expect(silhouetteShadows({ dx: 2, dy: 3, color: '#102030', alpha: 0.5 }, null)).toEqual([
      '2mm 3mm 0 0mm rgba(16, 32, 48, 0.5)',
    ])
    expect(silhouetteShadows({ dx: -1, dy: 1, color: '#000000', alpha: 1 }, { width: 3, color: '#ffffff' })).toEqual([
      '0 0 0 3mm #ffffff',
      '-1mm 1mm 0 3mm rgba(0, 0, 0, 1)',
    ])
    expect(rgba('#ff8000', 0.25)).toBe('rgba(255, 128, 0, 0.25)')
  })

  it('FE-STUDIO-LOOK-007: places a zoomed picture so the focal point stays where it was', () => {
    expect(zoomPlacement(1, 0.5, 0.5)).toBeNull()
    expect(zoomPlacement(2, 0.5, 0.5)).toEqual({ size: '200%', transform: 'translate(-25%, -25%)' })
    expect(zoomPlacement(4, 0, 1)).toEqual({ size: '400%', transform: 'translate(0%, -75%)' })
  })
})

const PAGE = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 } as const
function photoEl(o: Partial<BookPhotoElement> = {}): BookPhotoElement {
  return {
    id: 'p1', kind: 'photo', frame: { x: 10, y: 10, w: 80, h: 60 }, rotation: 0, opacity: 1, locked: false,
    photoId: 7, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null, ...o,
  }
}

describe('reading the look', () => {
  it('FE-STUDIO-LOOK-008: off where absent or null, zoom clamped, a neutral adjustment counts as none', () => {
    expect(photoLookOf({})).toEqual({ border: null, shadow: null, zoom: 1, flipX: false, adjust: null, duotone: null, cutout: null })
    expect(photoZoomOf({ zoom: 9 })).toBe(4)
    expect(photoZoomOf({ zoom: 0.2 })).toBe(1)
    expect(photoLookOf({ adjust: { brightness: 0, warmth: 0 } }).adjust).toBeNull()
    expect(photoLookOf({ border: null, flipX: true }).flipX).toBe(true)
  })
})

describe('the look on the page', () => {
  it('FE-STUDIO-LOOK-009: zoom, mirror, adjustments and the SVG filter reach the picture', () => {
    const { container, getByTestId } = render(<ElementView big={false} el={photoEl({
      zoom: 2, flipX: true, adjust: { contrast: 0.4, warmth: 1 }, duotone: { dark: '#000000', light: '#ffffff' },
    })} />)
    const img = getByTestId('pic')
    expect(img.style.width).toBe('200%')
    expect(img.style.transform).toBe('translate(-25%, -25%)')
    expect(img.style.filter).toMatch(/^contrast\(1\.2\) url\(#photo-look-/)
    expect(img.parentElement!.style.transform).toBe('scaleX(-1)')
    expect(container.querySelectorAll('feColorMatrix')).toHaveLength(2)
  })

  it('FE-STUDIO-LOOK-010: border, cutout and shadow on a rectangle; a silhouette for a shaped mask; nothing on an empty frame', () => {
    const rect = render(<ElementView big={false} el={photoEl({
      border: { width: 4, color: '#ffffff' }, cutout: { width: 3, color: '#ffffff' }, shadow: { dx: 2, dy: 2, color: '#1a1a1a', alpha: 0.35 },
    })} />)
    const outer = rect.container.firstElementChild as HTMLElement
    expect(outer.style.boxShadow).toContain('3mm')
    expect(rect.container.querySelector('[aria-hidden][style*="border-style: solid"]')).not.toBeNull()

    const star = render(<ElementView big={false} el={photoEl({ mask: 'star-5' as BookPhotoElement['mask'], cutout: { width: 3, color: '#ff0000' } })} />)
    expect((star.container.firstElementChild as HTMLElement).style.boxShadow).toBe('')
    expect(star.container.querySelector('path[stroke="#ff0000"]')).not.toBeNull()

    const empty = render(<ElementView big={false} dropLabel="x" el={photoEl({ photoId: null, border: { width: 4, color: '#ffffff' }, shadow: { dx: 2, dy: 2, color: '#000000', alpha: 1 } })} />)
    expect((empty.container.firstElementChild as HTMLElement).style.boxShadow).toBe('')
    expect(empty.container.querySelector('[data-testid="pic"]')).toBeNull()
  })

  it('FE-STUDIO-LOOK-011: a photo without a look renders as before (no filter element, plain size)', () => {
    const { container, getByTestId } = render(<ElementView big={false} el={photoEl()} />)
    expect(getByTestId('pic').style.width).toBe('100%')
    expect(container.querySelector('filter')).toBeNull()
  })
})

function Inspector() {
  const el = useStudioStore(s => s.doc!.spreads[0].elements[0]) as BookPhotoElement
  const { set, live } = usePhotoLookPatch(0, el.id)
  const t = (k: string) => k
  return <><PhotoCropExtras el={el} set={set} live={live} t={t} /><PhotoLookSections el={el} set={set} live={live} t={t} /></>
}

describe('the look in the inspector', () => {
  beforeEach(() => {
    const doc = emptyBook({ ...PAGE })
    doc.spreads[0] = { ...doc.spreads[0], elements: [photoEl()] }
    useStudioStore.getState().reset()
    useStudioStore.getState().load(doc)
  })
  const el = () => useStudioStore.getState().doc!.spreads[0].elements[0] as BookPhotoElement

  it('FE-STUDIO-LOOK-012: toggles store a part and undo takes it away; a slider drag is one undo step', () => {
    const r = render(<Inspector />)
    fireEvent.click(r.getByTestId('photo-flip'))
    expect(el().flipX).toBe(true)
    useStudioStore.getState().undo()
    expect(el().flipX).toBeUndefined()

    const zoom = r.getByTestId('photo-zoom')
    fireEvent.change(zoom, { target: { value: '1.5' } })
    fireEvent.change(zoom, { target: { value: '2' } })
    expect(el().zoom).toBe(2)
    fireEvent.pointerUp(zoom)
    expect(el().zoom).toBe(2)
    const past = useStudioStore.getState().past.length
    useStudioStore.getState().undo()
    expect(el().zoom).toBeUndefined()
    expect(useStudioStore.getState().past.length).toBe(past - 1)

    // Edges section is closed until opened; turning the border on uses the white print border.
    fireEvent.click(r.getByText('journey.studio.photo.edges'))
    fireEvent.click(r.getByTestId('photo-border').querySelector('button')!)
    expect(el().border).toEqual({ width: 4, color: '#ffffff' })
    fireEvent.click(r.getByText('journey.studio.photo.duotone', { selector: 'span' }))
  })
})

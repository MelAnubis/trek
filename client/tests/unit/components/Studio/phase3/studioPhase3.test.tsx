// FE-STUDIO-P3-001 to FE-STUDIO-P3-020 — 5.7.6: paint, cut edges, lines and themes in Trek's Studio.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDocument, BookElement, BookLineElement, BookPhotoElement, BookShapeElement, BookSpread, BookTextElement } from '../../../../../src/types/book'
import { paintFallbackHex, shapePaint, spreadPaint, withShapePaint, withSpreadPaintByHand } from '../../../../../src/components/Studio/bookPaint'
import { bookLinePoints, bookLineStyled, bookLineWithPoints, bookNewLine } from '../../../../../src/components/Studio/bookLine'
import { EDGE_SHAPES, hasEdge, photoEdgeClip, shapeOutline } from '../../../../../src/components/Studio/shapeOutline'
import { flattenPath } from '../../../../../src/components/Studio/shapesEdges'
import {
  BOOK_THEME_PRESETS, adoptionMap, applyBookTheme, bookThemeColor, bookThemeOf, isBookFontFamily, layoutWithTheme, themedElement, withThemeLinks,
} from '../../../../../src/components/Studio/bookTheme'
import { ElementView, SpreadView } from '../../../../../src/components/Studio/SpreadView'
import { useStudioStore } from '../../../../../src/store/studioStore'
import { emptyBook } from '../../../../../src/components/Studio/autoLayout'
import { ShapeFillSection, EdgeSection } from '../../../../../src/components/Studio/StudioPaintSections'
import { LineInspector } from '../../../../../src/components/Studio/StudioLineInspector'
import { bookElementStyle, withPastedStyle } from '../../../../../src/components/Studio/bookStyleCopy'

vi.mock('../../../../../src/components/Studio/BookPhotoImg', () => ({
  BookPhotoImg: ({ style }: { style?: React.CSSProperties }) => <img data-testid="pic" alt="" style={style} />,
}))

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }
const base = { frame: { x: 10, y: 10, w: 60, h: 40 }, rotation: 0, opacity: 1, locked: false }
const shape = (o: Partial<BookShapeElement> = {}): BookShapeElement => ({
  ...base, id: 's1', kind: 'shape', shape: 'rect', fill: '#111827', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0, ...o,
})
const photo = (o: Partial<BookPhotoElement> = {}): BookPhotoElement => ({
  ...base, id: 'p1', kind: 'photo', photoId: 3, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null, ...o,
})
const text = (o: Partial<BookTextElement> = {}): BookTextElement => ({
  ...base, id: 't1', kind: 'text', text: 'Hola', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0,
  color: '#1a1a1a', binding: null, overridden: true, ...o,
})
const spread = (elements: BookElement[], o: Partial<BookSpread> = {}): BookSpread => ({ id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null, ...o })

describe('paint', () => {
  it('FE-STUDIO-P3-001: one opaque colour and the cover fade stay in the old fields; anything else keeps paint and a stand-in fill', () => {
    expect(withShapePaint(shape(), { type: 'solid', color: '#FF0000' })).toMatchObject({ fill: '#ff0000', gradient: 'none' })
    expect(withShapePaint(shape(), { type: 'solid', color: '#ff0000' }).paint).toBeUndefined()
    const fade = withShapePaint(shape(), { type: 'linear', angle: 0, stops: [{ at: 0, color: '#123456', alpha: 0 }, { at: 0.46, color: '#123456', alpha: 0.55 }, { at: 1, color: '#123456', alpha: 1 }] })
    expect(fade).toMatchObject({ fill: '#123456', gradient: 'up' })
    const grad = withShapePaint(shape(), { type: 'linear', angle: 90, stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] })
    expect(grad.paint?.type).toBe('linear')
    expect(grad.fill).toBe(paintFallbackHex(grad.paint!))
    expect(withShapePaint(shape(), null)).toMatchObject({ fill: null })
    expect(shapePaint(shape({ gradient: 'down' }))?.type).toBe('linear')
  })

  it('FE-STUDIO-P3-002: a page painted by hand unlinks its theme colour; white stays the paper', () => {
    const sp = spread([], { backgroundToken: 'paper', background: '#f0f0f0' })
    const painted = withSpreadPaintByHand(sp, { type: 'pattern', pattern: 'dots', fg: '#000000', bg: '#ffeedd', scale: 1, angle: 0 })
    expect(painted.backgroundToken).toBeUndefined()
    expect(painted.background).toBe('#ffeedd')
    expect(spreadPaint(painted)?.type).toBe('pattern')
    expect(withSpreadPaintByHand(painted, null).background).toBeNull()
  })

  it('FE-STUDIO-P3-003: renders a gradient shape and a patterned page as SVG with per-instance ids', () => {
    const el = withShapePaint(shape(), { type: 'radial', cx: 0.5, cy: 0.5, r: 1, stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff', alpha: 0.4 }] })
    const { container } = render(<ElementView el={el} big={false} />)
    const grad = container.querySelector('radialGradient')!
    expect(grad).not.toBeNull()
    expect(container.querySelector('path')!.getAttribute('fill')).toBe(`url(#${grad.id})`)
    const page = render(<SpreadView page={PAGE} spread={spread([], { backgroundPaint: { type: 'pattern', pattern: 'stripes', fg: '#111111', bg: '#eeeeee', scale: 1, angle: 45 }, background: '#eeeeee' })} />)
    expect(page.container.querySelector('clipPath')).not.toBeNull()
    expect(page.container.querySelector('svg')!.getAttribute('width')).toBe('426mm')
  })
})

describe('cut edges', () => {
  it('FE-STUDIO-P3-004: every shape an edge is cut along flattens to a ring the cut can follow', () => {
    for (const id of EDGE_SHAPES) {
      const d = shapeOutline({ id: 'x', shape: id as BookShapeElement['shape'], radius: 0, edge: 'zigzag', edgeSize: 3 }, 60, 40)
      expect(flattenPath(d).length, id).toBeGreaterThan(8)
    }
  })

  it('FE-STUDIO-P3-005: a heart keeps its drawn outline; straight is no edge', () => {
    expect(hasEdge({ edge: 'torn' }, 'heart')).toBe(false)
    expect(hasEdge({ edge: 'straight' }, 'rect')).toBe(false)
    expect(hasEdge({ edge: 'scallop' }, null)).toBe(true)
  })

  it('FE-STUDIO-P3-006: an edged photo is clipped by its cut in 0..1 units; an edged shape is drawn as a path', () => {
    const clip = photoEdgeClip(photo({ edge: 'perforated', edgeSize: 4 }), 60, 40)!
    const nums = clip.match(/-?\d*\.?\d+/g)!.map(Number)
    expect(Math.max(...nums)).toBeLessThanOrEqual(1)
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0)
    const { container } = render(<ElementView el={photo({ edge: 'perforated' })} big={false} />)
    expect(container.querySelector('clipPath path')!.getAttribute('d')).toBe(photoEdgeClip(photo({ edge: 'perforated' }), 60, 40))
    const s = render(<ElementView el={shape({ edge: 'wavy', edgeSize: 4 })} big={false} />)
    expect(s.container.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(100)
  })
})

describe('lines', () => {
  it('FE-STUDIO-P3-007: a new line is fitted around its points, padded for its heads, and its points land where they were given', () => {
    const el = bookNewLine('l', [[20, 50], [120, 80]], { endCap: 'arrow' })
    const back = bookLinePoints(el)
    expect(back[0][0]).toBeCloseTo(20, 1)
    expect(back[1][1]).toBeCloseTo(80, 1)
    expect(el.frame.x).toBeLessThan(20)
  })

  it('FE-STUDIO-P3-008: a level rule keeps a frame thick enough to hold; a turned line keeps its points', () => {
    const rule = bookNewLine('l', [[0, 10], [100, 10]])
    expect(rule.frame.h).toBeGreaterThanOrEqual(2)
    const turned = bookLineWithPoints({ ...rule, rotation: 30 }, [[0, 0], [50, 20]])
    const pts = bookLinePoints(turned)
    expect(pts[1][0]).toBeCloseTo(50, 1)
    expect(pts[1][1]).toBeCloseTo(20, 1)
  })

  it('FE-STUDIO-P3-009: a wider stroke or a head refits the frame and the ends stay put', () => {
    const el = bookNewLine('l', [[10, 10], [90, 10]])
    const wide = bookLineStyled(el, { strokeWidth: 4, startCap: 'dot' })
    expect(wide.frame.h).toBeGreaterThan(el.frame.h)
    expect(bookLinePoints(wide)[0][0]).toBeCloseTo(10, 1)
  })

  it('FE-STUDIO-P3-010: draws as paths: the body stroked and the arrow filled', () => {
    const el = bookNewLine('l', [[10, 10], [90, 10]], { endCap: 'arrow', dash: 'dashed', stroke: '#ff0000' })
    const { container } = render(<ElementView el={el} big={false} />)
    const paths = [...container.querySelectorAll('path')]
    expect(paths.some(p => p.getAttribute('stroke') === '#ff0000' && p.getAttribute('stroke-dasharray'))).toBe(true)
    expect(paths.some(p => p.getAttribute('fill') === '#ff0000')).toBe(true)
  })
})

describe('themes', () => {
  it('FE-STUDIO-P3-011: every built-in theme sets type in a family Trek ships, at a weight its text takes', () => {
    expect(BOOK_THEME_PRESETS).toHaveLength(17)
    for (const p of BOOK_THEME_PRESETS) {
      for (const slot of ['display', 'heading', 'body', 'script'] as const) {
        const face = p.fonts[slot]
        if (!face) continue
        expect(isBookFontFamily(face.font), `${p.id} ${slot}`).toBe(true)
        if (face.weight !== undefined) expect(face.weight % 100).toBe(0)
      }
    }
  })

  it('FE-STUDIO-P3-012: applying recolours only what is linked, leaves locked and unlinked alone', () => {
    const theme = bookThemeOf('riviera')
    const doc: BookDocument = { ...emptyBook(PAGE), spreads: [spread([
      text({ id: 'a', token: 'accent', fontRole: 'heading' }),
      text({ id: 'b', color: '#123456' }),
      text({ id: 'c', token: 'ink', locked: true, color: '#000000' }),
    ], { backgroundToken: 'paper' })] }
    const out = applyBookTheme(doc, theme)
    const [a, b, c] = out.spreads[0].elements as BookTextElement[]
    expect(a.color).toBe(theme.palette.accent)
    expect(a.font).toBe(theme.fonts.heading.font)
    expect(b.color).toBe('#123456')
    expect(c.color).toBe('#000000')
    expect(out.spreads[0].background).toBe(theme.palette.paper)
    expect(out.theme).toBe(theme)
  })

  it('FE-STUDIO-P3-013: adopting links dark words to the ink, the most used colour to the first accent, big text to a heading', () => {
    const theme = bookThemeOf('midnight')
    const doc: BookDocument = { ...emptyBook(PAGE), spreads: [spread([
      text({ id: 'h', size: 30, color: '#1a1a1a' }),
      shape({ id: 's', fill: '#e11d48' }),
      shape({ id: 's2', fill: '#e11d48' }),
      text({ id: 'w', color: '#ffffff' }),
    ])] }
    expect(adoptionMap(doc, null).get('#e11d48')).toBe('accent')
    const out = applyBookTheme(doc, theme, { adopt: true }).spreads[0].elements
    expect((out[0] as BookTextElement).fontRole).toBe('heading')
    expect((out[0] as BookTextElement).token).toBe('ink')
    expect((out[1] as BookShapeElement).fill).toBe(theme.palette.accent)
    // White words on white paper do not read there: answer to a picture, so left alone.
    expect((out[3] as BookTextElement).token).toBeUndefined()
  })

  it('FE-STUDIO-P3-014: a colour set by hand unlinks it; a link set takes the theme colour', () => {
    const theme = bookThemeOf('postcard')
    const el = text({ token: 'accent', color: theme.palette.accent })
    expect(withThemeLinks({ ...el, color: '#00ff00' }, { color: '#00ff00' }, theme).token).toBeUndefined()
    const linked = withThemeLinks({ ...text(), token: 'accent2' }, { token: 'accent2' }, theme)
    expect(linked.color).toBe(theme.palette.accent2)
    expect(themedElement(shape({ token: 'ink', paint: { type: 'solid', color: '#000000', alpha: 0.5 } }), theme).paint).toMatchObject({ color: bookThemeColor(theme, 'ink'), alpha: 0.5 })
  })

  it('FE-STUDIO-P3-015: auto-layout in a theme frames and tilts the smaller photos and links the page', () => {
    const theme = bookThemeOf('scrapbook-script')
    const doc: BookDocument = { ...emptyBook(PAGE), spreads: [spread([photo({ id: 'p1' }), photo({ id: 'p2' }), photo({ id: 'big', frame: { x: 0, y: 0, w: 200, h: 200 } })])] }
    const out = layoutWithTheme(doc, theme).spreads[0]
    const [p1, p2, big] = out.elements as BookPhotoElement[]
    expect(p1.frameStyle).toBe('polaroid')
    expect(p1.rotation).toBe(-theme.tilt)
    expect(p2.rotation).toBe(theme.tilt)
    expect(big.rotation).toBe(0)
    expect(out.background).toBe(theme.palette.paper)
    expect(layoutWithTheme(doc, undefined)).toBe(doc)
  })
})

describe('the inspector', () => {
  beforeEach(() => {
    const doc = emptyBook(PAGE)
    doc.spreads[0] = spread([shape(), bookNewLine('ln', [[20, 20], [100, 20]])], { id: doc.spreads[0].id, role: doc.spreads[0].role })
    useStudioStore.getState().reset()
    useStudioStore.getState().load(doc)
  })
  const els = () => useStudioStore.getState().doc!.spreads[0].elements
  const t = (k: string) => k

  it('FE-STUDIO-P3-016: picking a gradient is one undo step and keeps the colour', () => {
    render(<ShapeFillSection el={els()[0] as BookShapeElement} spreadIndex={0} t={t} />)
    fireEvent.click(screen.getByTestId('paint-kind-gradient'))
    const s = els()[0] as BookShapeElement
    expect(s.paint?.type).toBe('linear')
    expect(s.paint?.type === 'linear' && s.paint.stops[0].color).toBe('#111827')
    useStudioStore.getState().undo()
    expect((els()[0] as BookShapeElement).paint).toBeUndefined()
  })

  it('FE-STUDIO-P3-017: taking the fill away gives the shape an outline so it never vanishes', () => {
    render(<ShapeFillSection el={els()[0] as BookShapeElement} spreadIndex={0} t={t} />)
    fireEvent.click(screen.getByTestId('paint-kind-none'))
    expect(els()[0]).toMatchObject({ fill: null, stroke: '#141414' })
  })

  it('FE-STUDIO-P3-018: the edge section offers its tiles on a rectangle and none on a heart', () => {
    const onSet = vi.fn()
    const r = render(<EdgeSection edge={undefined} edgeSize={undefined} outline="rect" onSet={onSet} t={t} />)
    fireEvent.click(r.getByTestId('edge-torn'))
    expect(onSet).toHaveBeenCalledWith({ edge: 'torn' })
    r.unmount()
    const heart = render(<EdgeSection edge={undefined} edgeSize={undefined} outline="heart" onSet={onSet} t={t} />)
    expect(heart.container.innerHTML).toBe('')
  })

  it('FE-STUDIO-P3-019: the line inspector restyles, swaps the ends and undoes in one step each', () => {
    const line = () => els()[1] as BookLineElement
    const r = render(<LineInspector el={line()} spreadIndex={0} t={t} />)
    fireEvent.click(r.getByTestId('line-end').querySelector('[data-value="arrow"]')!)
    expect(line().endCap).toBe('arrow')
    r.rerender(<LineInspector el={line()} spreadIndex={0} t={t} />)
    fireEvent.click(r.getByTestId('line-swap'))
    expect(line()).toMatchObject({ startCap: 'arrow', endCap: 'none' })
    useStudioStore.getState().undo()
    expect(line()).toMatchObject({ startCap: 'none', endCap: 'arrow' })
  })

  it('FE-STUDIO-P3-020: copying a plain shape\'s style onto a painted one takes its paint and edge off', () => {
    const painted = withShapePaint(shape({ edge: 'torn' }), { type: 'pattern', pattern: 'dots', fg: '#000000', bg: null, scale: 1, angle: 0 })
    const out = withPastedStyle(painted, bookElementStyle(shape({ fill: '#ff0000' }))) as BookShapeElement
    expect(out.paint).toBeUndefined()
    expect(out.edge).toBeUndefined()
    expect(out.fill).toBe('#ff0000')
  })
})

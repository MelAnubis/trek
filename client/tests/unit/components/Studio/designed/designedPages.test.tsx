// FE-STUDIO-DP-001 to FE-STUDIO-DP-030 — 5.7.10: designed pages, text effects, fitting, the second shelf of shapes.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDocument, BookElement, BookPhotoElement, BookSpread, BookTextElement } from '../../../../../src/types/book'
import { BOOK_SHAPES, BOOK_SHAPES_MORE } from '../../../../../src/types/book'
import { BOOK_DECORATED_TEMPLATES, decoratedTemplatesFor, findDecoratedTemplate } from '../../../../../src/components/Studio/designed/catalogue'
import { applyDecoratedTemplate } from '../../../../../src/components/Studio/designed/templateApply'
import { keepsProportions, readableTextOn, templateFrame, templatePage } from '../../../../../src/components/Studio/designed/templateLay'
import { assignTemplateTexts, bookDateMarkValue, bookTemplateWords } from '../../../../../src/components/Studio/designed/templateWords'
import { BOOK_COVER_ARCHETYPES, templateNameKey, templatePhotoIndex, templatePhotoSlots } from '../../../../../src/components/Studio/designed/templateFormat'
import { bookCasedText, bookLetterMm, bookTextFits, bookTextIsDrawn, fitBookTexts, fitSpreadTexts, solveBookTextFit } from '../../../../../src/components/Studio/text/textMeasure'
import { bookTextCurvePath } from '../../../../../src/components/Studio/text/textCurve'
import { bandOf, caseStyle, hasTextEffects, lineCentres, outlineStrokeMm, photoCover, withAlpha } from '../../../../../src/components/Studio/text/textEffects'
import { ElementView } from '../../../../../src/components/Studio/SpreadView'
import { StudioTextEffects } from '../../../../../src/components/Studio/text/StudioTextEffects'
import { DesignedPagesPanel } from '../../../../../src/components/Studio/designed/DesignedPagesPanel'
import { SHAPE_PATHS, SHAPE_GROUPS, FRAME_SHAPES } from '../../../../../src/components/Studio/shapes'
import { BOOK_FONT_WEIGHTS, nearestWeight } from '../../../../../src/components/Studio/bookFonts'
import { bookThemeOf, bookThemeColor } from '../../../../../src/components/Studio/bookTheme'
import { contrastRatio } from '../../../../../src/components/Studio/bookColour'
import { useStudioStore } from '../../../../../src/store/studioStore'
import { BOOK_SCHEMA_REV } from '../../../../../src/components/Studio/bookSchemaRev'
import es from '../../../../../src/i18n/translations/es'
import en from '../../../../../src/i18n/translations/en'

vi.mock('../../../../../src/components/Studio/BookPhotoImg', () => ({
  BookPhotoImg: ({ style }: { style?: React.CSSProperties }) => <img data-testid="pic" alt="" style={style} />,
  useBookPhotoSrc: (id: number | null) => (id == null ? '' : `/api/photos/${id}/thumbnail`),
}))

const PAGE = { preset: 'a4-portrait' as const, pageWidth: 210, pageHeight: 297, bleed: 3, safe: 5 }
const base = { frame: { x: 10, y: 10, w: 60, h: 40 }, rotation: 0, opacity: 1, locked: false }
const text = (o: Partial<BookTextElement> = {}): BookTextElement => ({
  ...base, id: 't1', kind: 'text', text: 'Hola', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0,
  color: '#1a1a1a', binding: null, overridden: true, ...o,
})
const photo = (id: number, o: Partial<BookPhotoElement> = {}): BookPhotoElement => ({
  ...base, id: `p${id}`, kind: 'photo', photoId: id, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null, ...o,
})
const spread = (elements: BookElement[], o: Partial<BookSpread> = {}): BookSpread => ({ id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null, ...o })
let n = 0
const ids = (p: string) => `${p}${(n += 1)}`

describe('the catalogue', () => {
  it('FE-STUDIO-DP-001: 48 covers, four per archetype, and 60 spreads, five per archetype, with unique ids', () => {
    expect(BOOK_DECORATED_TEMPLATES).toHaveLength(108)
    expect(new Set(BOOK_DECORATED_TEMPLATES.map(t => t.id)).size).toBe(108)
    for (const a of BOOK_COVER_ARCHETYPES) {
      expect(decoratedTemplatesFor('single', a)).toHaveLength(4)
      expect(decoratedTemplatesFor('inner', a)).toHaveLength(5)
    }
    expect(findDecoratedTemplate('spine-band-stitched')?.kind).toBe('single')
  })

  it('FE-STUDIO-DP-002: every template, archetype and panel word has a Spanish and an English name', () => {
    const keys = [
      ...BOOK_DECORATED_TEMPLATES.map(templateNameKey),
      ...BOOK_COVER_ARCHETYPES.map(a => `journey.studio.designed.archetype.${a}`),
      'journey.studio.designed.title', 'journey.studio.designed.all', 'journey.studio.designed.hint', 'journey.studio.builtInLayouts',
    ]
    for (const k of keys) {
      expect((es as Record<string, string>)[k], k).toBeTruthy()
      expect((en as Record<string, string>)[k], k).toBeTruthy()
    }
  })

  it('FE-STUDIO-DP-003: every shape and mask a template uses is in the shape table, and every sticker exists', async () => {
    const { bookSticker } = await import('../../../../../src/components/Studio/stickers/catalogue')
    for (const t of BOOK_DECORATED_TEMPLATES) for (const e of t.elements) {
      if (e.kind === 'shape') expect(SHAPE_PATHS[e.shape as keyof typeof SHAPE_PATHS], `${t.id} ${String(e.shape)}`).toBeTruthy()
      if (e.kind === 'photo' && e.mask) expect(SHAPE_PATHS[e.mask as keyof typeof SHAPE_PATHS], `${t.id} ${String(e.mask)}`).toBeTruthy()
      if (e.kind === 'sticker') expect(bookSticker(e.stickerId as string), String(e.stickerId)).toBeTruthy()
    }
  })

  it('FE-STUDIO-DP-004: photo roles are numbered and counted', () => {
    expect(templatePhotoIndex('photo:3')).toBe(3)
    expect(templatePhotoIndex('title')).toBeNull()
    expect(templatePhotoSlots(findDecoratedTemplate('spine-band-stitched')!)).toBe(1)
  })
})

describe('laying a template', () => {
  beforeEach(() => { n = 0 })

  it('FE-STUDIO-DP-005: fractions become millimetres, a bleeding edge lands on this page\'s bleed, a kept element keeps its proportions', () => {
    const at = templatePage(PAGE, 1)
    expect(templateFrame({ id: 'a', kind: 'shape', rotation: 0, frame: { x: -0.01, y: 0.5, w: 0.5, h: 0.6 } }, at)).toEqual({ x: -3, y: 148.5, w: 105.9, h: 151.5 })
    const kept = templateFrame({ id: 'b', kind: 'sticker', rotation: 0, frame: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }, at)
    expect(kept.w).toBe(kept.h)
    expect(keepsProportions({ kind: 'text', rotation: -90 })).toBe(true)
    expect(keepsProportions({ kind: 'text', rotation: 0 })).toBe(false)
  })

  it('FE-STUDIO-DP-006: every template lays on a cover or a spread with the page\'s photos and words in it, nothing lost', () => {
    for (const tpl of BOOK_DECORATED_TEMPLATES) {
      const photos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(i => photo(i))
      const sp = spread([...photos, text({ id: 'h', text: 'Lisboa', size: 30 }), text({ id: 'b', text: 'Un paseo largo por la ciudad. '.repeat(6) })], { role: tpl.kind === 'inner' ? 'inner' : 'cover' })
      const out = applyDecoratedTemplate(sp, tpl, PAGE, { newId: ids })
      const placed = out.elements.filter((e): e is BookPhotoElement => e.kind === 'photo' && e.photoId != null).map(e => e.photoId)
      const parked = out.parked.filter((e): e is BookPhotoElement => e.kind === 'photo').map(e => e.photoId)
      expect(new Set([...placed, ...parked]).size, tpl.id).toBe(13)
      expect(out.elements.length, tpl.id).toBeGreaterThan(0)
      expect(out.elements.some(e => e.kind === 'text' && e.text === 'Lisboa') || out.parked.some(e => e.kind === 'text' && e.text === 'Lisboa'), tpl.id).toBe(true)
      for (const e of out.elements) expect(Number.isFinite(e.frame.w) && e.frame.w > 0, `${tpl.id} ${e.id}`).toBe(true)
    }
  })

  it('FE-STUDIO-DP-007: the title role takes the page\'s heading and keeps its binding; empty roles take the book\'s words', () => {
    const tpl = findDecoratedTemplate('spine-band-stitched')!
    const bound = text({ id: 'h', text: 'Oporto', size: 30, binding: { source: 'journey.title' } })
    const out = applyDecoratedTemplate(spread([bound], { role: 'cover' }), tpl, PAGE, { newId: ids, words: { date: { text: '2026' } } })
    const title = out.elements.find(e => e.kind === 'text' && e.text === 'Oporto') as BookTextElement
    expect(title.binding).toEqual({ source: 'journey.title' })
    expect(title.transform).toBe('upper')
    expect(out.elements.some(e => e.kind === 'text' && e.text === '2026')).toBe(true)
  })

  it('FE-STUDIO-DP-008: locked elements stay where they were', () => {
    const lock = text({ id: 'locked', text: 'Fijo', locked: true })
    const out = applyDecoratedTemplate(spread([lock, photo(1)], { role: 'cover' }), findDecoratedTemplate('spine-band-stitched')!, PAGE, { newId: ids })
    expect(out.elements[0]).toBe(lock)
  })

  it('FE-STUDIO-DP-009: fitted titles shrink to their frames and keep the drawn size as their ceiling', () => {
    const out = applyDecoratedTemplate(spread([text({ id: 'h', text: 'Una ciudad con un nombre larguísimo', size: 30 })], { role: 'cover' }), findDecoratedTemplate('spine-band-stitched')!, PAGE, { newId: ids })
    const title = out.elements.find(e => e.kind === 'text' && e.fit === 'shrink' && e.text.startsWith('Una')) as BookTextElement
    expect(title.fitMax).toBeGreaterThan(title.size)
    expect(bookTextFits(title)).toBe(true)
  })

  it('FE-STUDIO-DP-010: with a theme, linked colours follow it and texts on a colour stay readable', () => {
    const theme = bookThemeOf('postcard')
    for (const tpl of BOOK_DECORATED_TEMPLATES.slice(0, 30)) {
      const out = applyDecoratedTemplate(spread([text({ id: 'h', text: 'Roma', size: 30 })], { role: tpl.kind === 'inner' ? 'inner' : 'cover' }), tpl, PAGE, { newId: ids, theme })
      for (const e of out.elements) if (e.kind === 'text' && e.token) expect(e.color, tpl.id).toBe(bookThemeColor(theme, e.token))
    }
    const t = readableTextOn(text({ color: '#ffffff', size: 30 }), 'paper', { ...theme, palette: { ...theme.palette, paper: '#ffffff', ink: '#111111' } })
    expect(contrastRatio(t.color, '#ffffff')).toBeGreaterThan(3)
  })

  it('FE-STUDIO-DP-011: the words of a page come from its journal entry, bound to it', () => {
    const words = bookTemplateWords(spread([], { entryId: 7 }), { bookTitle: 'Libro', locale: 'es', entries: [{ id: 7, title: 'Sintra', location: 'Portugal', date: '2026-07-14', story: 'Palacios' }] })
    expect(words.title).toEqual({ text: 'Sintra', binding: { source: 'entry.title', entryId: 7 } })
    expect(words.date?.binding?.value).toBe('2026-07-14')
    expect(bookTemplateWords(spread([], { role: 'cover' }), { bookTitle: 'Libro', locale: 'es', entries: [{ id: 1, date: '2025-03-01' }] })).toMatchObject({ title: { text: 'Libro' }, date: { text: '2025' } })
    expect(bookDateMarkValue('2026-07-14', 'es')).toEqual({ text: '14', sub: 'JULIO' })
  })

  it('FE-STUDIO-DP-012: a long text only ever goes into the body', () => {
    const long = text({ id: 'l', text: 'x '.repeat(200), size: 40 })
    const got = assignTemplateTexts([long], new Set(['title', 'body'] as const))
    expect(got.get('body')).toBe(long)
    expect(got.get('title')).toBeUndefined()
  })
})

describe('fitting and measuring text', () => {
  it('FE-STUDIO-DP-013: capitals set wider, bold too, and a fitted size is the largest quarter point that holds', () => {
    const t = text({ text: 'MADRID', size: 40, frame: { x: 0, y: 0, w: 30, h: 20 }, fit: 'shrink' })
    expect(bookLetterMm({ ...t, transform: 'upper' })).toBeGreaterThan(bookLetterMm(t))
    expect(bookLetterMm({ ...t, weight: 700 })).toBeGreaterThan(bookLetterMm(t))
    const size = solveBookTextFit(t)
    expect(size).toBeLessThan(40)
    expect(size * 4).toBe(Math.round(size * 4))
    expect(bookTextFits({ ...t, size })).toBe(true)
    expect(bookTextFits({ ...t, size: size + 0.25 })).toBe(false)
  })

  it('FE-STUDIO-DP-014: a size changed by hand is the new ceiling; a frame made larger gives the words their size back', () => {
    const t = text({ text: 'Lisboa', size: 40, fitMax: 40, fit: 'shrink', frame: { x: 0, y: 0, w: 30, h: 20 } })
    const small = fitSpreadTexts(spread([t])).elements[0] as BookTextElement
    expect(small.size).toBeLessThan(40)
    const wide = fitSpreadTexts(spread([{ ...small, frame: { ...small.frame, w: 400, h: 100 } }]), spread([small])).elements[0] as BookTextElement
    expect(wide.size).toBe(40)
    const chosen = fitSpreadTexts(spread([{ ...wide, size: 20 }]), spread([wide])).elements[0] as BookTextElement
    expect(chosen).toMatchObject({ size: 20, fitMax: 20 })
  })

  it('FE-STUDIO-DP-015: the store refits a fitted text on every edit, and leaves the rest alone', () => {
    const doc: BookDocument = { version: 1, title: 'x', page: PAGE, spreads: [spread([text({ id: 'f', text: 'Hi', fit: 'shrink', size: 30, fitMax: 30, frame: { x: 0, y: 0, w: 60, h: 20 } }), text({ id: 'p' })])] }
    useStudioStore.getState().load(doc)
    act(() => useStudioStore.getState().updateElement(0, 'f', { text: 'Un título muchísimo más largo que antes' } as Partial<BookElement>))
    const f = useStudioStore.getState().doc!.spreads[0].elements[0] as BookTextElement
    expect(f.size).toBeLessThan(30)
    expect(f.fitMax).toBe(30)
    expect(fitBookTexts(doc, doc)).toBe(doc)
  })

  it('FE-STUDIO-DP-016: a curve is a chord bowed by its bend, or the frame\'s inscribed circle', () => {
    const flat = bookTextCurvePath({ type: 'arc', bend: 0, start: 0 }, 100, 40, 5)
    expect(flat.d).toMatch(/^M [\d.]+ [\d.]+ L/)
    const arc = bookTextCurvePath({ type: 'arc', bend: 60, start: 0 }, 100, 40, 5)
    expect(arc.length).toBeGreaterThan(flat.length)
    const circle = bookTextCurvePath({ type: 'circle', bend: 0, start: 0 }, 80, 80, 4)
    expect(circle.length).toBeCloseTo(2 * Math.PI * (40 - 3), 1)
  })

  it('FE-STUDIO-DP-017: casing, drawn texts and the helpers behind the renderer', () => {
    expect(bookCasedText({ text: 'Hola', transform: 'upper' })).toBe('HOLA')
    expect(bookCasedText({ text: 'Hola', uppercase: true })).toBe('HOLA')
    expect(bookTextIsDrawn(text({ curve: { type: 'arc', bend: 30, start: 0 } }))).toBe(true)
    expect(bookTextIsDrawn(text({ fillPaint: { type: 'solid', color: '#000000', alpha: 0 } }))).toBe(false)
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    expect(caseStyle(text({ transform: 'smallcaps' }))).toEqual({ fontVariantCaps: 'small-caps' })
    expect(lineCentres(2, 4, 1, 20, 'bottom')).toEqual([14, 18])
    expect(outlineStrokeMm(text({ outline: { color: '#000000', width: 0.5 } }))).toBe(1)
    expect(photoCover(10, 10, { focalX: 1, focalY: 1, zoom: 2 })).toMatchObject({ x: -10, y: -10, width: 20, preserveAspectRatio: 'xMaxYMax slice' })
  })
})

describe('drawing text effects', () => {
  it('FE-STUDIO-DP-018: a plain text keeps the plain path; the old marker stays a marker, a band is a band', () => {
    expect(hasTextEffects(text())).toBe(false)
    const marker = text({ effect: 'highlight', highlight: { color: '#fde68a', alpha: 1, padX: 1, padY: 0.3, radius: 0 } })
    expect(bandOf(marker)).toBeNull()
    expect(hasTextEffects(marker)).toBe(false)
    const { container } = render(<ElementView el={marker} big />)
    expect(container.innerHTML).toContain('linear-gradient')
    const banded = text({ highlight: { color: '#ff0000', alpha: 1, padX: 1, padY: 0.3, radius: 0 } })
    const r = render(<ElementView el={banded} big />)
    expect(r.container.innerHTML).toMatch(/background: (rgb\(255, 0, 0\)|#ff0000)/)
  })

  it('FE-STUDIO-DP-019: outline, shadow and band are layers of the same words; a curve and a photo fill are SVG', () => {
    const fx = render(<ElementView el={text({ text: 'Capas', outline: { color: '#ffffff', width: 0.4 }, shadow: { dx: 1, dy: 1, color: '#000000', alpha: 1 } })} big />)
    expect(fx.getAllByText('Capas')).toHaveLength(3)
    expect(fx.container.innerHTML).toContain('translate(1mm, 1mm)')
    const curved = render(<ElementView el={text({ text: 'Arco', curve: { type: 'arc', bend: 40, start: 0 } })} big />)
    expect(curved.container.querySelector('textPath')?.textContent).toBe('Arco')
    const filled = render(<ElementView el={text({ text: 'Foto', fillPaint: { type: 'photo', photoId: 9, focalX: 0.5, focalY: 0.5, zoom: 1 } })} big />)
    expect(filled.container.querySelector('image')?.getAttribute('href')).toBe('/api/photos/9/thumbnail')
    expect(filled.container.querySelector('clipPath text')).not.toBeNull()
  })

  it('FE-STUDIO-DP-020: middle and bottom set the words in the frame; transform cases them', () => {
    const { container } = render(<ElementView el={text({ text: 'abajo', vAlign: 'bottom', transform: 'upper' })} big />)
    expect(container.innerHTML).toContain('justify-content: flex-end')
    expect(container.innerHTML).toContain('text-transform: uppercase')
  })
})

describe('the inspector and the panel', () => {
  it('FE-STUDIO-DP-021: each effect switches on looking right and off again', () => {
    const set = vi.fn()
    const el = text({ size: 24 })
    render(<StudioTextEffects el={el} set={set} live={vi.fn()} photos={[{ photoId: 4 }]} spread={undefined} t={k => k} />)
    fireEvent.click(screen.getByTestId('fx-outline').querySelector('button, [role=switch], div[style*="cursor"]') ?? screen.getByTestId('fx-outline').lastElementChild!)
    expect(set.mock.calls[0][0].outline.width).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('radio', { name: 'journey.studio.fx.caseUpper' }))
    expect(set).toHaveBeenLastCalledWith({ transform: 'upper', uppercase: false })
    fireEvent.click(screen.getByRole('radio', { name: 'journey.studio.fx.arc' }))
    expect(set).toHaveBeenLastCalledWith({ curve: { type: 'arc', bend: 40, start: 0 } })
    fireEvent.click(screen.getByRole('radio', { name: 'journey.studio.fx.photo' }))
    expect(set).toHaveBeenLastCalledWith({ fillPaint: { type: 'photo', photoId: 4, focalX: 0.5, focalY: 0.5, zoom: 1 } })
    fireEvent.click(screen.getByRole('radio', { name: 'journey.studio.fx.hollow' }))
    expect(set.mock.lastCall![0]).toMatchObject({ fillPaint: { type: 'solid', alpha: 0 }, outline: { color: '#1a1a1a' } })
  })

  it('FE-STUDIO-DP-022: the panel offers covers on a cover, filters by style, and a click lays the page in one undo step', () => {
    const doc: BookDocument = { version: 1, title: 'Mi viaje', page: PAGE, spreads: [spread([photo(1), text({ id: 'h', text: 'Lisboa', size: 30 })], { id: 'c', role: 'cover' })] }
    useStudioStore.getState().load(doc)
    render(<DesignedPagesPanel t={k => k} locale="es" />)
    expect(screen.getAllByRole('button', { name: /journey\.studio\.designed\.name\./ })).toHaveLength(48)
    fireEvent.click(screen.getByRole('radio', { name: 'journey.studio.designed.archetype.riso' }))
    const cards = screen.getAllByRole('button', { name: /journey\.studio\.designed\.name\./ })
    expect(cards).toHaveLength(4)
    fireEvent.click(cards[0])
    const now = useStudioStore.getState()
    expect(now.past).toHaveLength(1)
    expect(now.doc!.spreads[0].elements.some(e => e.kind === 'photo' && e.photoId === 1)).toBe(true)
    expect(now.doc!.spreads[0].elements.length).toBeGreaterThan(2)
  })

  it('FE-STUDIO-DP-023: a double spread is offered the spreads', () => {
    useStudioStore.getState().load({ version: 1, title: 'x', page: PAGE, spreads: [spread([])] })
    render(<DesignedPagesPanel t={k => k} locale="es" />)
    expect(screen.getAllByRole('button', { name: /journey\.studio\.designed\.name\./ })).toHaveLength(60)
  })
})

describe('shapes, fonts and the format', () => {
  it('FE-STUDIO-DP-024: the second shelf is in the shape table, normalised to the box, grouped and partly offered as frames', () => {
    expect(BOOK_SHAPES).toEqual(expect.arrayContaining([...BOOK_SHAPES_MORE]))
    for (const id of BOOK_SHAPES_MORE) {
      // Normalised by the ink, so a curve's control points may stand a little outside the box.
      const nums = SHAPE_PATHS[id].match(/-?\d*\.?\d+/g)!.map(Number)
      expect(nums.every(Number.isFinite), id).toBe(true)
      expect(Math.max(...nums), id).toBeLessThan(130)
      expect(Math.min(...nums), id).toBeGreaterThan(-30)
    }
    const grouped = new Set(SHAPE_GROUPS.flatMap(g => g.shapes))
    for (const id of BOOK_SHAPES_MORE) expect(grouped.has(id), id).toBe(true)
    expect(FRAME_SHAPES).toContain('arch-tall')
  })

  it('FE-STUDIO-DP-025: the inspector offers only the weights a face is bundled in', () => {
    expect(BOOK_FONT_WEIGHTS.bebas).toEqual([400])
    expect(nearestWeight('bebas', 700)).toBe(400)
    expect(nearestWeight('montserrat', 800)).toBe(800)
    expect(nearestWeight('serif', 900)).toBe(700)
  })

  it('FE-STUDIO-DP-026: the book format is at least revision 5', () => {
    expect(BOOK_SCHEMA_REV).toBeGreaterThanOrEqual(5)
  })
})

// FE-STUDIO-P45-001 to FE-STUDIO-P45-020 — 5.7.12: saved designs, lockups, the sticker shelf, the rail's order and tabs.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDocument, BookElement, BookPhotoElement, BookSpread, BookStickerElement, BookTextElement } from '../../../../../src/types/book'
import { BOOK_LOCKUPS } from '../../../../../src/components/Studio/lockups/lockups.data'
import { addBookLockup, bookLockupBox, buildBookLockup, formatBookCoords } from '../../../../../src/components/Studio/lockups/lockups'
import { LockupShelf, SHELF_GROUPS, placeLockup, shelfWords, themePalette } from '../../../../../src/components/Studio/lockups/LockupShelf'
import { matchStickers, newStickerElement, readRecentStickers, rememberSticker, stickerDropped, turned, withSlotColor } from '../../../../../src/components/Studio/stickers/stickerLibrary'
import { BOOK_STICKERS, bookSticker } from '../../../../../src/components/Studio/stickers/catalogue'
import { StickerShelf } from '../../../../../src/components/Studio/stickers/StickerShelf'
import { StickerInspector } from '../../../../../src/components/Studio/stickers/StickerInspector'
import { MAX_BOOK_LAYOUTS, applySavedBookLayout, bookLayoutFromSpread, bookLayoutPreview, nextBookLayoutName } from '../../../../../src/components/Studio/designed/savedLayouts'
import { SavedLayouts } from '../../../../../src/components/Studio/designed/SavedLayouts'
import { bookThemeOf, bookThemeColor } from '../../../../../src/components/Studio/bookTheme'
import { useStudioStore } from '../../../../../src/store/studioStore'
import { BOOK_SCHEMA_REV } from '../../../../../src/components/Studio/bookSchemaRev'
import es from '../../../../../src/i18n/translations/es'
import en from '../../../../../src/i18n/translations/en'

vi.mock('../../../../../src/components/Studio/BookPhotoImg', () => ({
  BookPhotoImg: () => <img data-testid="pic" alt="" />,
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
const doc = (spreads: BookSpread[], o: Partial<BookDocument> = {}): BookDocument => ({ version: 1, title: 'Mi viaje', page: PAGE, spreads, ...o })
const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${JSON.stringify(p)}` : k)
let n = 0
const ids = (p: string) => `${p}${(n += 1)}`
const has = (k: string) => !!(es as Record<string, string>)[k] && !!(en as Record<string, string>)[k]

beforeEach(() => { n = 0; try { localStorage.clear() } catch { /* none */ } })

describe('saved designs', () => {
  it('FE-STUDIO-P45-001: a page kept as a design keeps its look and none of its pictures', () => {
    const sp = spread([photo(1), text({ id: 'h', text: 'Título', size: 30, fillPaint: { type: 'photo', photoId: 1, focalX: 0.5, focalY: 0.5, zoom: 1 } })], { background: '#fafafa' })
    const ly = bookLayoutFromSpread(sp, PAGE, 'Diseño 1', ids)
    expect(ly).toMatchObject({ name: 'Diseño 1', role: 'inner', pageWidth: 210, background: '#fafafa' })
    expect((ly.elements[0] as BookPhotoElement).photoId).toBeNull()
    expect((ly.elements[1] as BookTextElement).fillPaint).toBeNull()
    expect(nextBookLayoutName([ly], 'Diseño')).toBe('Diseño 2')
  })

  it('FE-STUDIO-P45-002: applied, the page\'s pictures and words go in by order and size, the rest is parked, locked stays', () => {
    const ly = bookLayoutFromSpread(spread([photo(1), text({ id: 'big', size: 30 }), text({ id: 'small', size: 9, frame: { x: 0, y: 100, w: 50, h: 10 } })]), PAGE, 'D', ids)
    const lock = text({ id: 'lock', text: 'fijo', locked: true })
    const target = spread([lock, photo(7), photo(8), text({ id: 'a', text: 'Grande', size: 40 }), text({ id: 'b', text: 'pequeño', size: 8 })])
    const out = applySavedBookLayout(target, ly, { ...PAGE, pageWidth: 105 }, ids)
    expect(out.elements[0]).toBe(lock)
    expect((out.elements.find(e => e.kind === 'photo') as BookPhotoElement).photoId).toBe(7)
    expect(out.elements.filter(e => e.kind === 'text' && !e.locked).map(e => (e as BookTextElement).text)).toEqual(['Grande', 'pequeño'])
    expect(out.parked.map(e => e.id)).toEqual(['p8'])
    expect(out.elements[1].frame.x).toBe(5)
    expect(bookLayoutPreview(ly, PAGE).elements).toHaveLength(3)
  })

  it('FE-STUDIO-P45-003: the panel saves the page, lists the designs that fit and applies one in one undo step', () => {
    useStudioStore.getState().load(doc([spread([photo(1), text({ text: 'Lisboa', size: 30 })]), spread([photo(2)], { id: 'sp2' })]))
    render(<SavedLayouts t={t} />)
    fireEvent.click(screen.getByTestId('save-layout'))
    const now = useStudioStore.getState().doc!
    expect(now.layouts).toHaveLength(1)
    expect(now.layouts![0].name).toBe('journey.studio.layoutName 1')
    act(() => useStudioStore.getState().setActiveSpread(1))
    fireEvent.click(screen.getByRole('button', { name: 'journey.studio.layoutName 1' }))
    const sp2 = useStudioStore.getState().doc!.spreads[1]
    expect((sp2.elements.find(e => e.kind === 'photo') as BookPhotoElement).photoId).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'journey.studio.deleteLayout' }))
    expect(useStudioStore.getState().doc!.layouts).toEqual([])
    expect(MAX_BOOK_LAYOUTS).toBe(24)
  })

  it('FE-STUDIO-P45-004: a cover is offered no spread design', () => {
    const ly = bookLayoutFromSpread(spread([photo(1)]), PAGE, 'D', ids)
    useStudioStore.getState().load(doc([spread([photo(1)], { role: 'cover' })], { layouts: [ly] }))
    render(<SavedLayouts t={t} />)
    expect(screen.queryByRole('button', { name: 'D' })).toBeNull()
    expect(screen.getByText('journey.studio.myLayoutsEmpty')).toBeTruthy()
  })
})

describe('text compositions', () => {
  it('FE-STUDIO-P45-005: 24 lockups, every one on the shelf and named in Spanish and English', () => {
    expect(BOOK_LOCKUPS).toHaveLength(24)
    const shelved = SHELF_GROUPS.flatMap(g => g.lockups)
    expect(new Set(shelved)).toEqual(new Set(BOOK_LOCKUPS.map(l => l.id)))
    for (const l of BOOK_LOCKUPS) expect(has(`journey.studio.lockup.${l.id}`), l.id).toBe(true)
    for (const g of SHELF_GROUPS) expect(has(`journey.studio.lockupGroup.${g.id}`), g.id).toBe(true)
  })

  it('FE-STUDIO-P45-006: a lockup becomes ordinary elements with its words fitted, and nothing without words', () => {
    const words = shelfWords('Asturias', { entries: [{ date: '2025-08-01', lat: null, lng: null }] }, k => k)
    expect(words).toMatchObject({ title: 'Asturias', year: '2025' })
    for (const l of BOOK_LOCKUPS) {
      const els = buildBookLockup(l, bookLockupBox(l, PAGE, true), { words, newId: ids })
      expect(els.length, l.id).toBeGreaterThan(0)
      for (const e of els) if (e.kind === 'text') expect(e.size, l.id).toBeLessThanOrEqual(e.fitMax!)
    }
    expect(buildBookLockup(BOOK_LOCKUPS[0], { x: 0, y: 0, w: 100, h: 50 }, { words: {}, newId: ids })).toEqual([])
    expect(formatBookCoords(43.36, -5.85)).toMatch(/^43° 21' 36" N {3}5° 51' 0" W$/)
  })

  it('FE-STUDIO-P45-007: placed on a spread it lands on the right-hand page as one group, in the theme\'s colours', () => {
    const theme = bookThemeOf('poster-pop')
    const palette = themePalette(theme)
    expect(palette.accent).toBe(bookThemeColor(theme, 'accent'))
    const l = BOOK_LOCKUPS.find(x => x.id === 'poster-stack')!
    const els = placeLockup(l, { page: PAGE, spread: spread([]), words: { title: 'Roma', year: '2026', kicker: 'Viaje' }, photos: [], palette, newId: ids })
    expect(Math.min(...els.map(e => e.frame.x))).toBeGreaterThanOrEqual(210)
    const sp = addBookLockup(spread([]), els, 'g1')
    expect(new Set(sp.elements.map(e => e.group))).toEqual(new Set(['g1']))
  })

  it('FE-STUDIO-P45-008: a click on the shelf places the lockup and selects it in one undo step', () => {
    useStudioStore.getState().load(doc([spread([], { role: 'cover' })]))
    render(<LockupShelf t={k => k} photos={[]} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'journey.studio.lockup.poster-stack' })[0])
    const st = useStudioStore.getState()
    expect(st.past).toHaveLength(1)
    expect(st.doc!.spreads[0].elements.length).toBeGreaterThan(1)
    expect(st.selection).toEqual(st.doc!.spreads[0].elements.map(e => e.id))
  })
})

describe('the sticker shelf', () => {
  it('FE-STUDIO-P45-009: every sticker and theme has a Spanish and an English name', () => {
    for (const s of BOOK_STICKERS) expect(has(`journey.studio.sticker.${s.id}`), s.id).toBe(true)
    for (const th of new Set(BOOK_STICKERS.map(s => s.theme))) expect(has(`journey.studio.stickerTheme.${th}`), th).toBe(true)
  })

  it('FE-STUDIO-P45-010: found by its name in the reader\'s language and by its English tags', () => {
    const tr = (k: string) => (es as Record<string, string>)[k] ?? k
    expect(matchStickers('limón', tr)[0].id).toBe('lemon')
    expect(matchStickers('LIMON', tr).map(s => s.id)).toContain('lemon')
    expect(matchStickers('lemon', k => k).map(s => s.id)).toContain('lemon')
    expect(matchStickers('', tr)).toHaveLength(BOOK_STICKERS.length)
  })

  it('FE-STUDIO-P45-011: a new sticker is centred on the page, on the right-hand page of a spread, at its proportions', () => {
    const def = bookSticker('lemon')!
    const cover = newStickerElement(def, PAGE, true)
    expect(cover.frame.x + cover.frame.w / 2).toBeCloseTo(105, 0)
    const inner = newStickerElement(def, PAGE, false)
    expect(inner.frame.x + inner.frame.w / 2).toBeCloseTo(315, 0)
    expect(Math.max(inner.frame.w, inner.frame.h)).toBeCloseTo(63, 0)
    expect(stickerDropped('nope', PAGE, true, { x: 1, y: 1 })).toBeNull()
    expect(stickerDropped('lemon', PAGE, true, { x: 50, y: 60 })!.frame.x).toBeCloseTo(50 - cover.frame.w / 2, 1)
  })

  it('FE-STUDIO-P45-012: the recent shelf keeps nine, newest first, and survives nonsense in storage', () => {
    for (const id of BOOK_STICKERS.slice(0, 11).map(s => s.id)) rememberSticker(id)
    const recent = readRecentStickers()
    expect(recent).toHaveLength(9)
    expect(recent[0].id).toBe(BOOK_STICKERS[10].id)
    localStorage.setItem('trek.studio.recentStickers', '{bad')
    expect(readRecentStickers()).toEqual([])
  })

  it('FE-STUDIO-P45-013: a click on the shelf places the sticker selected; searching narrows the grid', () => {
    useStudioStore.getState().load(doc([spread([], { role: 'cover' })]))
    render(<StickerShelf t={k => (es as Record<string, string>)[k] ?? k} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'limón' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Limón' })[0])
    const st = useStudioStore.getState()
    const el = st.doc!.spreads[0].elements[0] as BookStickerElement
    expect(el).toMatchObject({ kind: 'sticker', stickerId: 'lemon' })
    expect(st.selection).toEqual([el.id])
  })

  it('FE-STUDIO-P45-014: the inspector recolours a slot, resets, mirrors and turns', () => {
    const def = bookSticker('lemon')!
    const el = newStickerElement(def, PAGE, true)
    expect(withSlotColor(el, def.slots, 1, '#ff0000')[1]).toBe('#ff0000')
    expect(withSlotColor(el, def.slots, 1, '#ff0000')).toHaveLength(2)
    expect(turned(170, 15)).toBe(-175)
    const set = vi.fn()
    render(<StickerInspector el={{ ...el, colors: ['#000000'] }} set={set} t={k => k} />)
    fireEvent.click(screen.getByTestId('sticker-flip'))
    expect(set).toHaveBeenLastCalledWith({ flipX: true })
    fireEvent.click(screen.getByText('journey.studio.stickerResetColours'))
    expect(set).toHaveBeenLastCalledWith({ colors: [] })
    fireEvent.click(screen.getByRole('button', { name: 'journey.studio.stickerTurnRight' }))
    expect(set).toHaveBeenLastCalledWith({ rotation: 15 })
  })
})

describe('the rail', () => {
  it('FE-STUDIO-P45-015: sections read Páginas, Contenido, Diseños, Elementos, Viaje, Tema, Capas; Elementos and Viaje have tabs', async () => {
    const { StudioSidebar } = await import('../../../../../src/components/Studio/StudioSidebar')
    useStudioStore.getState().load(doc([spread([], { role: 'cover' })]))
    render(<StudioSidebar journeyId={1} galleryPhotos={[]} />)
    const titles = ['journey.studio.pageTab', 'journey.studio.contentTab', 'journey.studio.layoutsTab', 'journey.studio.elementsTab', 'journey.studio.travelTab', 'studio.theme.panel', 'journey.studio.layers']
    const tops = titles.map(k => screen.getByText(k).getBoundingClientRect && screen.getByText(k))
    const order = tops.map(el => Array.from(document.body.querySelectorAll('*')).indexOf(el))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const travel = within(screen.getByTestId('travel-tabs')).getAllByRole('tab').map(x => x.getAttribute('data-value'))
    expect(travel).toEqual(['figures', 'maps', 'countries', 'marks'])
    fireEvent.click(within(screen.getByTestId('elements-tabs')).getByRole('tab', { name: 'journey.studio.stickers' }))
    expect(screen.getByTestId('sticker-shelf')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('elements-tabs')).getByRole('tab', { name: 'journey.studio.elementsText' }))
    expect(screen.getByTestId('lockup-shelf')).toBeTruthy()
  })

  it('FE-STUDIO-P45-016: the book format is at revision 6', () => {
    expect(BOOK_SCHEMA_REV).toBe(6)
  })
})

import { act } from '@testing-library/react'

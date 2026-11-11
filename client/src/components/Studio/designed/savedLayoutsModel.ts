import type { BookElement, BookLayout, BookPageSetup, BookSpread, BookTextElement } from '../../../types/book'
import { elementId } from '../bookIds'
import { isOrnamentText } from './templateWords'

/*
 * A book's own layouts (5.7.12, liketrek/TREK's book-saved-layouts.ts,
 * AGPLv3): a page somebody arranged, kept to lay other pages out the same
 * way. The whole design, panels, shapes and type included, with the pictures
 * taken out; the page it is applied to brings its own.
 */

export const MAX_BOOK_LAYOUTS = 24
const MAX_SPREAD_ELEMENTS = 90

export const bookLayoutRole = (spread: BookSpread): BookLayout['role'] => (spread.role === 'inner' ? 'inner' : 'single')

function withoutFillPhoto(el: BookElement): BookElement {
  return el.kind === 'text' && el.fillPaint?.type === 'photo' ? { ...el, fillPaint: null } : el
}

/** The arrangement of a spread, as a layout to keep. */
export function bookLayoutFromSpread(spread: BookSpread, page: BookPageSetup, name: string, newId: (p: string) => string = elementId): BookLayout {
  return {
    id: newId('ly'),
    name,
    role: bookLayoutRole(spread),
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    background: spread.background,
    ...(spread.backgroundPaint ? { backgroundPaint: spread.backgroundPaint } : {}),
    elements: spread.elements.map(el => (el.kind === 'photo' ? { ...el, photoId: null } : withoutFillPhoto(el))),
  }
}

/** The next free "Diseño n" name, so a save needs no dialog. */
export function nextBookLayoutName(existing: readonly BookLayout[], base: string): string {
  const taken = new Set(existing.map(l => l.name))
  let n = existing.length + 1
  while (taken.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

const textSize = (el: BookElement) => (el.kind === 'text' ? el.size : 0)

function photoFilled(el: BookTextElement, photo: BookElement | undefined): BookTextElement {
  if (el.fillPaint?.type !== 'photo') return el
  if (photo?.kind !== 'photo' || photo.photoId == null) return { ...el, fillPaint: null }
  return { ...el, fillPaint: { type: 'photo', photoId: photo.photoId, focalX: photo.focalX, focalY: photo.focalY, zoom: 1 } }
}

/**
 * Lay a spread out on a saved layout, keeping what the spread holds: its
 * pictures into the layout's frames in order, its words into the layout's text
 * boxes (the largest into the largest), what does not fit parked. A text box
 * that was filled from a journal entry and finds nothing to take is left out.
 * Marks and lists take the values of the spread's own of the same kind.
 * Locked elements stay where they are.
 */
export function applySavedBookLayout(spread: BookSpread, layout: BookLayout, page: BookPageSetup, newId: (p: string) => string = elementId): BookSpread {
  const sx = page.pageWidth / layout.pageWidth
  const sy = page.pageHeight / layout.pageHeight
  const free = spread.elements.filter(e => !e.locked)
  const pool = [...free, ...(spread.parked ?? [])]
  const photos = pool.filter(e => e.kind === 'photo' && e.photoId != null)
  const isWords = (e: BookElement) => e.kind === 'text' && !!e.text.trim() && !isOrnamentText(e)
  const texts = pool.filter(isWords).sort((a, b) => textSize(b) - textSize(a))
  const slots = layout.elements.filter(e => e.kind === 'text' && !isOrnamentText(e)).sort((a, b) => textSize(b) - textSize(a))
  const wordsFor = new Map<BookElement, BookElement>()
  slots.forEach((slot, i) => { const w = texts[i]; if (w) wordsFor.set(slot, w) })

  const marks = new Map<string, BookElement[]>()
  for (const el of free) {
    const key = el.kind === 'badge' ? `badge:${el.variant}` : el.kind === 'list' ? 'list' : null
    if (key) marks.set(key, [...(marks.get(key) ?? []), el])
  }
  const takeMark = (key: string) => marks.get(key)?.shift()

  let pi = 0
  const out: BookElement[] = []
  for (const el of layout.elements) {
    const frame = { x: el.frame.x * sx, y: el.frame.y * sy, w: el.frame.w * sx, h: el.frame.h * sy }
    const base = { ...el, id: newId(el.kind[0] ?? 'e'), frame, locked: false } as BookElement
    if (base.kind === 'photo') {
      const src = photos[pi++]
      out.push(src && src.kind === 'photo' ? { ...base, photoId: src.photoId, focalX: src.focalX, focalY: src.focalY } : base)
    } else if (base.kind === 'text' && el.kind === 'text') {
      const own = photoFilled(base, photos[0])
      const src = wordsFor.get(el)
      if (src && src.kind === 'text') out.push({ ...own, text: src.text, binding: src.binding, overridden: src.overridden })
      else if (!el.binding) out.push(own)
    } else if (base.kind === 'badge') {
      const own = takeMark(`badge:${base.variant}`)
      out.push(own && own.kind === 'badge' ? { ...base, text: own.text, sub: own.sub, code: own.code } : base)
    } else if (base.kind === 'list') {
      const own = takeMark('list')
      out.push(own && own.kind === 'list' ? { ...base, items: own.items } : base)
    } else out.push(base)
  }

  const used = new Set(wordsFor.values())
  const parked = [...photos.slice(pi), ...texts.filter(t => !used.has(t))].slice(0, MAX_SPREAD_ELEMENTS)
  // Locked elements back where they were in the paint order.
  const elements = out.slice(0, MAX_SPREAD_ELEMENTS)
  spread.elements.forEach((el, i) => { if (el.locked) elements.splice(Math.min(i, elements.length), 0, el) })
  const { backgroundPaint: _old, backgroundToken: _unlinked, ...rest } = spread
  return { ...rest, background: layout.background, ...(layout.backgroundPaint ? { backgroundPaint: layout.backgroundPaint } : {}), elements: elements.slice(0, MAX_SPREAD_ELEMENTS), parked }
}

/** A saved layout drawn as a spread on this book's page, for its card. Nothing filled in. */
export function bookLayoutPreview(layout: BookLayout, page: BookPageSetup): BookSpread {
  const sx = page.pageWidth / layout.pageWidth
  const sy = page.pageHeight / layout.pageHeight
  return {
    id: layout.id,
    role: layout.role === 'inner' ? 'inner' : 'first',
    background: layout.background,
    ...(layout.backgroundPaint ? { backgroundPaint: layout.backgroundPaint } : {}),
    elements: layout.elements.map(el => ({ ...withoutFillPhoto(el), frame: { x: el.frame.x * sx, y: el.frame.y * sy, w: el.frame.w * sx, h: el.frame.h * sy } }) as BookElement),
    parked: [],
    entryId: null,
  }
}

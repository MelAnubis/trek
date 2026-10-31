import type { BookBadgeElement, BookElement, BookMapElement, BookPageSetup, BookPhotoElement, BookSpread, BookTextElement, BookTheme } from '../../../types/book'
import { elementId } from '../bookIds'
import { gatherGroups, regroupCopies, tidyGroups } from '../bookGroups'
import { themedSpread } from '../bookTheme'
import { fitSpreadTexts } from '../text/textMeasure'
import { templatePhotoIndex, type BookDecoratedTemplate, type BookTemplateTextRole } from './templateFormat'
import { layTemplateElement, readableTextOn, templateBackgroundPaint, templatePage, type LaidElement } from './templateLay'
import { assignTemplateTexts, bookDateMarkValue, isOrnamentText, isTemplateFigureText, textRolesOf, type BookTemplateWord, type BookTemplateWords } from './templateWords'

/*
 * Laying a page out on a designed page (5.7.10). Ported from liketrek/TREK's
 * template-apply.ts (AGPLv3).
 *
 * The page's pictures go into the template's photo frames in order, its words
 * into the text roles (templateWords.ts), its date into a date mark, its map
 * into the template's map; what the template has no room for is parked with
 * the page rather than lost. Locked elements stay where they are. What the
 * template brings is its design; its colours and faces follow the book's
 * theme where they are linked, and its fitted titles fit the words given.
 */

export interface ApplyDecoratedTemplateOptions {
  theme?: BookTheme | null
  words?: BookTemplateWords
  locale?: string
  newId?: (prefix: string) => string
}

const MAX_SPREAD_ELEMENTS = 90
type TextEl = BookTextElement

function pouredText(slot: TextEl, src: TextEl | undefined, word: BookTemplateWord | undefined): TextEl | null {
  if (src) return { ...slot, text: src.text, binding: src.binding, overridden: src.overridden }
  if (!word?.text.trim()) return null
  return { ...slot, text: word.text, binding: word.binding ?? null, overridden: false }
}

function mapAsPhoto(slot: BookMapElement, src: BookPhotoElement | undefined): BookPhotoElement {
  return {
    id: slot.id, kind: 'photo', frame: slot.frame, rotation: slot.rotation, opacity: slot.opacity, locked: false,
    ...(slot.group ? { group: slot.group } : {}),
    photoId: src?.photoId ?? null, fit: 'cover', focalX: src?.focalX ?? 0.5, focalY: src?.focalY ?? 0.5,
    radius: 0, filter: 'none', mask: null, frameStyle: 'none',
  }
}

/** Closer than this to the fold, in millimetres, a picture's focal point is lost in the binding. */
const FOLD_REACH = 12

function pouredPhoto(slot: BookPhotoElement, src: BookPhotoElement | undefined, fold: number | null): BookPhotoElement {
  if (!src) return { ...slot, photoId: null }
  const inFold = fold !== null && Math.abs(slot.frame.x + src.focalX * slot.frame.w - fold) < FOLD_REACH
  return { ...slot, photoId: src.photoId, focalX: inFold ? slot.focalX : src.focalX, focalY: src.focalY }
}

function pouredMark(slot: BookBadgeElement, own: BookBadgeElement | undefined, src: TextEl | undefined, word: BookTemplateWord | undefined, locale: string): { mark: BookBadgeElement | null; fromText: boolean } {
  if (own) return { mark: { ...slot, text: own.text, sub: own.sub, code: own.code }, fromText: false }
  const ofText = bookDateMarkValue(src?.binding?.value, locale)
  if (ofText) return { mark: { ...slot, ...ofText }, fromText: true }
  const ofWord = bookDateMarkValue(word?.binding?.value, locale)
  return { mark: ofWord ? { ...slot, ...ofWord } : null, fromText: false }
}

interface Pool { photos: BookPhotoElement[]; texts: TextEl[]; map: BookMapElement | undefined; marks: BookBadgeElement[] }

function poolOf(spread: BookSpread): Pool {
  const all = [...spread.elements.filter(e => !e.locked), ...spread.parked]
  return {
    photos: all.filter((e): e is BookPhotoElement => e.kind === 'photo' && e.photoId != null),
    texts: all.filter((e): e is TextEl => e.kind === 'text' && !!e.text.trim() && !isOrnamentText(e) && !isTemplateFigureText(e)),
    map: all.find((e): e is BookMapElement => e.kind === 'map' && !!e.src),
    marks: all.filter((e): e is BookBadgeElement => e.kind === 'badge'),
  }
}

function withFill(el: TextEl, photo: BookPhotoElement | undefined): TextEl {
  if (photo?.photoId == null) return { ...el, fillPaint: null }
  return { ...el, fillPaint: { type: 'photo', photoId: photo.photoId, focalX: photo.focalX, focalY: photo.focalY, zoom: 1 } }
}

const isTextRole = (role: string | undefined, roles: ReadonlySet<BookTemplateTextRole>): role is BookTemplateTextRole =>
  role !== undefined && roles.has(role as BookTemplateTextRole)

function pour(laid: readonly LaidElement[], pool: Pool, fold: number | null, opts: ApplyDecoratedTemplateOptions) {
  const photoOrder = laid.map(l => templatePhotoIndex(l.role)).filter((n): n is number => n !== null).sort((a, b) => a - b)
  const photoOf = new Map(photoOrder.map((n, i) => [n, pool.photos[i]]))
  // A map role with nothing to draw takes the next picture instead, so its place is never an empty hole.
  const mapless = !pool.map && laid.some(l => l.role === 'map')
  const spare = mapless ? pool.photos[photoOrder.length] : undefined
  const roles = textRolesOf(laid.flatMap(l => (l.role ? [l.role] : [])))
  const textOf = assignTemplateTexts(pool.texts, roles)
  const usedTexts = new Set(textOf.values())
  const locale = opts.locale ?? 'en'

  const out: BookElement[] = []
  for (const { el, role, fillPhoto } of laid) {
    const photo = templatePhotoIndex(role)
    if (el.kind === 'photo' && photo !== null) out.push(pouredPhoto(el, photoOf.get(photo), fold))
    else if (el.kind === 'text' && isTextRole(role, roles)) {
      const text = pouredText(el, textOf.get(role), opts.words?.[role])
      const fill = templatePhotoIndex(fillPhoto)
      if (text) out.push(fill === null ? text : withFill(text, photoOf.get(fill)))
    } else if (el.kind === 'badge' && isTextRole(role, roles)) {
      const src = textOf.get(role)
      const own = pool.marks.find(m => m.variant === el.variant)
      const { mark, fromText } = pouredMark(el, own, src, opts.words?.[role], locale)
      if (mark) out.push(mark)
      // A date line the mark was not made of stays with the page.
      if (src && !fromText) usedTexts.delete(src)
    } else if (el.kind === 'map' && role === 'map') {
      out.push(pool.map ? { ...el, src: pool.map.src, fit: pool.map.fit } : mapAsPhoto(el, spare))
    } else if (!role) out.push(el)
  }
  const placed = photoOrder.length + (mapless ? 1 : 0)
  const parked = [...pool.photos.slice(placed), ...pool.texts.filter(t => !usedTexts.has(t))].slice(0, MAX_SPREAD_ELEMENTS)
  return { elements: out, parked }
}

function withLocked(spread: BookSpread, elements: BookElement[]): BookElement[] {
  const next = elements.slice(0, MAX_SPREAD_ELEMENTS)
  spread.elements.forEach((el, i) => { if (el.locked) next.splice(Math.min(i, next.length), 0, el) })
  return next.slice(0, MAX_SPREAD_ELEMENTS)
}

/** Every element of a template laid on a page of this book, nothing poured yet. */
export function layDecoratedTemplate(tpl: BookDecoratedTemplate, page: BookPageSetup, theme: BookTheme | null, newId: (prefix: string) => string): LaidElement[] {
  const at = templatePage(page, tpl.kind === 'inner' ? 2 : 1)
  return tpl.elements.flatMap(src => layTemplateElement(src, at, theme, newId(src.kind.charAt(0))) ?? [])
}

function readableSpread(spread: BookSpread, laid: readonly LaidElement[], theme: BookTheme): BookSpread {
  const onOf = new Map(laid.flatMap(l => (l.on ? [[l.el.id, l.on] as const] : [])))
  if (!onOf.size) return spread
  const elements = spread.elements.map(e => {
    const on = e.kind === 'text' ? onOf.get(e.id) : undefined
    return on && e.kind === 'text' ? readableTextOn(e, on, theme) : e
  })
  return elements.every((e, i) => e === spread.elements[i]) ? spread : { ...spread, elements }
}

/** The spread laid out on a designed page; a single page takes a `single` one, a spread an `inner` one. */
export function applyDecoratedTemplate(spread: BookSpread, tpl: BookDecoratedTemplate, page: BookPageSetup, opts: ApplyDecoratedTemplateOptions = {}): BookSpread {
  const newId = opts.newId ?? elementId
  const theme = opts.theme ?? null
  const laid = layDecoratedTemplate(tpl, page, theme, newId)
  const fold = tpl.kind === 'inner' ? page.pageWidth : null
  const { elements, parked } = pour(laid, poolOf(spread), fold, opts)
  const regrouped = regroupCopies(elements, undefined, newId)

  const { backgroundPaint: _old, backgroundToken: _link, groups: _groups, ...rest } = spread
  const paint = templateBackgroundPaint(tpl, theme)
  const lockedGroups = (spread.groups ?? []).filter(g => spread.elements.some(e => e.locked && e.group === g.id))
  let next: BookSpread = {
    ...rest,
    background: tpl.background,
    ...(tpl.backgroundToken ? { backgroundToken: tpl.backgroundToken } : {}),
    ...(paint ? { backgroundPaint: paint } : {}),
    ...(lockedGroups.length ? { groups: lockedGroups } : {}),
    elements: withLocked(spread, regrouped.elements),
    parked,
  }
  if (theme) next = themedSpread(next, theme)
  next = fitSpreadTexts(tidyGroups(gatherGroups(next)))
  return theme ? readableSpread(next, laid, theme) : next
}

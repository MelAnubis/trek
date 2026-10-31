import type { BookPageSetup, BookStickerElement } from '../../../types/book'
import { elementId } from '../bookIds'
import { BOOK_STICKERS, bookSticker, bookStickerSlotColor } from './catalogue'
import type { BookStickerDef, BookStickerSlot, BookStickerTheme } from './sticker-types'

/*
 * The Studio's side of the sticker library (5.7.12, after liketrek/TREK's
 * stickerLibrary.ts): each sticker's name in the reader's language, the search,
 * the shelf of recently used ones and a new sticker element where it was
 * clicked or dropped.
 */

type T = (key: string, params?: Record<string, string | number>) => string

/** The drag the shelf starts and the canvas takes. */
export const STICKER_DRAG_TYPE = 'application/x-trek-sticker'

export const stickerLabel = (t: T, id: string) => t(`journey.studio.sticker.${id}`)
export const stickerThemeLabel = (t: T, theme: BookStickerTheme) => t(`journey.studio.stickerTheme.${theme}`)

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Stickers matching what was typed: by their name in the reader's language first, then by the English id, tags and description. */
export function matchStickers(query: string, t: T): BookStickerDef[] {
  const words = fold(query.trim())
  if (!words) return [...BOOK_STICKERS]
  const byLabel = BOOK_STICKERS.filter(s => fold(stickerLabel(t, s.id)).includes(words))
  const seen = new Set(byLabel.map(s => s.id))
  const terms = words.split(/\s+/)
  const byTags = BOOK_STICKERS.filter(s => {
    if (seen.has(s.id)) return false
    const hay = fold([s.id, ...s.tags, s.descr].join(' '))
    return terms.every(w => hay.includes(w))
  })
  return [...byLabel, ...byTags]
}

const RECENT_STORAGE = 'trek.studio.recentStickers'
export const MAX_RECENT_STICKERS = 9

/** The stickers this viewer placed last, newest first; empty where storage is refused or holds nonsense. */
export function readRecentStickers(): BookStickerDef[] {
  let ids: unknown
  try {
    ids = JSON.parse(window.localStorage.getItem(RECENT_STORAGE) ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(ids)) return []
  return ids.flatMap(id => { const def = typeof id === 'string' ? bookSticker(id) : undefined; return def ? [def] : [] })
}

/** Puts a sticker at the front of the recent shelf and answers the shelf as it is now. */
export function rememberSticker(id: string): BookStickerDef[] {
  const next = [id, ...readRecentStickers().map(s => s.id).filter(o => o !== id)].slice(0, MAX_RECENT_STICKERS)
  try { window.localStorage.setItem(RECENT_STORAGE, JSON.stringify(next)) } catch { /* storage refused: this visit only */ }
  return next.flatMap(x => bookSticker(x) ?? [])
}

/** A new sticker's size: its longest side 30 % of the page's shorter side, at its own proportions. */
export function bookStickerSize(box: readonly [number, number], page: Pick<BookPageSetup, 'pageWidth' | 'pageHeight'>) {
  const longest = Math.min(page.pageWidth, page.pageHeight) * 0.3
  const [w, h] = box
  const k = longest / Math.max(w, h, 1)
  return { w: Math.round(w * k * 100) / 100, h: Math.round(h * k * 100) / 100 }
}

/** A new sticker element centred on `at` (where it was dropped), else on the page, the right-hand one of a spread. */
export function newStickerElement(def: BookStickerDef, page: Pick<BookPageSetup, 'pageWidth' | 'pageHeight'>, single: boolean, at?: { x: number; y: number }): BookStickerElement {
  const { w, h } = bookStickerSize(def.box, page)
  const cx = at?.x ?? (single ? page.pageWidth / 2 : page.pageWidth * 1.5)
  const cy = at?.y ?? page.pageHeight / 2
  const r = (v: number) => Math.round(v * 100) / 100
  return { id: elementId('k'), kind: 'sticker', frame: { x: r(cx - w / 2), y: r(cy - h / 2), w, h }, rotation: 0, opacity: 1, locked: false, stickerId: def.id, colors: [], flipX: false }
}

/** The sticker a drop onto the page carries, put on the recent shelf; null for anything else. */
export function stickerDropped(id: string, page: Pick<BookPageSetup, 'pageWidth' | 'pageHeight'>, single: boolean, at: { x: number; y: number }): BookStickerElement | null {
  const def = id ? bookSticker(id) : undefined
  if (!def) return null
  rememberSticker(def.id)
  return newStickerElement(def, page, single, at)
}

/** The colours with slot `slot` set to `color`, the slots before it filled with what they show now. */
export function withSlotColor(el: Pick<BookStickerElement, 'colors'>, slots: readonly BookStickerSlot[], slot: number, color: string): string[] {
  const named = slots.map((_, i) => bookStickerSlotColor(slots, el.colors, i))
  named[slot] = color
  return named.slice(0, Math.max(el.colors.length, slot + 1))
}

/** Turned by `by` degrees, kept between -180 and 180. */
export function turned(rotation: number, by: number): number {
  let next = (rotation + by) % 360
  if (next > 180) next -= 360
  if (next < -180) next += 360
  return Math.round(next * 10) / 10
}

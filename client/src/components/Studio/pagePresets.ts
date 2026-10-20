import type { BookDocument, BookElement, BookPageSetup } from '../../types/book'

/**
 * The book's own page presets, as concrete dimensions — kept next to
 * `bookPageSetupSchema`'s enum (server/src/services/journeyBook/bookSchema.ts)
 * rather than duplicated inline, since a new book's "Create" flow and any
 * future page-size picker both need the same numbers.
 *
 * `custom` isn't listed here — its width/height/bleed come from whatever the
 * caller types in, not a fixed table entry.
 */
export const PAGE_PRESETS: Record<Exclude<BookPageSetup['preset'], 'custom'>, { pageWidth: number; pageHeight: number; bleed: number; labelKey: string }> = {
  'square-210': { pageWidth: 210, pageHeight: 210, bleed: 3, labelKey: 'journey.studio.pagePreset.square210' },
  'square-300': { pageWidth: 300, pageHeight: 300, bleed: 3, labelKey: 'journey.studio.pagePreset.square300' },
  'a4-portrait': { pageWidth: 210, pageHeight: 297, bleed: 3, labelKey: 'journey.studio.pagePreset.a4Portrait' },
  'a4-landscape': { pageWidth: 297, pageHeight: 210, bleed: 3, labelKey: 'journey.studio.pagePreset.a4Landscape' },
  'a5-landscape': { pageWidth: 210, pageHeight: 148, bleed: 3, labelKey: 'journey.studio.pagePreset.a5Landscape' },
}

/** Build a full page setup from a preset id, or from explicit custom dimensions. */
export function pageSetupFor(preset: BookPageSetup['preset'], custom?: { pageWidth: number; pageHeight: number; bleed: number }): BookPageSetup {
  if (preset === 'custom') {
    const c = custom ?? { pageWidth: 210, pageHeight: 210, bleed: 3 }
    return { preset, pageWidth: clampPageSize(c.pageWidth), pageHeight: clampPageSize(c.pageHeight), bleed: Math.min(BLEED_MAX, Math.max(0, Number.isFinite(c.bleed) ? c.bleed : 3)), safe: 5 }
  }
  const p = PAGE_PRESETS[preset]
  return { preset, pageWidth: p.pageWidth, pageHeight: p.pageHeight, bleed: p.bleed, safe: 5 }
}

/*
 * ── Free sizes and edges ─────────────────────────────────────────────────
 *
 * The same ranges upstream's picker allows (liketrek/TREK's
 * useJourneyStudio.ts): trim between 50 and 600 mm on either side, bleed up
 * to 20 mm and a safe margin up to 40 mm, all to a tenth of a millimetre.
 * Wider than any photo-book press asks for, narrower than a typo.
 */
export const PAGE_SIZE_MIN = 50
export const PAGE_SIZE_MAX = 600
export const BLEED_MAX = 20
export const SAFE_MAX = 40

const tenth = (v: number) => Math.round(v * 10) / 10

export function clampPageSize(v: number): number {
  if (!Number.isFinite(v)) return PAGE_SIZE_MIN
  return tenth(Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, v)))
}

export function clampPageEdge(which: 'bleed' | 'safe', v: number): number {
  if (!Number.isFinite(v)) return 0
  return tenth(Math.min(which === 'bleed' ? BLEED_MAX : SAFE_MAX, Math.max(0, v)))
}

/** The preset a width/height pair already is, if any — typing 210 × 297 into the free fields is A4, not "custom". */
export function presetMatching(pageWidth: number, pageHeight: number): BookPageSetup['preset'] {
  const hit = (Object.keys(PAGE_PRESETS) as (keyof typeof PAGE_PRESETS)[])
    .find(k => PAGE_PRESETS[k].pageWidth === pageWidth && PAGE_PRESETS[k].pageHeight === pageHeight)
  return hit ?? 'custom'
}

/*
 * ── Reflow ────────────────────────────────────────────────────────────────
 *
 * Elements are placed in millimetres from the sheet's top-left trim corner,
 * so a size change on its own leaves them where they were: shrink A4
 * portrait to A5 landscape and half the page falls off the bottom. Reflow
 * moves every frame to the same *relative* place on the new sheet.
 *
 * Each axis maps the bleed box linearly onto the new bleed box — from
 * [-bleed, sheet + bleed] to [-bleed', sheet' + bleed']. That keeps the two
 * things a book's layout actually hangs on:
 *   - a full-bleed element still runs exactly to the new bleed edge, rather
 *     than stopping short of it (or leaving white at the trim) because its
 *     -3 mm got scaled to -2.1 mm;
 *   - the gutter of an inner spread (its midpoint) stays its midpoint, so a
 *     photo filling the left page still fills the left page.
 *
 * Frames scale per axis — a photo frame is cropped by `fit: cover` anyway,
 * and a square page going portrait *should* give its photos more height.
 * What must not stretch is type: text size, shape strokes and corner radii
 * scale by the smaller of the two factors, so a narrower page never makes a
 * line of text wider than its now-narrower box.
 */
function axisMap(fromSheet: number, fromBleed: number, toSheet: number, toBleed: number) {
  const k = (toSheet + 2 * toBleed) / (fromSheet + 2 * fromBleed)
  return { k, at: (v: number) => (v + fromBleed) * k - toBleed }
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function reflowElement<T extends BookElement>(el: T, sx: ReturnType<typeof axisMap>, sy: ReturnType<typeof axisMap>): T {
  const x = sx.at(el.frame.x)
  const y = sy.at(el.frame.y)
  const x2 = sx.at(el.frame.x + el.frame.w)
  const y2 = sy.at(el.frame.y + el.frame.h)
  const s = Math.min(sx.k, sy.k)
  const next: BookElement = { ...el, frame: { x: r2(x), y: r2(y), w: r2(Math.max(1, x2 - x)), h: r2(Math.max(1, y2 - y)) } }
  if (next.kind === 'text') next.size = r2(Math.min(200, Math.max(4, next.size * s)))
  if ('strokeWidth' in next && typeof next.strokeWidth === 'number') (next as { strokeWidth: number }).strokeWidth = r2(next.strokeWidth * s)
  if ('radius' in next && typeof next.radius === 'number') (next as { radius: number }).radius = r2(next.radius * s)
  return next as T
}

/** The whole document re-placed onto `next` — see the note above. Spreads keep their order, ids and content; only geometry changes. */
export function reflowDocument(doc: BookDocument, next: BookPageSetup): BookDocument {
  const from = doc.page
  const same = from.pageWidth === next.pageWidth && from.pageHeight === next.pageHeight && from.bleed === next.bleed
  if (same) return { ...doc, page: next }
  const sy = axisMap(from.pageHeight, from.bleed, next.pageHeight, next.bleed)
  return {
    ...doc,
    page: next,
    spreads: doc.spreads.map(sp => {
      const pages = sp.role === 'inner' ? 2 : 1
      const sx = axisMap(from.pageWidth * pages, from.bleed, next.pageWidth * pages, next.bleed)
      return {
        ...sp,
        elements: sp.elements.map(el => reflowElement(el, sx, sy)),
        parked: sp.parked.map(el => reflowElement(el, sx, sy)),
      }
    }),
  }
}

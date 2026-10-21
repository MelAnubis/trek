import type {
  BookBadgeElement, BookCountriesElement, BookElement, BookPageSetup, BookPhotoElement, BookShapeElement, BookSpread, BookTextElement,
} from '../../types/book'
import { elementId } from './bookIds'
import { formatBookCoords, formatBookDate } from './entryText'
import { countryName } from './countryShapes'

/**
 * The editorial spread designs, ported from liketrek/trek's autoLayout.ts
 * (same AGPLv3 license): place, story, pano, gallery, immersive, panel and
 * band.
 *
 * A printed travel book is not photographs on paper with captions: it is
 * built out of *areas* — a page laid solid in ink with pale type on it, a
 * band down the outer edge, a picture overrunning the panel it sits
 * against, a box ruled around a block of text — plus the small marks that
 * say where and when: a flag beside the country's name, the coordinates
 * under a place, a "DAY 5" chip over a rule with a dot on it.
 *
 * Unlike this fork's classic templates, these designs are drawn for the
 * *open book*: a picture runs up to the fold or across it on purpose. That
 * is why they are an opt-in style ('editorial') and a per-spread choice,
 * never what the classic auto-layout falls back on — the classic one keeps
 * every page standing on its own for single-leaf print uploads.
 *
 * Fork differences from upstream:
 * - Our map element is a baked snapshot, so upstream's live `placeMap`
 *   becomes the country's outline with its flag (no network at layout time).
 * - Upstream's flag row is a badge; our badge stacks the flag over the
 *   words, so the row is a one-country `countries` element instead, which
 *   draws flag and name side by side.
 */

export const EDITORIAL_DESIGNS = ['place', 'story', 'pano', 'gallery', 'immersive', 'panel', 'band'] as const
export type EditorialDesign = (typeof EDITORIAL_DESIGNS)[number]

export interface EditorialPhoto {
  photoId: number
  width?: number | null
  height?: number | null
  caption?: string | null
}

export interface EditorialEntry {
  id: number
  title: string | null
  story: string | null
  location: string | null
  date: string | null
  photos: EditorialPhoto[]
  lat?: number | null
  lng?: number | null
  country?: string | null
  /** Which day of the journey this is, 1-based. Null when the dates do not say. */
  dayNumber?: number | null
  /** How many days the journey runs, for the progress rule along the foot. */
  dayCount?: number | null
}

export interface EditorialInput {
  locale: string
  page: BookPageSetup
  /** The word before a day number on a chip — "DÍA". Already translated. */
  dayLabel?: string
}

type Frame = { x: number; y: number; w: number; h: number }

// Print ink, not app chrome — a book is read on paper, where the UI theme means nothing.
const INK = '#1a1a1a'
const ACCENT = '#c2410c'
const PANEL_INK = '#12161d'
const PANEL_TYPE = '#f2efe9'
const CREAM = '#faf8f4'

const isPortrait = (p: EditorialPhoto) => (p.width && p.height ? p.height > p.width * 1.08 : false)
const isPano = (p: EditorialPhoto) => (p.width && p.height ? p.width > p.height * 2 : false)

// ── element factories ───────────────────────────────────────────────────────

function text(frame: Frame, value: string, opts: Partial<BookTextElement> = {}): BookTextElement {
  return {
    id: elementId('t'), kind: 'text', frame, rotation: 0, opacity: 1, locked: false,
    text: value.slice(0, 8000), font: 'sans', size: 11, weight: 400, italic: false, align: 'left',
    leading: 1.45, tracking: 0, color: INK, binding: null, overridden: true,
    ...opts,
  }
}

/** A bound text stays live (resolveBindings re-reads it) until edited by hand. */
function bound(frame: Frame, value: string, binding: BookTextElement['binding'], opts: Partial<BookTextElement> = {}): BookTextElement {
  return text(frame, value, { ...opts, binding, overridden: false })
}

/** `photoId` null is an empty frame: drawn as a placeholder and filled by drag. */
function photo(frame: Frame, photoId: number | null, opts: Partial<BookPhotoElement> = {}): BookPhotoElement {
  return {
    id: elementId('p'), kind: 'photo', frame, rotation: 0, opacity: 1, locked: false,
    photoId, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null,
    ...opts,
  }
}

function shape(frame: Frame, fill: string | null, opts: Partial<BookShapeElement> = {}): BookShapeElement {
  return {
    id: elementId('s'), kind: 'shape', frame, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill, gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
    ...opts,
  }
}

function badge(frame: Frame, variant: BookBadgeElement['variant'], value: { text?: string; sub?: string; code?: string | null }, opts: Partial<BookBadgeElement> = {}): BookBadgeElement {
  return {
    id: elementId('bd'), kind: 'badge', frame, rotation: 0, opacity: 1, locked: false,
    font: 'sans', color: INK, accent: INK,
    variant, text: value.text ?? '', sub: value.sub ?? '', code: value.code ?? null, style: 'plain',
    ...opts,
  }
}

function countries(frame: Frame, codes: string[], names: string[], opts: Partial<BookCountriesElement> = {}): BookCountriesElement {
  return {
    id: elementId('co'), kind: 'countries', frame, rotation: 0, opacity: 1, locked: false,
    font: 'sans', color: INK, accent: INK,
    codes, names, layout: 'list', showOutline: false, showFlag: true, showName: true, align: 'left',
    ...opts,
  }
}

// ── the marks a printed travel page is made of ──────────────────────────────

function countryOf(entry: EditorialEntry, input: EditorialInput): string {
  return entry.country ? countryName(entry.country, input.locale) : ''
}

/** A country's flag with its name beside it, the way a page opens. */
function flagRow(frame: Frame, entry: EditorialEntry, input: EditorialInput, ink = INK): BookElement | null {
  if (!entry.country) return null
  const name = countryOf(entry, input)
  return countries(frame, [entry.country.toUpperCase()], [name], { color: ink })
}

/** Where on earth this is, set small under the name. */
function coordsMark(frame: Frame, entry: EditorialEntry, ink = INK): BookElement | null {
  if (entry.lat == null || entry.lng == null) return null
  return badge(frame, 'coords', { text: formatBookCoords(entry.lat, entry.lng) }, { color: ink })
}

/** The "DAY 5" chip. Small, solid, and the only filled shape on most pages. */
function dayChip(frame: Frame, day: number | null | undefined, label: string, chip = INK): BookElement | null {
  if (!day) return null
  return badge(frame, 'day', { text: `${label} ${day}`.trim() }, { style: 'chip', accent: chip })
}

/** A rule along the foot with a dot showing how far into the journey this is. */
function progressRule(x: number, y: number, w: number, day: number | null | undefined, total: number | null | undefined): BookElement[] {
  if (!day || !total || total < 2) return []
  const t = Math.min(1, Math.max(0, (day - 1) / (total - 1)))
  const dot = 2.2
  return [
    shape({ x, y, w, h: 0.3 }, '#cfc9bd'),
    shape({ x: x + w * t - dot / 2, y: y - dot / 2 + 0.15, w: dot, h: dot }, ACCENT, { shape: 'ellipse' }),
  ]
}

/**
 * The country's outline, printed pale behind everything else. Element
 * opacity on top of the outline's own 0.2 — so it sits under the type on any
 * paper colour.
 */
function countryWatermark(frame: Frame, code: string | null | undefined, ink = INK): BookElement | null {
  if (!code) return null
  return countries(frame, [code.toUpperCase()], [''], { layout: 'column', showOutline: true, showFlag: false, showName: false, align: 'center', accent: ink, opacity: 0.55 })
}

/** The country whole, small, with its flag — the fork's stand-in for upstream's live place map. */
function placeOutline(frame: Frame, entry: EditorialEntry): BookElement | null {
  if (!entry.country) return null
  return countries(frame, [entry.country.toUpperCase()], [''], { layout: 'column', showOutline: true, showFlag: false, showName: false, align: 'center', accent: ACCENT })
}

/** The day of the month as a numeral with its month beneath. */
function dateMark(iso: string | null, locale: string, frame: Frame): BookElement | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return badge(frame, 'date', {
    text: String(d.getDate()),
    sub: d.toLocaleDateString(locale, { month: 'long' }).toUpperCase(),
  }, { style: 'stacked', accent: INK })
}

function bleedFrame(page: BookPageSetup, spread: boolean): Frame {
  const w = spread ? page.pageWidth * 2 : page.pageWidth
  return { x: -page.bleed, y: -page.bleed, w: w + page.bleed * 2, h: page.pageHeight + page.bleed * 2 }
}

/** A whole page laid in colour, bleeding off its three outer edges. */
function pagePanel(page: BookPageSetup, side: 'left' | 'right', fill: string): BookElement {
  const b = page.bleed
  return shape({ x: side === 'left' ? -b : page.pageWidth, y: -b, w: page.pageWidth + b, h: page.pageHeight + b * 2 }, fill)
}

/** A band down the outer edge — the cheapest mark that says "designed". */
function edgeBand(page: BookPageSetup, side: 'left' | 'right', fill: string, width = 8): BookElement {
  const b = page.bleed
  return shape({ x: side === 'left' ? -b : page.pageWidth * 2 - width, y: -b, w: width + b, h: page.pageHeight + b * 2 }, fill)
}

/** A box ruled around something, with nothing inside it. */
function ruleBox(frame: Frame, colour: string, radius = 0): BookElement {
  return shape(frame, null, { stroke: colour, strokeWidth: 0.3, radius })
}

type Hand = 'left' | 'right'

interface Ctx {
  entry: EditorialEntry
  input: EditorialInput
  hand: Hand
  /** Page margin, scaled to the trim so a small book is not all margin. */
  m: number
}

/** The heading block: rule, date line, title. Returns where it ended. */
function headingBlock(els: BookElement[], ctx: Ctx, x: number, y: number, w: number, opts: { size?: number; ink?: string; muted?: string } = {}): number {
  const { entry, input } = ctx
  const size = opts.size ?? 22
  const ink = opts.ink ?? '#141414'
  const muted = opts.muted ?? '#8a8578'
  const heading = entry.title || entry.location || ''
  const meta = [formatBookDate(entry.date, input.locale), entry.title ? entry.location : null].filter(Boolean).join('  ·  ')
  let cy = y
  if (meta || heading) els.push(shape({ x, y: cy - 6, w: Math.min(14, w * 0.18), h: 0.5 }, ACCENT))
  if (meta) {
    els.push(text({ x, y: cy, w, h: 5 }, meta.toUpperCase(), { size: 7.5, weight: 600, tracking: 0.14, color: muted }))
    cy += 8
  }
  if (heading) {
    els.push(bound({ x, y: cy, w, h: size * 0.6 }, heading,
      entry.title ? { source: 'entry.title', entryId: entry.id } : { source: 'entry.location', entryId: entry.id },
      { size, weight: 700, leading: 1.1, tracking: -0.02, color: ink }))
    cy += size * 0.75
  }
  return cy
}

/** The foot: the day chip above the dot on the rule that says how far in this is. */
function footMarks(els: BookElement[], ctx: Ctx, x: number, w: number, y: number, chipColour = INK) {
  const { entry, input } = ctx
  els.push(...progressRule(x, y, w, entry.dayNumber, entry.dayCount))
  const day = entry.dayNumber
  const total = entry.dayCount
  if (!day) return
  const t = total && total > 1 ? Math.min(1, Math.max(0, (day - 1) / (total - 1))) : 0
  const cw = 24
  const cx = Math.min(x + w - cw, Math.max(x, x + w * t - cw / 2))
  const chip = dayChip({ x: cx, y: y - 11, w: cw, h: 7 }, day, (input.dayLabel ?? 'DAY').toUpperCase(), chipColour)
  if (chip) els.push(chip)
}

function storyText(els: BookElement[], entry: EditorialEntry, frame: Frame, opts: Partial<BookTextElement>) {
  const story = (entry.story || '').trim()
  if (!story) return
  els.push(bound(frame, story, { source: 'entry.story', entryId: entry.id }, { size: 10, leading: 1.62, color: '#2a2a2a', ...opts }))
}

function sheet(els: BookElement[], entry: EditorialEntry, background: string): BookSpread {
  return { id: elementId('sp'), role: 'inner', background, elements: els, parked: [], entryId: entry.id }
}

// ── the seven designs ───────────────────────────────────────────────────────

/** A stop with nothing written about it: the country pale behind, the name large, the picture page waiting. */
function placeSpread(ctx: Ctx): BookSpread {
  const { entry, input, hand, m } = ctx
  const { page } = input
  const H = page.pageHeight
  const els: BookElement[] = []
  const photoPage = hand === 'left' ? 0 : page.pageWidth
  const tx = (hand === 'left' ? page.pageWidth : 0) + m
  const colW = page.pageWidth - m * 2

  const wm = countryWatermark({ x: tx, y: H * 0.18, w: colW, h: H * 0.5 }, entry.country)
  if (wm) els.push(wm)
  const flag = flagRow({ x: tx, y: m + 2, w: colW, h: 8 }, entry, input)
  if (flag) els.push(flag)

  const name = entry.title || entry.location || ''
  if (name) {
    els.push(bound({ x: tx, y: H * 0.42, w: colW, h: 20 }, name,
      entry.title ? { source: 'entry.title', entryId: entry.id } : { source: 'entry.location', entryId: entry.id },
      { size: 26, weight: 700, tracking: -0.02, leading: 1.1, color: '#141414' }))
  }
  const coords = coordsMark({ x: tx, y: H * 0.42 + 22, w: colW * 0.8, h: 9 }, entry)
  if (coords) els.push(coords)
  const mark = dateMark(entry.date, input.locale, { x: tx, y: H - m - 40, w: 26, h: 22 })
  if (mark) els.push(mark)
  footMarks(els, ctx, tx, colW, H - m - 4)

  const first = entry.photos[0]
  els.push(photo({ x: photoPage + m, y: m, w: page.pageWidth - m * 2, h: H - m * 2 }, first ? first.photoId : null))
  return sheet(els, entry, CREAM)
}

/** Words on one page, one picture on the other, off three edges and flush to the fold. */
function storySpread(ctx: Ctx): BookSpread {
  const { entry, input, hand, m } = ctx
  const { page } = input
  const H = page.pageHeight
  const els: BookElement[] = []
  const hero = entry.photos[0]
  const onLeft = hand === 'left'
  const tx = (onLeft ? page.pageWidth : 0) + m
  const colW = page.pageWidth - m * 2

  if (hero) {
    els.push(photo({ x: onLeft ? -page.bleed : page.pageWidth, y: -page.bleed, w: page.pageWidth + page.bleed, h: H + page.bleed * 2 },
      hero.photoId, { focalX: isPortrait(hero) ? 0.5 : 0.55 }))
    if (hero.caption) {
      els.push(bound({ x: (onLeft ? 0 : page.pageWidth) + m, y: H - m - 6, w: page.pageWidth * 0.6, h: 5 }, hero.caption,
        { source: 'photo.caption', entryId: entry.id, photoId: hero.photoId },
        { size: 7.5, weight: 500, color: '#ffffff', opacity: 0.9 }))
    }
  } else {
    els.push(photo({ x: (onLeft ? 0 : page.pageWidth) + m, y: m, w: page.pageWidth - m * 2, h: H - m * 2 }, null))
  }

  const outline = placeOutline({ x: tx, y: m, w: 26, h: 20 }, entry)
  if (outline) els.push(outline)
  const flag = flagRow({ x: tx + (outline ? 30 : 0), y: m + 6, w: colW - (outline ? 30 : 0), h: 8 }, entry, input)
  if (flag) els.push(flag)

  const cy = headingBlock(els, ctx, tx, m + 34, colW, { size: 20 })
  storyText(els, entry, { x: tx, y: cy + 3, w: colW, h: Math.max(18, H - cy - m - 44) }, {})
  const mark = dateMark(entry.date, input.locale, { x: tx, y: H - m - 36, w: 26, h: 20 })
  if (mark) els.push(mark)
  footMarks(els, ctx, tx + 30, colW - 30, H - m - 4)
  return sheet(els, entry, '#ffffff')
}

/** A panorama across the fold, with the day underneath it. */
function panoSpread(ctx: Ctx): BookSpread {
  const { entry, input, m } = ctx
  const { page } = input
  const W = page.pageWidth * 2
  const H = page.pageHeight
  const gut = 6
  const els: BookElement[] = []
  const [hero, ...rest] = entry.photos

  els.push(photo({ x: -page.bleed, y: -page.bleed, w: W + page.bleed * 2, h: H * 0.58 + page.bleed }, hero ? hero.photoId : null))
  const cy = headingBlock(els, ctx, m, H * 0.58 + 16, page.pageWidth - m * 2, { size: 18 })
  storyText(els, entry, { x: m, y: cy + 2, w: page.pageWidth - m * 2, h: Math.max(14, H - cy - m - 12) }, { leading: 1.6 })

  // Stacked up from the foot — rule, chip, flag, then the strip — so none of
  // them lands on another (upstream's fixed heights overlapped all three).
  const footY = H - m - 4
  const flagY = footY - 11 - 10
  const stripY = H * 0.58 + 16
  const stripH = Math.min(H * 0.24, flagY - 4 - stripY)
  const strip = rest.slice(0, 3)
  if (strip.length && stripH > 8) {
    const cw = (page.pageWidth - m * 2 - gut * (strip.length - 1)) / strip.length
    strip.forEach((p, i) => els.push(photo({ x: page.pageWidth + m + i * (cw + gut), y: stripY, w: cw, h: stripH }, p.photoId)))
  }
  const flag = flagRow({ x: page.pageWidth + m, y: flagY, w: page.pageWidth - m * 2, h: 7 }, entry, input)
  if (flag) els.push(flag)
  footMarks(els, ctx, page.pageWidth + m, page.pageWidth - m * 2, H - m - 4)
  return sheet(els, entry, '#ffffff')
}

/** Several pictures: one large across a page, the rest ruled beneath the text. */
function gallerySpread(ctx: Ctx): BookSpread {
  const { entry, input, hand, m } = ctx
  const { page } = input
  const H = page.pageHeight
  const gut = 5
  const els: BookElement[] = []
  const [hero, ...rest] = entry.photos
  const heroOnLeft = hand === 'left'
  const textX = (heroOnLeft ? page.pageWidth : 0) + m
  const colW = page.pageWidth - m * 2

  els.push(photo({ x: heroOnLeft ? -page.bleed : page.pageWidth, y: -page.bleed, w: page.pageWidth + page.bleed, h: H + page.bleed * 2 },
    hero ? hero.photoId : null, { focalX: hero && isPortrait(hero) ? 0.5 : 0.55 }))

  const flag = flagRow({ x: textX, y: m + 2, w: colW, h: 8 }, entry, input)
  if (flag) els.push(flag)
  const cy = headingBlock(els, ctx, textX, m + (flag ? 26 : 16), colW, { size: 19 })

  const strip = rest.slice(0, 3)
  const stripH = strip.length ? (strip.length === 1 ? H * 0.28 : H * 0.22) : 0
  const footRoom = 22
  storyText(els, entry, { x: textX, y: cy + 2, w: colW, h: Math.max(18, H - cy - m - (stripH ? stripH + 12 : 0) - footRoom) }, {})
  if (strip.length) {
    const cw = (colW - gut * (strip.length - 1)) / strip.length
    strip.forEach((p, i) => els.push(photo({ x: textX + i * (cw + gut), y: H - m - footRoom - stripH, w: cw, h: stripH }, p.photoId)))
  }
  footMarks(els, ctx, textX, colW, H - m - 4)
  return sheet(els, entry, '#ffffff')
}

/** One picture over the whole sheet, the words set on top of it under a fading scrim. */
function immersiveSpread(ctx: Ctx): BookSpread {
  const { entry, input } = ctx
  const { page } = input
  const W = page.pageWidth * 2
  const H = page.pageHeight
  const m = ctx.m + 2
  const els: BookElement[] = []
  const hero = entry.photos[0]

  els.push(photo(bleedFrame(page, true), hero ? hero.photoId : null, { focalY: 0.45 }))
  els.push(shape({ x: -page.bleed, y: H * 0.56, w: W + page.bleed * 2, h: H * 0.44 + page.bleed }, '#0d0d0f', { gradient: 'up', opacity: 0.72 }))
  headingBlock(els, ctx, m, H * 0.68, page.pageWidth - m * 2, { size: 24, ink: '#ffffff', muted: '#d8d3ca' })
  storyText(els, entry, { x: page.pageWidth + m, y: H * 0.68, w: page.pageWidth - m * 2, h: H * 0.26 }, { size: 9.5, leading: 1.6, color: '#efece6' })
  const coords = coordsMark({ x: m, y: H - m - 9, w: page.pageWidth * 0.6, h: 9 }, entry, '#ffffff')
  if (coords) els.push(coords)
  return sheet(els, entry, '#0d0d0f')
}

/** A page laid in ink, the picture on the other, and a second picture across the join. */
function panelSpread(ctx: Ctx): BookSpread {
  const { entry, input, hand } = ctx
  const { page } = input
  const H = page.pageHeight
  const m = ctx.m + 2
  const els: BookElement[] = []
  const [hero, ...rest] = entry.photos
  const panelSide: Hand = hand === 'left' ? 'right' : 'left'
  const tx = (panelSide === 'left' ? 0 : page.pageWidth) + m
  const colW = page.pageWidth - m * 2

  els.push(pagePanel(page, panelSide, PANEL_INK))
  if (hero) {
    els.push(photo({ x: panelSide === 'left' ? page.pageWidth : -page.bleed, y: -page.bleed, w: page.pageWidth + page.bleed, h: H + page.bleed * 2 },
      hero.photoId, { focalX: isPortrait(hero) ? 0.5 : 0.55 }))
  } else {
    els.push(photo({ x: (panelSide === 'left' ? page.pageWidth : 0) + m, y: m, w: colW, h: H - m * 2 }, null))
  }

  const flag = flagRow({ x: tx, y: m, w: colW, h: 8 }, entry, input, PANEL_TYPE)
  if (flag) els.push(flag)
  const cy = headingBlock(els, ctx, tx, m + 30, colW, { size: 21, ink: PANEL_TYPE, muted: '#a8a094' })
  storyText(els, entry, { x: tx, y: cy + 3, w: colW, h: Math.max(18, H - cy - m - 46) }, { size: 9.5, leading: 1.66, color: '#d9d4cb' })

  // The crossing picture: half on the panel, half off — what makes two pages one sheet.
  const crossing = rest[0]
  if (crossing) {
    const cw = Math.min(62, page.pageWidth * 0.32)
    const ch = cw * 0.74
    els.push(photo({ x: page.pageWidth - cw * 0.55, y: H - m - ch - 14, w: cw, h: ch }, crossing.photoId, { radius: 1 }))
  }
  // An ink chip on an ink page would vanish — the accent reads on both.
  footMarks(els, ctx, tx, colW, H - m - 4, ACCENT)
  return sheet(els, entry, CREAM)
}

/** A band down the edge, a ruled box around the words, and pictures at two sizes. */
function bandSpread(ctx: Ctx): BookSpread {
  const { entry, input, hand } = ctx
  const { page } = input
  const H = page.pageHeight
  const m = ctx.m + 2
  const gut = 5
  const els: BookElement[] = []
  const photos = entry.photos

  els.push(edgeBand(page, hand, ACCENT, 6))
  const heroX = hand === 'left' ? 6 : page.pageWidth
  const heroW = page.pageWidth - 6 + (hand === 'left' ? 0 : page.bleed)
  if (photos[0]) els.push(photo({ x: heroX, y: -page.bleed, w: heroW, h: H * 0.62 + page.bleed }, photos[0].photoId))
  else els.push(photo({ x: heroX + m, y: m, w: heroW - m * 2, h: H * 0.5 }, null))

  const tx = (hand === 'left' ? page.pageWidth : 0) + m
  const colW = page.pageWidth - m * 2
  const boxY = m + 6
  const boxH = H * 0.52
  els.push(ruleBox({ x: tx, y: boxY, w: colW, h: boxH }, '#d8d2c6', 1.5))
  const flag = flagRow({ x: tx + 8, y: boxY + 8, w: colW - 16, h: 7 }, entry, input)
  if (flag) els.push(flag)
  const cy = headingBlock(els, ctx, tx + 8, boxY + 30, colW - 16, { size: 18 })
  storyText(els, entry, { x: tx + 8, y: cy + 2, w: colW - 16, h: Math.max(10, boxY + boxH - cy - 12) }, { size: 9.5, leading: 1.6 })

  // The strip stops above the foot, where the day chip and the rule go —
  // upstream's fixed H * 0.2 ran the photos into both.
  const rest = photos.slice(1, 3)
  const stripY = boxY + boxH + 10
  const stripH = Math.min(H * 0.2, H - m - 4 - 15 - stripY)
  if (rest.length && stripH > 8) {
    const cw = (colW - gut * (rest.length - 1)) / rest.length
    rest.forEach((ph, i) => els.push(photo({ x: tx + i * (cw + gut), y: stripY, w: cw, h: stripH }, ph.photoId, { radius: 1 })))
  }
  const overlap = photos[3]
  if (overlap) els.push(photo({ x: heroX + 14, y: H * 0.62 - 26, w: 52, h: 40 }, overlap.photoId, { radius: 1 }))

  const mark = dateMark(entry.date, input.locale, { x: heroX + 14, y: H - m - 34, w: 26, h: 22 })
  if (mark) els.push(mark)
  footMarks(els, ctx, tx, colW, H - m - 4)
  return sheet(els, entry, '#ffffff')
}

const BUILDERS: Record<EditorialDesign, (ctx: Ctx) => BookSpread> = {
  place: placeSpread, story: storySpread, pano: panoSpread, gallery: gallerySpread,
  immersive: immersiveSpread, panel: panelSpread, band: bandSpread,
}

/**
 * Which design suits an entry when nobody picked one: by what it has first —
 * a panorama wants the fold, a stop with nothing said about it wants the
 * place page — then by position, so neighbours with the same contents come
 * out differently. The full-bleed page is kept to every sixth and never the
 * first: a book of loud pages has no loud page.
 */
export function pickEditorialDesign(entry: EditorialEntry, index: number): EditorialDesign {
  const photos = entry.photos
  const story = (entry.story || '').trim()
  if (photos.length === 0 && !story) return 'place'
  if (photos.length > 0 && isPano(photos[0])) return 'pano'
  switch (index % 6) {
    case 0: return photos.length > 1 ? 'gallery' : 'story'
    case 1: return 'panel'
    case 2: return photos.length > 2 ? 'band' : 'story'
    case 3: return photos.length ? 'immersive' : 'panel'
    case 4: return photos.length > 1 ? 'band' : 'panel'
    default: return photos.length > 1 ? 'gallery' : 'story'
  }
}

/**
 * One editorial spread for one entry. `design` forces a layout (the
 * per-spread picker); omitted, `pickEditorialDesign` chooses. The hand —
 * which page the picture is on — alternates with `index`.
 */
export function editorialSpread(entry: EditorialEntry, input: EditorialInput, index = 0, design?: EditorialDesign): BookSpread {
  const photos = entry.photos.slice(0, 5)
  const e = { ...entry, photos }
  const hand: Hand = index % 2 === 0 ? 'left' : 'right'
  const m = Math.max(12, Math.min(18, input.page.pageWidth * 0.085))
  return BUILDERS[design ?? pickEditorialDesign(e, index)]({ entry: e, input, hand, m })
}

/**
 * Day number and count for each dated entry: day 1 is the earliest date in
 * the journey, the count runs to the latest, so a rest day in between still
 * moves the dot along the rule.
 */
export function journeyDays(dates: (string | null)[]): { dayOf: (date: string | null) => number | null; count: number | null } {
  const ms = dates.filter((d): d is string => !!d).map(d => Date.parse(`${d}T00:00:00Z`)).filter(n => Number.isFinite(n))
  if (!ms.length) return { dayOf: () => null, count: null }
  const first = Math.min(...ms)
  const last = Math.max(...ms)
  const DAY = 86_400_000
  return {
    count: Math.round((last - first) / DAY) + 1,
    dayOf: d => {
      if (!d) return null
      const t = Date.parse(`${d}T00:00:00Z`)
      return Number.isFinite(t) ? Math.round((t - first) / DAY) + 1 : null
    },
  }
}

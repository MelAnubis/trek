import type { BookColorToken, BookElement, BookFrame, BookPageSetup, BookPaint, BookShapeElement, BookTextElement, BookTheme } from '../../../types/book'
import { BOOK_SHAPES } from '../../../types/book'
import { contrastRatio, requiredContrast } from '../bookColour'
import { withShapePaint } from '../bookPaint'
import { bookThemeColor } from '../bookTheme'
import { ptToMm } from '../text/textMeasure'
import type { BookDecoratedTemplate, BookTemplateElement, BookTemplatePhotoRole, BookTemplateRole, BookTemplateTint } from './templateFormat'

/*
 * A template's fractions turned into millimetres on a page, its tints into
 * the theme's colours, and the few kinds drawn in upstream's shape (a date
 * mark, a map) turned into Trek's. Ported from liketrek/TREK's
 * template-lay.ts (AGPLv3).
 */

const r2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function templatePage(page: BookPageSetup, across: 1 | 2) {
  return { pw: page.pageWidth, ph: page.pageHeight, unit: Math.min(page.pageWidth, page.pageHeight), bleed: page.bleed, across }
}
export type TemplatePage = ReturnType<typeof templatePage>

/** Whether an element keeps its proportions when the page is not the shape it was drawn on. */
export function keepsProportions(el: Pick<BookTemplateElement, 'keep' | 'rotation' | 'kind'>): boolean {
  return el.keep === true || el.rotation % 360 !== 0 || el.kind === 'sticker'
}

/** One axis in millimetres; an edge at or past the trim lands on this page's bleed. */
function axis(start: number, size: number, scale: number, pages: number, bleed: number): [number, number] {
  const end = start + size
  const from = start <= 0 ? -bleed : start * scale
  const to = end >= pages ? pages * scale + bleed : end * scale
  return [from, Math.max(0.5, to - from)]
}

export function templateFrame(el: BookTemplateElement, at: TemplatePage): BookFrame {
  const f = el.frame
  if (keepsProportions(el)) {
    const w = f.w * at.unit
    const h = f.h * at.unit
    const cx = (f.x + f.w / 2) * at.pw
    const cy = (f.y + f.h / 2) * at.ph
    return { x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h) }
  }
  const [x, w] = axis(f.x, f.w, at.pw, at.across, at.bleed)
  const [y, h] = axis(f.y, f.h, at.ph, 1, at.bleed)
  return { x: r2(x), y: r2(y), w: r2(w), h: r2(h) }
}

const len = (v: number, at: TemplatePage) => r2(v * at.unit)
const reach = (v: number, at: TemplatePage) => clamp(len(v, at), -30, 30)

type Loose = Record<string, unknown>

/** The smallest a template's type is set at: running text 7 pt, a line 6 pt. */
const TYPE_FLOOR = { body: 7, line: 6 } as const

function scaleText(el: Loose, at: TemplatePage, role: string | undefined): void {
  const floor = role === 'body' ? TYPE_FLOOR.body : TYPE_FLOOR.line
  const sized = (v: number) => clamp(Math.max(len(v, at), floor), 4, 400)
  if (typeof el.size === 'number') el.size = sized(el.size)
  if (typeof el.fitMax === 'number') el.fitMax = sized(el.fitMax)
  const outline = el.outline as { width: number } | null | undefined
  if (outline) el.outline = { ...outline, width: clamp(len(outline.width, at), 0.05, 6) }
  const shadow = el.shadow as { dx: number; dy: number } | null | undefined
  if (shadow) el.shadow = { ...shadow, dx: reach(shadow.dx, at), dy: reach(shadow.dy, at) }
  const band = el.highlight as { padX: number; padY: number; radius: number } | null | undefined
  if (band) el.highlight = { ...band, padX: clamp(len(band.padX, at), 0, 20), padY: clamp(len(band.padY, at), 0, 20), radius: clamp(len(band.radius, at), 0, 20) }
}

function scalePhoto(el: Loose, at: TemplatePage): void {
  for (const key of ['border', 'cutout'] as const) {
    const edge = el[key] as { width: number } | null | undefined
    if (edge) el[key] = { ...edge, width: clamp(len(edge.width, at), 0.1, 30) }
  }
  const shadow = el.shadow as { dx: number; dy: number } | null | undefined
  if (shadow) el.shadow = { ...shadow, dx: reach(shadow.dx, at), dy: reach(shadow.dy, at) }
}

function scaleLengths(el: Loose, at: TemplatePage, role: string | undefined): void {
  if (typeof el.radius === 'number') el.radius = Math.max(0, len(el.radius, at))
  if (typeof el.strokeWidth === 'number') {
    el.strokeWidth = el.kind === 'line' ? clamp(len(el.strokeWidth, at), 0.05, 20) : Math.max(0, len(el.strokeWidth, at))
  }
  if (typeof el.edgeSize === 'number') el.edgeSize = clamp(len(el.edgeSize, at), 0.5, 30)
  if (el.kind === 'text') scaleText(el, at, role)
  if (el.kind === 'photo') scalePhoto(el, at)
}

// ── Tints ────────────────────────────────────────────────────────────────

type Colour = (token: BookColorToken) => string

function tinted<T extends { color: string }>(value: T | null | undefined, token: BookColorToken | undefined, colour: Colour) {
  return value && token ? { ...value, color: colour(token) } : value
}

export function tintedPaint(paint: BookPaint, tint: BookTemplateTint, colour: Colour): BookPaint {
  if (paint.type === 'pattern') {
    return { ...paint, ...(tint.fg ? { fg: colour(tint.fg) } : {}), ...(tint.bg && paint.bg !== null ? { bg: colour(tint.bg) } : {}) }
  }
  if (paint.type === 'solid') return tint.fill ? { ...paint, color: colour(tint.fill) } : paint
  const stops = tint.stops
  if (!stops) return paint
  return { ...paint, stops: paint.stops.map((s, i) => { const t = stops[i]; return t ? { ...s, color: colour(t) } : s }) }
}

function applyTint(el: Loose, tint: BookTemplateTint, theme: BookTheme): void {
  const colour: Colour = t => bookThemeColor(theme, t)
  const c = (k: string) => el[k] as { color: string } | null | undefined
  if (el.kind === 'photo') {
    el.border = tinted(c('border'), tint.border, colour)
    el.shadow = tinted(c('shadow'), tint.shadow, colour)
    el.cutout = tinted(c('cutout'), tint.cutout, colour)
  } else if (el.kind === 'text') {
    el.outline = tinted(c('outline'), tint.outline, colour)
    el.shadow = tinted(c('shadow'), tint.shadow, colour)
    el.highlight = tinted(c('highlight'), tint.highlight, colour)
    const fill = el.fillPaint as { type: string; color?: string } | null | undefined
    if (fill?.type === 'solid' && tint.fill) el.fillPaint = { ...fill, color: colour(tint.fill) }
  } else if (el.kind === 'sticker' && tint.colors) {
    const drawn = (el.colors as string[] | undefined) ?? []
    el.colors = drawn.map((col, i) => { const t = tint.colors?.[i]; return t ? colour(t) : col })
  } else if (el.kind === 'line' && tint.stroke) el.stroke = colour(tint.stroke)
}

// ── Upstream kinds in Trek's shape ───────────────────────────────────────

const SHAPES: ReadonlySet<string> = new Set(BOOK_SHAPES)

/** A date mark as Trek draws a badge: the numeral, the month beneath it. */
function asBadge(el: Loose): Loose {
  const style = el.style === 'stamp' ? 'outline' : 'plain'
  const keep = ['id', 'kind', 'frame', 'rotation', 'opacity', 'locked', 'group', 'font', 'color', 'accent', 'token', 'accentToken', 'fontRole', 'text', 'sub']
  const out: Loose = Object.fromEntries(keep.filter(k => el[k] !== undefined).map(k => [k, el[k]]))
  return { ...out, variant: 'date', text: (el.text as string) ?? '', sub: (el.sub as string) ?? '', code: null, style }
}

/** A map slot as Trek's map image: drawn from the page's own map when it is poured. */
function asMap(el: Loose): Loose {
  const { id, frame, rotation, opacity, locked, group } = el
  return { id, kind: 'map', frame, rotation, opacity, locked, ...(group ? { group } : {}), src: null, fit: 'cover', radius: 0 }
}

/** Fields Trek's document holds to tighter ranges, kept inside them. */
function inTrekRanges(el: Loose): Loose | null {
  if (el.kind === 'shape' && !SHAPES.has(el.shape as string)) return null
  if (el.kind === 'photo' && el.mask != null && !SHAPES.has(el.mask as string)) el.mask = null
  if (el.kind === 'badge') return asBadge(el)
  if (el.kind === 'map') return asMap(el)
  return el
}

/** The band set behind a text that reads on neither ink nor paper, as a share of the letter height. */
const READING_BAND = { x: 0.6, y: 0.3 } as const

/** Whether a text brings its own ground: a band, a picture or paint in its letters, a heavy outline. */
export function textHasOwnGround(el: BookTextElement): boolean {
  if (el.highlight && el.effect !== 'highlight') return true
  if (el.fillPaint && (el.fillPaint.type !== 'solid' || (el.fillPaint.alpha ?? 1) < 0.5)) return true
  return !!el.outline && el.outline.width >= ptToMm(el.size) * 0.04
}

/**
 * A laid text on the colour `on`, set so it reads there in this theme at its
 * fitted size: its own colour while it reads, else ink or paper, on a band of
 * the other when neither does.
 */
export function readableTextOn(el: BookTextElement, on: BookColorToken, theme: BookTheme): BookTextElement {
  if (textHasOwnGround(el)) return el
  const ground = bookThemeColor(theme, on)
  const need = requiredContrast(el.size)
  if (contrastRatio(el.color, ground) >= need) return el
  const ink = bookThemeColor(theme, 'ink')
  const paper = bookThemeColor(theme, 'paper')
  const pick: BookColorToken = contrastRatio(ink, ground) >= contrastRatio(paper, ground) ? 'ink' : 'paper'
  const color = pick === 'ink' ? ink : paper
  const next: BookTextElement = { ...el, token: pick, color }
  if (el.shadow?.color.toLowerCase() === color.toLowerCase()) next.shadow = { ...el.shadow, color: el.color }
  if (contrastRatio(color, ground) >= need) return next
  const letter = ptToMm(el.size)
  const pad = (share: number) => clamp(r2(letter * share), 0, 20)
  return { ...next, highlight: { color: pick === 'ink' ? paper : ink, alpha: 1, padX: pad(READING_BAND.x), padY: pad(READING_BAND.y), radius: 0 } }
}

/** A laid element, with what the template says about it kept beside it for the pour. */
export interface LaidElement {
  el: BookElement
  role: BookTemplateRole | undefined
  fillPhoto: BookTemplatePhotoRole | undefined
  on: BookColorToken | undefined
}

/** One template element on this page, in millimetres, tinted, its template fields gone; null for one Trek cannot draw. */
export function layTemplateElement(src: BookTemplateElement, at: TemplatePage, theme: BookTheme | null, id: string): LaidElement | null {
  const { role, tint, keep: _keep, fillPhoto, on, ...rest } = src
  const el: Loose = { ...rest, id, frame: templateFrame(src, at) }
  scaleLengths(el, at, role as string | undefined)
  if (tint && theme) applyTint(el, tint, theme)
  const trek = inTrekRanges(el)
  if (!trek) return null
  let out = trek as unknown as BookElement
  if (out.kind === 'shape' && out.paint && tint && theme) {
    out = withShapePaint(out as BookShapeElement, tintedPaint(out.paint, tint, t => bookThemeColor(theme, t)))
  }
  return { el: out, role: role as BookTemplateRole | undefined, fillPhoto: fillPhoto as BookTemplatePhotoRole | undefined, on: out.kind === 'text' ? on : undefined }
}

/** The page's own paint, its tints taken from the theme. */
export function templateBackgroundPaint(tpl: BookDecoratedTemplate, theme: BookTheme | null): BookPaint | undefined {
  const paint = tpl.backgroundPaint
  if (!paint || !theme || !tpl.backgroundTint) return paint
  return tintedPaint(paint, tpl.backgroundTint, t => bookThemeColor(theme, t))
}

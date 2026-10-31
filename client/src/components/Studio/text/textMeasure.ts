import type { BookElement, BookSpread, BookTextElement, BookTextFill, BookPaint } from '../../../types/book'
import { bookTextCurvePath } from './textCurve'

/*
 * How wide letters set and how big a fitted text may be, ported from
 * liketrek/TREK's book-findings.ts (bookLetterMm, textHeightNeeded) and
 * book-text-fit.ts (AGPLv3). The letter widths are upstream's measured
 * average advance per em at 400 and, where measured, at 700; Trek's own three
 * families (merriweather, typewriter, jost) are estimated the same way.
 */

interface Measure { em: number; bold?: number; caps?: true }

const MEASURE: Record<string, Measure> = {
  sans: { em: 0.507, bold: 0.519 }, inter: { em: 0.478, bold: 0.491 }, montserrat: { em: 0.507, bold: 0.536 },
  jost: { em: 0.462, bold: 0.48 },
  serif: { em: 0.469, bold: 0.481 }, garamond: { em: 0.383, bold: 0.424 }, playfair: { em: 0.454, bold: 0.462 },
  merriweather: { em: 0.52, bold: 0.55 },
  fraunces: { em: 0.467, bold: 0.497 }, cormorant: { em: 0.393, bold: 0.398 }, dmserif: { em: 0.448 }, bodoni: { em: 0.463, bold: 0.488 },
  bebas: { em: 0.339, caps: true }, anton: { em: 0.409 }, oswald: { em: 0.365, bold: 0.412 }, league: { em: 0.266 },
  shoulders: { em: 0.304, bold: 0.355 }, archivo: { em: 0.557 },
  display: { em: 0.492, bold: 0.5 }, shrikhand: { em: 0.529 }, alfa: { em: 0.54 }, bricolage: { em: 0.471, bold: 0.49 }, abril: { em: 0.46 },
  caveat: { em: 0.344, bold: 0.349 }, dancing: { em: 0.363, bold: 0.372 }, pacifico: { em: 0.419 }, vibes: { em: 0.284 },
  sacramento: { em: 0.308 }, kaushan: { em: 0.396 }, allura: { em: 0.33 }, parisienne: { em: 0.361 }, satisfy: { em: 0.382 },
  yellowtail: { em: 0.333 }, homemade: { em: 0.561 }, marker: { em: 0.516 },
  typewriter: { em: 0.6 }, mono: { em: 0.613 },
}

/** Whether a family sets every letter as a capital whatever is typed. */
export const isCapsFace = (font: string): boolean => !!MEASURE[font]?.caps

function letterEm(font: string, weight: number): number {
  const m = MEASURE[font]
  const regular = m?.em ?? 0.5
  return weight >= 600 ? (m?.bold ?? regular * 1.06) : regular
}

const CASE_WIDTH: Record<string, number> = { upper: 1.18, smallcaps: 1.08 }
const num = (v: number | undefined, d: number) => (Number.isFinite(v) ? (v as number) : d)
export const ptToMm = (pt: number) => (pt * 25.4) / 72

function upper(el: Pick<BookTextElement, 'transform' | 'uppercase'>): string {
  return el.transform && el.transform !== 'none' ? el.transform : el.uppercase ? 'upper' : 'none'
}

/** The average advance of one letter in millimetres, tracking included. */
export function bookLetterMm(el: BookTextElement, headroom = 1): number {
  const sizeMm = ptToMm(num(el.size, 11))
  const caps = isCapsFace(el.font) ? 1 : (CASE_WIDTH[upper(el)] ?? 1)
  return sizeMm * (letterEm(el.font, el.weight) * caps * headroom + num(el.tracking, 0))
}

function wrappedLines(para: string, perLine: number): number {
  let lines = 1
  let used = 0
  for (const word of para.split(' ')) {
    if (used > 0 && used + 1 + word.length <= perLine) { used += 1 + word.length; continue }
    if (used > 0) lines += 1
    lines += Math.max(0, Math.ceil(word.length / perLine) - 1)
    used = word.length % perLine || Math.min(word.length, perLine)
  }
  return lines
}

/** Roughly how many millimetres of height a text needs at its frame's width. */
export function textHeightNeeded(el: BookTextElement, headroom = 1): number {
  const letter = bookLetterMm(el, headroom)
  const perLine = Math.max(1, Math.floor(el.frame.w / Math.max(letter, 0.1)))
  const lines = el.text.split('\n').reduce((sum, p) => sum + wrappedLines(p.trimEnd(), perLine), 0)
  return lines * ptToMm(num(el.size, 11)) * num(el.leading, 1.45)
}

/** A gradient or pattern in the letters, else null. */
export function bookTextPaintFill(el: { fillPaint?: BookTextFill | null }): BookPaint | null {
  const f = el.fillPaint
  return f && (f.type === 'linear' || f.type === 'radial' || f.type === 'pattern') ? f : null
}

/** Whether a text is drawn as SVG: on a curve, or with a photo, gradient or pattern in its letters. */
export function bookTextIsDrawn(el: Pick<BookTextElement, 'curve' | 'fillPaint'>): boolean {
  return !!el.curve || el.fillPaint?.type === 'photo' || !!bookTextPaintFill(el)
}

/** The words as they are cased on the page. */
export function bookCasedText(el: Pick<BookTextElement, 'text' | 'transform' | 'uppercase'>): string {
  const t = upper(el)
  if (t === 'upper') return el.text.toUpperCase()
  if (t === 'lower') return el.text.toLowerCase()
  return el.text
}

/** The lines of a text drawn as written; a curved text's joined into one. */
export function bookDrawnLines(el: Pick<BookTextElement, 'text' | 'transform' | 'uppercase' | 'curve'>): string[] {
  const lines = bookCasedText(el).split('\n').map(l => l.trimEnd())
  return el.curve ? [lines.filter(Boolean).join(' ')] : lines
}

const MIN_SIZE = 4
const FIT_HEADROOM = 1.08

/** Whether a text at its size holds its frame, with the fit's headroom. */
export function bookTextFits(el: BookTextElement): boolean {
  if (!el.text.trim()) return true
  const letter = bookLetterMm(el, FIT_HEADROOM)
  const run = (s: string) => [...s].length * letter
  if (bookTextIsDrawn(el)) {
    const lines = bookDrawnLines(el)
    const widest = Math.max(0, ...lines.map(run))
    if (el.curve) return widest <= bookTextCurvePath(el.curve, el.frame.w, el.frame.h, ptToMm(el.size)).length * 0.98
    return widest <= el.frame.w && lines.length * ptToMm(el.size) * el.leading <= el.frame.h * 1.02
  }
  const longest = Math.max(0, ...bookCasedText(el).split(/\s+/).map(run))
  return longest <= el.frame.w && textHeightNeeded(el, FIT_HEADROOM) <= el.frame.h * 1.02
}

/** The size a fitted text is set at: its ceiling when that holds, else the largest quarter point that does. */
export function solveBookTextFit(el: BookTextElement, ceiling: number = el.fitMax ?? el.size): number {
  const top = Math.max(MIN_SIZE, ceiling)
  if (bookTextFits({ ...el, size: top })) return top
  let lo = MIN_SIZE * 4
  let hi = Math.floor(top * 4) - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (bookTextFits({ ...el, size: mid / 4 })) lo = mid
    else hi = mid - 1
  }
  return lo / 4
}

function fitted(el: BookElement, before: BookElement | undefined): BookElement {
  if (el.kind !== 'text' || el.fit !== 'shrink') return el
  const chose = before?.kind === 'text' && before.size !== el.size
  const ceiling = chose || el.fitMax === undefined ? el.size : el.fitMax
  const size = solveBookTextFit(el, ceiling)
  return size === el.size && ceiling === el.fitMax ? el : { ...el, size, fitMax: ceiling }
}

/**
 * Every fitted text of a spread at its solved size. `before` tells a size
 * somebody chose (a new ceiling) from one the solver set. Same spread back
 * when nothing moved.
 */
export function fitSpreadTexts(spread: BookSpread, before?: BookSpread): BookSpread {
  const prior = new Map((before?.elements ?? []).map(e => [e.id, e]))
  let changed = false
  const elements = spread.elements.map(el => {
    const next = fitted(el, prior.get(el.id))
    if (next !== el) changed = true
    return next
  })
  return changed ? { ...spread, elements } : spread
}

/** `fitSpreadTexts` over the spreads an edit changed, against the document before it. Same document when nothing moved. */
export function fitBookTexts<D extends { spreads: BookSpread[] }>(next: D, before: D | null): D {
  const prior = new Map((before?.spreads ?? []).map(s => [s.id, s]))
  let changed = false
  const spreads = next.spreads.map(sp => {
    const was = prior.get(sp.id)
    if (was === sp) return sp
    const out = fitSpreadTexts(sp, was)
    if (out !== sp) changed = true
    return out
  })
  return changed ? { ...next, spreads } : next
}

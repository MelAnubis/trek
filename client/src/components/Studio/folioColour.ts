import type { BookElement, BookSpread } from '../../types/book'

/**
 * What colour a page number has to be to be readable. Ported from
 * liketrek/TREK's client/src/components/Studio/folioColour.ts (AGPLv3).
 *
 * A book has dark pages and light ones, often on the same spread, so one
 * fixed folio colour is wrong on half of them: the warm grey that reads on
 * paper vanishes into a full-bleed night photograph. This looks at what is
 * actually under the number — topmost first — and picks dark or light ink.
 */

const DARK_INK = '#3f3a33'
const LIGHT_INK = '#ffffff'

export interface FolioInk {
  color: string
  /** Only over a picture: white on an unknown photo is a coin toss on the pale ones, and a hairline of shadow settles it. */
  shadow?: string
}

/** Perceived brightness, 0 (black) to 1 (white). Anything unparseable counts as white paper. */
export function brightness(hex: string): number {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const n = Number.parseInt(full.slice(0, 6), 16)
  if (!/^[0-9a-fA-F]{6}/.test(full) || !Number.isFinite(n)) return 1
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255
}

function covers(el: BookElement, x: number, y: number): boolean {
  const f = el.frame
  return x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h
}

export function folioInk(spread: BookSpread, x: number, y: number): FolioInk {
  for (let i = spread.elements.length - 1; i >= 0; i--) {
    const el = spread.elements[i]
    if (el.opacity < 0.35 || !covers(el, x, y)) continue

    // A photo, or a baked-in map/elevation image: assume a picture.
    if (el.kind === 'photo' || el.kind === 'image') {
      return { color: LIGHT_INK, shadow: '0 0.3mm 0.6mm rgba(0,0,0,0.45)' }
    }
    if (el.kind === 'shape') {
      // An unfilled shape isn't what's under the number — keep looking.
      if (!el.fill || el.fill === 'transparent') continue
      return { color: brightness(el.fill) > 0.55 ? DARK_INK : LIGHT_INK }
    }
    // Text and the travel elements draw on nothing; the page beneath decides.
  }

  const paper = spread.background ?? '#ffffff'
  return { color: brightness(paper) > 0.55 ? DARK_INK : LIGHT_INK }
}

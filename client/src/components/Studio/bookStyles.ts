import type { CSSProperties } from 'react'
import type { BookPhotoElement, BookTextElement } from '../../types/book'

/**
 * The Studio's style catalogue — photo filters, photo frames, text effects,
 * quick text styles and colour palettes — in one place, so the renderer
 * (SpreadView, which is also the print renderer) and the inspector's pickers
 * can never disagree about what a style is.
 *
 * Everything here is plain CSS a print engine reproduces: CSS filters,
 * borders, box/text shadows and gradients. No canvas, no blend modes that
 * Chrome's PDF output drops.
 */

// ── Photo filters ────────────────────────────────────────────────────────────

export type PhotoFilter = BookPhotoElement['filter']

export const PHOTO_FILTERS: { id: PhotoFilter; css: string | undefined }[] = [
  { id: 'none', css: undefined },
  { id: 'bw', css: 'grayscale(1) contrast(1.05)' },
  { id: 'noir', css: 'grayscale(1) contrast(1.45) brightness(0.92)' },
  { id: 'sepia', css: 'sepia(0.75) contrast(1.02) brightness(1.02)' },
  { id: 'vintage', css: 'sepia(0.35) saturate(0.85) contrast(0.92) brightness(1.06) hue-rotate(-6deg)' },
  { id: 'warm', css: 'saturate(1.1) sepia(0.16)' },
  { id: 'golden', css: 'sepia(0.28) saturate(1.35) brightness(1.06) hue-rotate(-10deg)' },
  { id: 'cool', css: 'saturate(1.05) hue-rotate(-8deg) brightness(1.02)' },
  { id: 'vivid', css: 'saturate(1.45) contrast(1.08)' },
  { id: 'dramatic', css: 'contrast(1.35) saturate(1.15) brightness(0.94)' },
  { id: 'contrast', css: 'contrast(1.22) saturate(1.06)' },
  { id: 'fade', css: 'saturate(0.72) contrast(0.88) brightness(1.08)' },
  { id: 'matte', css: 'contrast(0.82) brightness(1.1) saturate(0.9)' },
]

const FILTER_CSS = new Map(PHOTO_FILTERS.map(f => [f.id, f.css]))
export function filterCss(id: string | undefined): string | undefined {
  return FILTER_CSS.get(id as PhotoFilter)
}

// ── Photo frames ─────────────────────────────────────────────────────────────

export type PhotoFrame = BookPhotoElement['frameStyle']

/**
 * How a frame dresses a photo. `pad`/`bottom` are fractions of the photo's
 * shorter side (so a frame scales with the picture), the rest is styling for
 * the outer box (`outer`) and the picture box inside it (`inner`).
 */
export interface FrameSpec {
  pad: number
  bottom: number
  outer?: (side: number) => CSSProperties
  inner?: (side: number) => CSSProperties
  /** Extra decoration drawn over the picture (tape strips, photo corners). */
  overlay?: 'tape' | 'corners' | 'vignette'
}

const mm = (n: number) => `${Math.round(n * 100) / 100}mm`

export const PHOTO_FRAMES: Record<PhotoFrame, FrameSpec> = {
  none: { pad: 0, bottom: 0 },
  white: { pad: 0.035, bottom: 0.035, outer: () => ({ background: '#ffffff' }) },
  polaroid: {
    pad: 0.055, bottom: 0.17,
    outer: () => ({ background: '#ffffff', boxShadow: '0 1.2mm 3mm rgba(0,0,0,.22)' }),
  },
  shadow: { pad: 0, bottom: 0, outer: () => ({ boxShadow: '0 1.2mm 3mm rgba(0,0,0,.22)' }) },
  film: { pad: 0.075, bottom: 0.075, outer: () => ({ background: '#141414' }) },
  thin: { pad: 0, bottom: 0, outer: side => ({ outline: `${mm(Math.max(0.25, side * 0.004))} solid #1a1a1a`, outlineOffset: mm(Math.max(0.6, side * 0.012)) }) },
  double: {
    pad: 0.03, bottom: 0.03,
    outer: side => ({ background: '#ffffff', border: `${mm(Math.max(0.3, side * 0.005))} solid #1a1a1a`, boxSizing: 'border-box' }),
    inner: side => ({ outline: `${mm(Math.max(0.2, side * 0.003))} solid #1a1a1a`, outlineOffset: mm(-Math.max(0.8, side * 0.012)) }),
  },
  // A postage stamp: white margin with a perforated edge. Two mask layers,
  // added together: a tile of round holes over the whole box, and a solid
  // layer clipped to the content box. The content box (inside a padding as
  // deep as a hole) stays solid, so only the rim ends up perforated.
  stamp: {
    pad: 0.085, bottom: 0.085,
    outer: side => {
      const r = Math.max(0.9, side * 0.02)
      const holes = `radial-gradient(circle at ${mm(r)} ${mm(r)}, transparent ${mm(r * 0.68)}, #000 ${mm(r * 0.72)})`
      const solid = 'linear-gradient(#000, #000)'
      return {
        background: '#ffffff',
        padding: mm(r),
        boxSizing: 'border-box',
        WebkitMaskImage: `${holes}, ${solid}`,
        WebkitMaskSize: `${mm(r * 2)} ${mm(r * 2)}, auto`,
        WebkitMaskPosition: `-${mm(r)} -${mm(r)}, 0 0`,
        WebkitMaskRepeat: 'repeat, no-repeat',
        WebkitMaskClip: 'border-box, content-box',
        WebkitMaskComposite: 'source-over',
        maskImage: `${holes}, ${solid}`,
        maskSize: `${mm(r * 2)} ${mm(r * 2)}, auto`,
        maskPosition: `-${mm(r)} -${mm(r)}, 0 0`,
        maskRepeat: 'repeat, no-repeat',
        maskClip: 'border-box, content-box',
        maskComposite: 'add',
      } as CSSProperties
    },
  },
  // Scrapbook photo corners.
  corners: { pad: 0, bottom: 0, overlay: 'corners' },
  // Two strips of washi tape across the top corners.
  tape: { pad: 0, bottom: 0, outer: () => ({ boxShadow: '0 0.8mm 2mm rgba(0,0,0,.16)' }), overlay: 'tape' },
  // A soft dark edge. Drawn as a layer over the picture — an inset shadow on
  // the picture's box sits under the <img> and barely shows.
  vignette: { pad: 0, bottom: 0, overlay: 'vignette' },
}

export const PHOTO_FRAME_ORDER: PhotoFrame[] = ['none', 'white', 'polaroid', 'shadow', 'thin', 'double', 'film', 'stamp', 'tape', 'corners', 'vignette']

export function frameSpec(id: string | undefined): FrameSpec {
  return PHOTO_FRAMES[id as PhotoFrame] ?? PHOTO_FRAMES.none
}

// ── Text ─────────────────────────────────────────────────────────────────────

export type TextEffect = NonNullable<BookTextElement['effect']>

/** CSS for a text effect. `size` is the text's own point size, so a shadow or outline scales with it. */
export function textEffectCss(el: Pick<BookTextElement, 'effect' | 'highlight' | 'color' | 'size'>): CSSProperties {
  const pt = (n: number) => `${Math.round(n * 100) / 100}pt`
  switch (el.effect) {
    case 'shadow':
      return { textShadow: `0 ${pt(el.size * 0.06)} ${pt(el.size * 0.18)} rgba(0,0,0,.45)` }
    case 'outline': {
      const w = Math.max(0.3, el.size * 0.05)
      // An outline around light type on photos: the stroke takes the opposite
      // of the text colour so it always reads.
      const stroke = isLight(el.color) ? '#111111' : '#ffffff'
      return { WebkitTextStroke: `${pt(w)} ${stroke}`, paintOrder: 'stroke fill' } as CSSProperties
    }
    case 'highlight': {
      const c = el.highlight || '#fde68a'
      // A marker stroke behind the lower part of each line.
      return { backgroundImage: `linear-gradient(transparent 52%, ${c} 52%, ${c} 92%, transparent 92%)`, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } as CSSProperties
    }
    default:
      return {}
  }
}

export function isLight(hex: string): boolean {
  const h = (hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = Number.parseInt(full.slice(0, 6), 16)
  if (!/^[0-9a-fA-F]{6}/.test(full) || !Number.isFinite(n)) return false
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 > 0.6
}

/** One-click text styles. Applying one sets these fields and leaves the text, colour and position alone. */
export const TEXT_PRESETS: { id: 'title' | 'subtitle' | 'body' | 'caption' | 'quote' | 'label' | 'handwritten'; patch: Partial<BookTextElement> }[] = [
  { id: 'title', patch: { font: 'playfair', size: 30, weight: 700, italic: false, leading: 1.1, tracking: -0.01, uppercase: false, align: 'left' } },
  { id: 'subtitle', patch: { font: 'montserrat', size: 13, weight: 500, italic: false, leading: 1.3, tracking: 0.08, uppercase: true } },
  { id: 'body', patch: { font: 'serif', size: 10.5, weight: 400, italic: false, leading: 1.55, tracking: 0, uppercase: false, align: 'justify' } },
  { id: 'caption', patch: { font: 'inter', size: 7.5, weight: 500, italic: false, leading: 1.35, tracking: 0.04, uppercase: false } },
  { id: 'quote', patch: { font: 'cormorant', size: 18, weight: 500, italic: true, leading: 1.3, tracking: 0, uppercase: false, align: 'center' } },
  { id: 'label', patch: { font: 'oswald', size: 9, weight: 600, italic: false, leading: 1.2, tracking: 0.16, uppercase: true } },
  { id: 'handwritten', patch: { font: 'caveat', size: 16, weight: 600, italic: false, leading: 1.2, tracking: 0, uppercase: false } },
]

// ── Colour palettes ──────────────────────────────────────────────────────────

/** Named palettes for text, shapes and page backgrounds — light to dark within each. */
export const PALETTES: { id: 'classic' | 'sand' | 'sea' | 'forest' | 'sunset' | 'night'; colors: string[] }[] = [
  { id: 'classic', colors: ['#ffffff', '#f4f1ea', '#d9d4c7', '#8a8578', '#3f3a33', '#1a1a1a'] },
  { id: 'sand', colors: ['#fbf6ec', '#f1e4c8', '#e2c99a', '#c79b5e', '#9a6b37', '#5c3d1e'] },
  { id: 'sea', colors: ['#eef7f9', '#cfe8ee', '#8ecad6', '#3f9bb0', '#1f6478', '#0d3340'] },
  { id: 'forest', colors: ['#f2f5ec', '#d7e3c6', '#a8c48a', '#6b8f4e', '#3e5e2e', '#1f3318'] },
  { id: 'sunset', colors: ['#fff4ec', '#ffd9bf', '#ffab7a', '#f0703f', '#c2410c', '#7a2509'] },
  { id: 'night', colors: ['#e6e9f2', '#b8c0d9', '#6f7ba3', '#3b4670', '#1d2440', '#0b0f1f'] },
]

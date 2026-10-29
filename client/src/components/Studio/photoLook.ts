import type { BookPhotoAdjust, BookPhotoDuotone, BookPhotoEdge, BookPhotoElement, BookPhotoShadow } from '../../types/book'

/**
 * The photo look (schema rev 3, 5.7.2), ported from liketrek/TREK
 * (shared/src/book/book-photo-look.ts and Studio/photo/photoLook.ts):
 * reading it — off where a field is missing or null — and turning it into
 * what the page draws: CSS for the picture, the colour matrices of its SVG
 * filter and the box shadows a rectangular frame wears.
 *
 * A border, a hard shadow and a cutout are flat shapes of one colour and print
 * as vector; adjustments, warmth and a duotone are filters on the picture and
 * print as a raster, like the filter presets already did.
 */

export const PHOTO_ZOOM = { min: 1, max: 4 } as const
export const PHOTO_EDGE_MAX = 30
export const PHOTO_SHADOW_REACH = 30

/** The four adjustments, in the order the inspector lists them. */
export const PHOTO_ADJUSTMENTS = ['brightness', 'contrast', 'saturation', 'warmth'] as const
export type PhotoAdjustment = (typeof PHOTO_ADJUSTMENTS)[number]

/** Every field of the look, for copying a style from one photo to another. */
export const PHOTO_LOOK_KEYS = ['border', 'shadow', 'zoom', 'flipX', 'adjust', 'duotone', 'cutout'] as const

/** The look of one photo, every part resolved. */
export interface PhotoLook {
  border: BookPhotoEdge | null
  shadow: BookPhotoShadow | null
  zoom: number
  flipX: boolean
  /** Null when every adjustment is 0. */
  adjust: Required<BookPhotoAdjust> | null
  duotone: BookPhotoDuotone | null
  cutout: BookPhotoEdge | null
}

type LookSource = Pick<BookPhotoElement, (typeof PHOTO_LOOK_KEYS)[number]>
/** The adjustments with every one named, or null when none of them moves the picture. */
export function photoAdjustOf(adjust: BookPhotoAdjust | null | undefined): Required<BookPhotoAdjust> | null {
  if (!adjust) return null
  const full = {
    brightness: adjust.brightness ?? 0,
    contrast: adjust.contrast ?? 0,
    saturation: adjust.saturation ?? 0,
    warmth: adjust.warmth ?? 0,
  }
  return PHOTO_ADJUSTMENTS.some((k) => full[k] !== 0) ? full : null
}
/** The zoom a photo is drawn at: 1 when unset, inside the format's range otherwise. */
export function photoZoomOf(el: Pick<BookPhotoElement, 'zoom'>): number {
  const z = el.zoom
  if (typeof z !== 'number' || !Number.isFinite(z)) return PHOTO_ZOOM.min
  return Math.min(PHOTO_ZOOM.max, Math.max(PHOTO_ZOOM.min, z))
}
export function photoLookOf(el: LookSource): PhotoLook {
  return {
    border: el.border ?? null,
    shadow: el.shadow ?? null,
    zoom: photoZoomOf(el),
    flipX: el.flipX === true,
    adjust: photoAdjustOf(el.adjust),
    duotone: el.duotone ?? null,
    cutout: el.cutout ?? null,
  }
}
/** Whether the look draws the picture through a filter, which prints it as a raster. */
export function photoLookIsRaster(el: LookSource): boolean {
  const look = photoLookOf(el)
  return look.adjust !== null || look.duotone !== null
}
/** #rrggbb with an alpha, for a shadow drawn at its own strength. */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * Brightness, contrast and saturation as CSS filter functions, after the
 * preset filter. Half a step either way for the first two, which keeps the
 * ends of the slider usable; saturation runs from grey to twice the colour.
 */
export function adjustFilter(adjust: PhotoLook['adjust']): string[] {
  if (!adjust) return []
  const out: string[] = []
  if (adjust.brightness) out.push(`brightness(${round3(1 + adjust.brightness * 0.5)})`)
  if (adjust.contrast) out.push(`contrast(${round3(1 + adjust.contrast * 0.5)})`)
  if (adjust.saturation) out.push(`saturate(${round3(1 + adjust.saturation)})`)
  return out
}

/** The filter on the picture: the preset, the adjustments, then the SVG filter when there is one. */
export function pictureFilter(
  preset: string | undefined,
  look: PhotoLook,
  svgFilterId: string | null
): string | undefined {
  const parts = [preset, ...adjustFilter(look.adjust), svgFilterId ? `url(#${svgFilterId})` : undefined].filter(
    (p): p is string => !!p
  )
  return parts.length ? parts.join(' ') : undefined
}

/**
 * Warmth as a colour matrix: red up and blue down for warm, the reverse for
 * cool, green a little with red so a warm picture does not turn pink.
 */
export function warmthMatrix(warmth: number): string | null {
  if (!warmth) return null
  const r = round3(1 + warmth * 0.12)
  const g = round3(1 + warmth * 0.03)
  const b = round3(1 - warmth * 0.12)
  return `${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0`
}

const channels = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number]
}

/** Rec. 709 luminance weights, the brightness the duotone maps from. */
const LUMA = [0.2126, 0.7152, 0.0722] as const

/** A duotone as a colour matrix: the picture's luminance mapped from `dark` (black) to `light` (white). */
export function duotoneMatrix(duotone: BookPhotoDuotone): string {
  const dark = channels(duotone.dark)
  const light = channels(duotone.light)
  const rows = dark.map((d, i) => {
    const span = (light[i] ?? 0) - d
    return `${LUMA.map((w) => round3(w * span)).join(' ')} 0 ${round3(d)}`
  })
  return `${rows.join(' ')} 0 0 0 1 0`
}

/** The colour matrices the picture's SVG filter applies, in order; empty when it needs none. */
export function svgFilterMatrices(look: PhotoLook): string[] {
  const warm = warmthMatrix(look.adjust?.warmth ?? 0)
  return [warm, look.duotone ? duotoneMatrix(look.duotone) : null].filter((m): m is string => m !== null)
}

/**
 * The die-cut edge and the hard shadow of a rectangular frame, as box
 * shadows: no blur, so each is one flat shape, drawn behind the frame and
 * following its corner radius. The shadow is grown by the cutout too, so it
 * falls from the whole sticker rather than from the picture inside it.
 */
export function silhouetteShadows(shadow: BookPhotoShadow | null, cutout: BookPhotoEdge | null): string[] {
  const out: string[] = []
  const grow = cutout?.width ?? 0
  if (cutout) out.push(`0 0 0 ${cutout.width}mm ${cutout.color}`)
  if (shadow) out.push(`${shadow.dx}mm ${shadow.dy}mm 0 ${grow}mm ${rgba(shadow.color, shadow.alpha)}`)
  return out
}

/**
 * Where the picture sits inside a zoomed frame, as the image's own size and a
 * shift in its own percentages: z times the frame, moved so the focal point
 * stays where the frame put it at zoom 1.
 */
export function zoomPlacement(
  zoom: number,
  focalX: number,
  focalY: number
): { size: string; transform: string } | null {
  if (zoom <= 1) return null
  const shift = (f: number) => round3((-(zoom - 1) * f * 100) / zoom)
  return { size: `${round3(zoom * 100)}%`, transform: `translate(${shift(focalX)}%, ${shift(focalY)}%)` }
}

/** Where a part of the look starts when someone turns it on — print ink, not app chrome. */
export const PHOTO_LOOK_STARTS = {
  border: { width: 4, color: '#ffffff' },
  shadow: { dx: 2, dy: 2, color: '#1a1a1a', alpha: 0.35 },
  cutout: { width: 3, color: '#ffffff' },
  duotone: { dark: '#1e3a8a', light: '#f5e6c8' },
} satisfies { border: BookPhotoEdge; shadow: BookPhotoShadow; cutout: BookPhotoEdge; duotone: BookPhotoDuotone }

/** The duotones offered in one press, dark ink first: navy on sand, ink on paper, plum, forest, wine. */
export const PHOTO_DUOTONES: readonly BookPhotoDuotone[] = [
  { dark: '#1e3a8a', light: '#f5e6c8' },
  { dark: '#141414', light: '#f4efe6' },
  { dark: '#4c1d95', light: '#fbcfb8' },
  { dark: '#0f3d2e', light: '#e6efd6' },
  { dark: '#9f1239', light: '#fde68a' },
]

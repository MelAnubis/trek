import { fetchImageAsBlob } from '../../../api/authUrl'
import type { BookDocument } from '../../../types/book'
import type { PaletteSwatch } from '../bookColour'

/**
 * The colours of the book's photographs, for "colours from the photos"
 * (5.7.6, port of liketrek/TREK's theme/themePhotoColours.ts). Each thumbnail
 * is drawn 24 pixels across onto a canvas that never reaches the page, its
 * pixels bucketed, and the fullest buckets are the photo's swatches.
 */

const SAMPLE = 24
const MAX_THEME_PHOTOS = 12
const PER_PHOTO = 6

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`

/** The swatches of an RGBA buffer: pixels grouped by the top four bits a channel, each group's mean and share. */
export function swatchesFromPixels(data: ArrayLike<number>): PaletteSwatch[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  let total = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1
    buckets.set(key, bucket)
    total += 1
  }
  if (!total) return []
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, PER_PHOTO)
    .map(c => ({ hex: toHex(c.r / c.n, c.g / c.n, c.b / c.n), share: c.n / total }))
}

/** The photo ids a book shows, placed first, each once, at most MAX_THEME_PHOTOS. */
export function bookPhotoIds(doc: BookDocument | null): number[] {
  const ids = (doc?.spreads ?? []).flatMap(s => s.elements.flatMap(e => (e.kind === 'photo' && e.photoId != null ? [e.photoId] : [])))
  return [...new Set(ids)].slice(0, MAX_THEME_PHOTOS)
}

/** One photo's swatches (its authenticated thumbnail), or none when it cannot be read. */
export async function readPhotoSwatches(photoId: number): Promise<PaletteSwatch[]> {
  let blob = ''
  try {
    blob = await fetchImageAsBlob(`/api/photos/${photoId}/thumbnail`)
    if (!blob) return []
    const img = new Image()
    img.decoding = 'async'
    img.src = blob
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
    return swatchesFromPixels(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data)
  } catch {
    // A photo that will not load or will not be read gives no colours; the others still do.
    return []
  } finally {
    if (blob) URL.revokeObjectURL(blob)
  }
}

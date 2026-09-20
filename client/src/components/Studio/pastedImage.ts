/**
 * Turning a raw clipboard image into something the book document can hold.
 * A `BookImageElement`'s `src` is a self-contained `data:` URI (see its own
 * comment in types/book.ts) validated server-side against a hard cap
 * (`MAX_IMAGE_SRC_LENGTH` in bookSchema.ts) — an OS screenshot or a photo
 * copied straight out of a file browser routinely comes in well over that,
 * so pasting one has to shrink and re-encode it first, not just hand the
 * raw clipboard bytes to the document.
 */

/** Mirrors bookSchema.ts's MAX_IMAGE_SRC_LENGTH — the server rejects anything past this, so it's pointless to save an element that would fail. */
export const MAX_PASTED_IMAGE_SRC_LENGTH = 2_000_000
/** Long-edge cap in pixels before re-encoding — a pasted screenshot or camera photo is usually far larger than a book page will ever print it. */
export const MAX_PASTED_IMAGE_DIMENSION = 1800
const START_QUALITY = 0.85
const MIN_QUALITY = 0.4

/**
 * The frame a newly pasted image starts at: centred, sized to a comfortable
 * fraction of the page while keeping its own aspect ratio, and never
 * larger than the page itself for an extreme aspect ratio.
 */
export function fitImageFrame(naturalWidth: number, naturalHeight: number, page: { pageWidth: number; pageHeight: number }): { w: number; h: number } {
  const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1
  const base = Math.min(page.pageWidth, page.pageHeight) * 0.55
  let w = aspect >= 1 ? base * aspect : base
  let h = aspect >= 1 ? base : base / aspect

  const maxW = page.pageWidth * 0.9
  const maxH = page.pageHeight * 0.9
  if (w > maxW) { h *= maxW / w; w = maxW }
  if (h > maxH) { w *= maxH / h; h = maxH }

  return { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

/**
 * Decode a pasted image file, downscale it to a sane print size, and
 * re-encode as JPEG (the one lossy format the schema accepts that also
 * compresses photographically-sized content well) until it fits under the
 * server's size cap. Returns null rather than an oversized src the save
 * would just reject — the caller shows that as an error, not a broken paste.
 */
export async function encodeImageForPaste(file: Blob): Promise<{ src: string; naturalWidth: number; naturalHeight: number } | null> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const scale = Math.min(1, MAX_PASTED_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)

    let quality = START_QUALITY
    let src = canvas.toDataURL('image/jpeg', quality)
    while (src.length > MAX_PASTED_IMAGE_SRC_LENGTH && quality > MIN_QUALITY) {
      quality -= 0.15
      src = canvas.toDataURL('image/jpeg', quality)
    }
    if (src.length > MAX_PASTED_IMAGE_SRC_LENGTH) return null

    return { src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

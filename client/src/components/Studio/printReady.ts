/**
 * When the print view of a book is actually printable. Ported from
 * liketrek/TREK's client/src/components/Studio/printReady.ts (same AGPLv3
 * license), with this fork's progress count added.
 *
 * Both halves matter and neither is covered by the load event: a photograph
 * still decoding prints as an empty box, and a face still loading prints in
 * the fallback, the exact substitution the bundled typefaces exist to prevent.
 * So the Save button stays off until every picture and every face is in.
 */

/** How long the print view waits at most, and the picture count past which a book gets the longer wait. */
export const PRINT_READY = {
  ceilingMs: 8000,
  largeCeilingMs: 15000,
  largeBookPhotos: 40,
} as const

/**
 * The longest the Save button stays off for a book of `photos` pictures. A
 * book of a few dozen photographs from a slow provider can take longer than
 * eight seconds to decode; one that has not finished must not go to the press.
 */
export function printReadyCeilingMs(photos: number): number {
  return photos > PRINT_READY.largeBookPhotos ? PRINT_READY.largeCeilingMs : PRINT_READY.ceilingMs
}

/** What `whenReady` reads off the print document: its `<img>` elements, its SVG and its fonts. */
export interface PrintDocument {
  images: ArrayLike<Element & { complete?: boolean }>
  querySelectorAll?: (selector: string) => ArrayLike<Element>
  fonts?: { ready: Promise<unknown> }
}

const XLINK = 'http://www.w3.org/1999/xlink'

/**
 * The SVG pictures to wait for: every `<image>` that names a source, wherever
 * it sits. `doc.images` does not collect them — a photo cut to a mask is an
 * `<image>` inside a `<clipPath>` or `<defs>`. One that names no source would
 * never fire an event, so it is left out rather than left to hold the button
 * until the ceiling.
 */
export function svgImagesToWait(doc: PrintDocument): Element[] {
  const found = Array.from(doc.querySelectorAll?.('image') ?? [])
  return found.filter(el => !!(el.getAttribute('href') || el.getAttributeNS?.(XLINK, 'href')))
}

/**
 * Resolves once an SVG picture's source is in. An SVG `<image>` has no
 * `complete`, and one that finished before this ran never fires again — so
 * the source is asked for once more through a plain Image, which answers at
 * once from the cache when it already came, and waits when it did not.
 */
function probe(el: Element): Promise<void> {
  const href = el.getAttribute('href') || el.getAttributeNS?.(XLINK, 'href') || ''
  if (typeof Image === 'undefined' || !href) return settle(el)
  const img = new Image()
  const loaded = settle(img)
  img.src = href
  if (img.complete) return Promise.resolve()
  return typeof img.decode === 'function' ? img.decode().catch(() => undefined) : loaded
}

/** Resolves when the element has loaded or failed: a picture that will not load must not hold the button hostage. */
function settle(el: Element): Promise<void> {
  return new Promise<void>(resolve => {
    el.addEventListener('load', () => resolve(), { once: true })
    el.addEventListener('error', () => resolve(), { once: true })
  })
}

export interface ReadyProgress {
  done: number
  total: number
}

/**
 * Wait until the print view's pictures and faces are in, or until the
 * ceiling (which rises for a book with many photographs). `onProgress` hears
 * how many pictures have arrived so far, so the button can say so rather than
 * sit on "Preparing…" with no sign of life.
 */
export async function whenDocumentReady(
  doc: PrintDocument,
  setTimer: (fn: () => void, ms: number) => unknown = setTimeout,
  onProgress?: (p: ReadyProgress) => void,
): Promise<void> {
  const imgs = Array.from(doc.images)
  const svg = svgImagesToWait(doc)
  const total = imgs.length + svg.length
  let done = 0
  const tick = () => { done++; onProgress?.({ done, total }) }

  const pending = [
    ...imgs.map(img => (img.complete ? Promise.resolve().then(tick) : settle(img).then(tick))),
    ...svg.map(el => probe(el).then(tick)),
  ]
  onProgress?.({ done: 0, total })

  const ceiling = new Promise<void>(resolve => { setTimer(resolve, printReadyCeilingMs(total)) })
  await Promise.race([Promise.all([...pending, doc.fonts?.ready ?? Promise.resolve()]), ceiling])
}

/** `whenDocumentReady` for the print iframe. */
export async function whenReady(iframe: HTMLIFrameElement, onProgress?: (p: ReadyProgress) => void): Promise<void> {
  const win = iframe.contentWindow
  const doc = iframe.contentDocument as PrintDocument | null
  if (!win || !doc) return
  const wait = win.setTimeout?.bind(win) ?? setTimeout
  await whenDocumentReady(doc, wait, onProgress)
}

/**
 * Un dibujo del blog como imagen PNG: así puede ir a la entrada de la
 * travesía como una foto más, y de ahí al PDF y al Studio, que solo saben
 * de fotos. La imagen se rehace solo cuando el dibujo cambia (`sketchKey`).
 */
import type { BlogBlock, PhotoRef } from './types'
import { addPhotos } from './blogSync'
import { SKETCH_WIDTH, outlineOf, pathOf, strokeOpacity } from '../components/Blog/sketch'

type Sketch = Extract<BlogBlock, { type: 'sketch' }>

/** Huella del dibujo (trazos, forma, fondo): si cambia, hay que rehacer la imagen. */
export function sketchKey(b: Sketch): string {
  const s = JSON.stringify([b.aspect, b.background, b.strokes])
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}-${b.strokes.length}`
}

export function sketchSvg(b: Sketch): string {
  const h = Math.round(SKETCH_WIDTH * b.aspect)
  const bg = b.background === 'transparent' ? '#ffffff' : '#fffdf8'
  let pattern = ''
  if (b.background === 'grid') {
    for (let x = 40; x < SKETCH_WIDTH; x += 40) pattern += `<path d="M${x} 0V${h}" stroke="#c7d2fe" stroke-width="1"/>`
    for (let y = 40; y < h; y += 40) pattern += `<path d="M0 ${y}H${SKETCH_WIDTH}" stroke="#c7d2fe" stroke-width="1"/>`
  } else if (b.background === 'lines') {
    for (let y = 47; y < h; y += 48) pattern += `<path d="M0 ${y}H${SKETCH_WIDTH}" stroke="#bfdbfe" stroke-width="1.2"/>`
  }
  const strokes = b.strokes.map(s => `<path d="${pathOf(outlineOf(s))}" fill="${s.c}" fill-opacity="${strokeOpacity(s)}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SKETCH_WIDTH} ${h}" width="${SKETCH_WIDTH}" height="${h}"><rect width="${SKETCH_WIDTH}" height="${h}" fill="${bg}"/>${pattern}${strokes}</svg>`
}

/** PNG del dibujo, o null si este navegador no puede pintarlo (o está vacío). */
export async function renderSketchPng(b: Sketch, width = 1600): Promise<Blob | null> {
  if (!b.strokes.length || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext?.('2d')
  if (!ctx) return null
  const height = Math.round(width * b.aspect)
  canvas.width = width
  canvas.height = height
  const img = new Image()
  const loaded = new Promise<boolean>(resolve => { img.onload = () => resolve(true); img.onerror = () => resolve(false) })
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sketchSvg(b))}`
  if (!(await loaded)) return null
  ctx.drawImage(img, 0, 0, width, height)
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
}

/**
 * Antes de guardar: los dibujos que cambiaron se pasan a imagen (guardada en
 * el dispositivo y subida con lo demás). Devuelve los bloques con su
 * `image`/`imageKey` al día; un dibujo vacío se queda sin imagen.
 */
export async function ensureSketchImages(
  journeyId: number, postId: string, blocks: BlogBlock[],
  render: (b: Sketch) => Promise<Blob | null> = renderSketchPng,
): Promise<{ blocks: BlogBlock[]; changed: Map<string, { image?: PhotoRef; imageKey?: string }> }> {
  const changed = new Map<string, { image?: PhotoRef; imageKey?: string }>()
  const out: BlogBlock[] = []
  for (const b of blocks) {
    if (b.type !== 'sketch') { out.push(b); continue }
    if (!b.strokes.length) {
      if (b.image || b.imageKey) { changed.set(b.id, { image: undefined, imageKey: undefined }); out.push({ ...b, image: undefined, imageKey: undefined }) }
      else out.push(b)
      continue
    }
    const key = sketchKey(b)
    if (b.imageKey === key && b.image) { out.push(b); continue }
    const png = await render(b).catch(() => null)
    if (!png) { out.push(b); continue }
    const [ref] = await addPhotos(journeyId, postId, [new File([png], 'dibujo.png', { type: 'image/png' })])
    changed.set(b.id, { image: ref, imageKey: key })
    out.push({ ...b, image: ref, imageKey: key })
  }
  return { blocks: out, changed }
}

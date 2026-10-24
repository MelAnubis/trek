/**
 * Un dibujo del blog como imagen PNG: así puede ir a la entrada de la
 * travesía como una foto más, y de ahí al PDF y al Studio, que solo saben
 * de fotos. La imagen se rehace solo cuando el dibujo cambia (`sketchKey`).
 */
import type { BlogBlock, MapContext, PhotoRef } from './types'
import { buildRouteMapImage, type PdfGpxTrack } from '../components/PDF/gpxDrawing'
import { addPhotos } from './blogSync'
import { SKETCH_WIDTH, outlineOf, pathOf, strokeOpacity } from '../components/Blog/sketch'

type Sketch = Extract<BlogBlock, { type: 'sketch' }>

type MapBlock = Extract<BlogBlock, { type: 'map' }>

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`
}

/** Huella del dibujo (trazos, forma, fondo): si cambia, hay que rehacer la imagen. */
export function sketchKey(b: Sketch): string {
  return `${hash(JSON.stringify([b.aspect, b.background, b.strokes]))}-${b.strokes.length}`
}

/** Huella del mapa: sus opciones, lo que muestra y las teselas con que se pinta. */
export function mapKey(b: MapBlock, ctx: MapContext, tileUrl: string): string {
  return `m${hash(JSON.stringify([b.source, b.date ?? null, b.showTrack, b.showPhotos, tileUrl,
    ctx.entries.map(e => [e.lat, e.lng]), ctx.tracks.map(t => [t.id, t.points.length, t.points[0], t.points[t.points.length - 1]])]))}`
}

const mapIsEmpty = (ctx: MapContext) => !ctx.entries.length && !ctx.tracks.length

/** data:…;base64 → Blob, sin fetch (la CSP de la app no deja hacer fetch de data:). */
export function dataUrlToBlob(url: string): Blob | null {
  const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!m) return null
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' })
  } catch { return null }
}

/** PNG del mapa (teselas + track + puntos), con el mismo dibujante que el PDF. */
export async function renderMapPng(b: MapBlock, ctx: MapContext, tileUrl: string): Promise<Blob | null> {
  if (mapIsEmpty(ctx) || typeof document === 'undefined') return null
  const entries = ctx.entries.map(e => ({ entry_date: e.date, location_lat: e.lat, location_lng: e.lng }))
  const tracks = (b.showTrack ? ctx.tracks : []).map(t => ({
    id: t.id, track_name: t.name, total_distance: 0, total_elevation_gain: 0, total_elevation_loss: 0, max_elevation: null, min_elevation: null,
    points: t.points.map(([lat, lng]) => ({ lat, lng, ele: null })),
  })) as unknown as PdfGpxTrack[]
  const url = await buildRouteMapImage(entries, tracks, tileUrl, { width: 1600, height: 900 }).catch(() => null)
  if (!url) return null
  return dataUrlToBlob(url)
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
 * Antes de guardar: los dibujos y mapas que cambiaron se pasan a imagen
 * (guardada en el dispositivo y subida con lo demás), para que lleguen a la
 * entrada de la travesía. Un mapa necesita su contexto del servidor (`maps`):
 * hasta que llega, se queda como estaba.
 */
export async function ensureSketchImages(
  journeyId: number, postId: string, blocks: BlogBlock[],
  render: (b: Sketch) => Promise<Blob | null> = renderSketchPng,
  maps?: Record<string, MapContext> | null,
  tileUrl = '',
  renderMap: (b: MapBlock, ctx: MapContext, tileUrl: string) => Promise<Blob | null> = renderMapPng,
): Promise<{ blocks: BlogBlock[]; changed: Map<string, { image?: PhotoRef; imageKey?: string }> }> {
  const changed = new Map<string, { image?: PhotoRef; imageKey?: string }>()
  const out: BlogBlock[] = []
  const clear = (b: Sketch | MapBlock) => {
    if (b.image || b.imageKey) { changed.set(b.id, { image: undefined, imageKey: undefined }); out.push({ ...b, image: undefined, imageKey: undefined }) }
    else out.push(b)
  }
  const attach = async (b: Sketch | MapBlock, png: Blob | null, key: string, name: string) => {
    if (!png) { out.push(b); return }
    const [ref] = await addPhotos(journeyId, postId, [new File([png], name, { type: 'image/png' })])
    changed.set(b.id, { image: ref, imageKey: key })
    out.push({ ...b, image: ref, imageKey: key })
  }
  for (const b of blocks) {
    if (b.type === 'sketch') {
      if (!b.strokes.length) { clear(b); continue }
      const key = sketchKey(b)
      if (b.imageKey === key && b.image) { out.push(b); continue }
      await attach(b, await render(b).catch(() => null), key, 'dibujo.png')
    } else if (b.type === 'map') {
      const ctx = maps?.[b.id]
      if (!ctx) { out.push(b); continue }
      if (mapIsEmpty(ctx)) { clear(b); continue }
      const key = mapKey(b, ctx, tileUrl)
      if (b.imageKey === key && b.image) { out.push(b); continue }
      await attach(b, await renderMap(b, ctx, tileUrl).catch(() => null), key, 'mapa.png')
    } else out.push(b)
  }
  return { blocks: out, changed }
}

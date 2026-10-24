// FE-BLOG-SKIMG-001 …
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { ensureSketchImages, sketchKey, sketchSvg } from '../../../src/blog/sketchImage'
import { offlineDb, clearAll } from '../../../src/db/offlineDb'
import { _resetBlogSync } from '../../../src/blog/blogSync'
import { markdownToPlainText } from '../../../src/components/Journey/stripMarkdown'
import type { BlogBlock } from '../../../src/blog/types'

const sk = (strokes = [{ c: '#000000', w: 4, tool: 'pen' as const, p: [0, 0, 0.5, 10, 10, 0.5] }]): Extract<BlogBlock, { type: 'sketch' }> =>
  ({ id: 's1', type: 'sketch', aspect: 0.75, background: 'grid', strokes })

beforeEach(async () => { _resetBlogSync(); await clearAll(); Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }) })

describe('sketch → image', () => {
  it('FE-BLOG-SKIMG-001: the key follows the drawing; the SVG has the background and every stroke', () => {
    expect(sketchKey(sk())).toBe(sketchKey(sk()))
    expect(sketchKey(sk())).not.toBe(sketchKey({ ...sk(), background: 'paper' }))
    const svg = sketchSvg(sk())
    expect(svg).toContain('viewBox="0 0 1000 750"')
    expect(svg.match(/fill="#000000"/g)).toHaveLength(1)
    expect(svg).toContain('stroke="#c7d2fe"')
  })

  it('FE-BLOG-SKIMG-002: a changed drawing becomes a pending photo once; unchanged it is not redone; emptied it loses the image', async () => {
    const render = async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    const first = await ensureSketchImages(7, 'p1', [sk(), { id: 'x', type: 'paragraph', text: 'hola' }], render)
    const b = first.blocks[0] as Extract<BlogBlock, { type: 'sketch' }>
    expect(b.image?.localId).toBeTruthy()
    expect(b.imageKey).toBe(sketchKey(sk()))
    expect(await offlineDb.blogUploads.count()).toBe(1)
    expect((await offlineDb.blogUploads.get(b.image!.localId!))?.name).toBe('dibujo.png')

    const again = await ensureSketchImages(7, 'p1', first.blocks, render)
    expect(again.changed.size).toBe(0)
    expect(await offlineDb.blogUploads.count()).toBe(1)

    const emptied = await ensureSketchImages(7, 'p1', [{ ...b, strokes: [] }], render)
    expect((emptied.blocks[0] as Extract<BlogBlock, { type: 'sketch' }>).image).toBeUndefined()
  })

  it('FE-BLOG-SKIMG-003: when this browser cannot draw it, the post still saves, just without the image', async () => {
    const r = await ensureSketchImages(7, 'p1', [sk()], async () => null)
    expect((r.blocks[0] as Extract<BlogBlock, { type: 'sketch' }>).image).toBeUndefined()
  })
})

describe('markdownToPlainText (Studio)', () => {
  it('FE-BLOG-SKIMG-004: drops the markdown marks but keeps the paragraphs', () => {
    expect(markdownToPlainText('Este post en **nuevo**\n\n## Llegada\n\n> Una cita\n\n- uno\n- dos\n\nY _cursiva_ y [enlace](https://x.y)')).toBe(
      'Este post en nuevo\n\nLlegada\n\nUna cita\n\n• uno\n• dos\n\nY cursiva y enlace')
    expect(markdownToPlainText('snake_case_name y 2*3*4')).toBe('snake_case_name y 2*3*4')
    expect(markdownToPlainText(null)).toBeNull()
  })
})

describe('map → image', () => {
  const ctx = { entries: [{ id: 1, title: 'A', lat: 41, lng: -4.7, date: '2026-05-01' }], tracks: [{ id: 9, name: 'Etapa', points: [[41, -4.7], [41.1, -4.8]] as [number, number][] }], photos: [] }
  const mapBlock = (): Extract<BlogBlock, { type: 'map' }> => ({ id: 'm1', type: 'map', source: 'journey', showTrack: true, showPhotos: true })
  const png = async () => new Blob([new Uint8Array([137, 80])], { type: 'image/png' })

  it('FE-BLOG-SKIMG-005: waits for the server context, then becomes an image once; a changed map is redone; an empty one has none', async () => {
    const none = await ensureSketchImages(7, 'p1', [mapBlock()], undefined, null, 'T', png)
    expect((none.blocks[0] as any).image).toBeUndefined()
    const first = await ensureSketchImages(7, 'p1', [mapBlock()], undefined, { m1: ctx }, 'T', png)
    const b = first.blocks[0] as any
    expect(b.image?.localId).toBeTruthy()
    expect((await offlineDb.blogUploads.get(b.image.localId))?.name).toBe('mapa.png')
    expect((await ensureSketchImages(7, 'p1', first.blocks, undefined, { m1: ctx }, 'T', png)).changed.size).toBe(0)
    expect((await ensureSketchImages(7, 'p1', first.blocks, undefined, { m1: { ...ctx, tracks: [] } }, 'T', png)).changed.size).toBe(1)
    expect((await ensureSketchImages(7, 'p1', first.blocks, undefined, { m1: ctx }, 'OTHER-TILES', png)).changed.size).toBe(1)
    const empty = await ensureSketchImages(7, 'p1', first.blocks, undefined, { m1: { entries: [], tracks: [], photos: [] } }, 'T', png)
    expect((empty.blocks[0] as any).image).toBeUndefined()
  })
})

describe('dataUrlToBlob', () => {
  it('FE-BLOG-SKIMG-006: decodes a base64 PNG data URL without fetch (blocked by the app CSP)', async () => {
    const { dataUrlToBlob } = await import('../../../src/blog/sketchImage')
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw==')!
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(4)
    expect(dataUrlToBlob('nope')).toBeNull()
  })
})

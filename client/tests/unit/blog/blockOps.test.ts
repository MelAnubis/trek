// FE-BLOG-OPS-001 …
import { describe, it, expect } from 'vitest'
import { newBlock, insertAfter, removeBlock, moveBlock, convertText, blocksFromEntry, hasContent, photosOf } from '../../../src/blog/blockOps'
import { outlineOf, pathOf, hits, thin, compact, pointsOf } from '../../../src/components/Blog/sketch'
import type { BlogBlock } from '../../../src/blog/types'

const p = (id: string, text = ''): BlogBlock => ({ id, type: 'paragraph', text })

describe('blockOps', () => {
  it('FE-BLOG-OPS-001: inserting a photo on the empty line you are on replaces it; after text it goes below', () => {
    const photo = newBlock('photo', { photos: [{ galleryId: 1, photoId: 2 }] })
    expect(insertAfter([p('a', 'hola'), p('b')], 'b', [photo]).map(b => b.id)).toEqual(['a', photo.id])
    expect(insertAfter([p('a', 'hola'), p('b')], 'a', [photo]).map(b => b.id)).toEqual(['a', photo.id, 'b'])
    expect(insertAfter([p('a', 'hola')], null, [photo]).map(b => b.id)).toEqual(['a', photo.id])
    expect(insertAfter([p('a')], null, [photo]).map(b => b.id)).toEqual([photo.id])
    // un párrafo nuevo nunca se come la línea vacía
    const np = newBlock('paragraph')
    expect(insertAfter([p('a')], 'a', [np])).toHaveLength(2)
  })

  it('FE-BLOG-OPS-002: removing the last block leaves an empty paragraph; moving stays in bounds', () => {
    const r = removeBlock([p('a')], 'a')
    expect(r).toHaveLength(1)
    expect(r[0].type).toBe('paragraph')
    expect(moveBlock([p('a'), p('b')], 'a', -1).map(b => b.id)).toEqual(['a', 'b'])
    expect(moveBlock([p('a'), p('b')], 'a', 1).map(b => b.id)).toEqual(['b', 'a'])
  })

  it('FE-BLOG-OPS-003: text kinds convert keeping the words; a heading is one line', () => {
    expect(convertText(p('a', 'uno\ndos'), 'heading')).toEqual({ id: 'a', type: 'heading', text: 'uno dos', level: 2 })
    expect(convertText({ id: 'a', type: 'heading', text: 'T', level: 3 }, 'quote')).toEqual({ id: 'a', type: 'quote', text: 'T' })
  })

  it('FE-BLOG-OPS-004: an entry becomes heading, its paragraphs and its photos (one → photo, several → gallery)', () => {
    const bs = blocksFromEntry({ title: 'Día 1', story: 'Uno.\n\nDos.', photo_ids: [{ galleryId: 1, photoId: 10 }, { galleryId: 2, photoId: 11 }] })
    expect(bs.map(b => b.type)).toEqual(['heading', 'paragraph', 'paragraph', 'gallery'])
    expect(blocksFromEntry({ title: null, story: null, photo_ids: [{ galleryId: 1, photoId: 10 }] }).map(b => b.type)).toEqual(['photo'])
    expect(photosOf(bs)).toHaveLength(2)
  })

  it('FE-BLOG-OPS-005: a post with nothing in it is not content', () => {
    expect(hasContent('', [p('a'), p('b', '  ')])).toBe(false)
    expect(hasContent('Título', [p('a')])).toBe(true)
    expect(hasContent('', [newBlock('divider')])).toBe(true)
  })
})

describe('sketch geometry', () => {
  const stroke = { c: '#000000', w: 4, tool: 'pen' as const, p: [0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5, 30, 5, 0.5] }

  it('FE-BLOG-SKETCH-001: a stroke gets a closed filled outline', () => {
    const d = pathOf(outlineOf(stroke))
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(pointsOf(stroke)).toHaveLength(4)
  })

  it('FE-BLOG-SKETCH-002: the eraser hits a stroke only near its points', () => {
    expect(hits(stroke, 10, 3, 2)).toBe(true)
    expect(hits(stroke, 10, 40, 5)).toBe(false)
  })

  it('FE-BLOG-SKETCH-003: dense pencil input is thinned and rounded, keeping both ends', () => {
    const dense = Array.from({ length: 100 }, (_, i) => [i * 0.1, 0, 0.5]).flat()
    const t = thin(dense)
    expect(t.length).toBeLessThan(dense.length / 3)
    expect(t.slice(0, 3)).toEqual([0, 0, 0.5])
    expect(t.slice(-3)[0]).toBeCloseTo(9.9)
    expect(compact([1.234, 2.345, 0.6789])).toEqual([1.2, 2.3, 0.68])
  })
})

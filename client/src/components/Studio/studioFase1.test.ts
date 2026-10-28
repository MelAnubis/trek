// FE-STUDIO-55-001 to FE-STUDIO-55-020 — style copy, gestures, layer rows, schema revision, print readiness, photo resolution
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BookDocument, BookElement, BookFrame, BookSpread, BookTextElement } from '../../types/book'
import { bookElementStyle, pastableStyle, withPastedStyle } from './bookStyleCopy'
import { marqueeHits, mapFrame, rectBetween, resizeBox } from './studioGestures'
import { dropOn, layerKeyAction, layerLabel, layerRows } from './studioLayerRows'
import { BOOK_SCHEMA_REV, bookSchemaRev, isBookNewerThanReader, stampBookSchemaRev } from './bookSchemaRev'
import { printReadyCeilingMs, svgImagesToWait, whenDocumentReady } from './printReady'
import { MIN_PRINT_DPI, photoDpi } from './photoResolution'

function shape(id: string, frame: BookFrame = { x: 0, y: 0, w: 10, h: 10 }, extra: Partial<BookElement> = {}): BookElement {
  return {
    id, kind: 'shape', frame, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill: '#111111', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
    ...extra,
  } as BookElement
}
function text(id: string, extra: Partial<BookTextElement> = {}): BookTextElement {
  return {
    id, kind: 'text', frame: { x: 0, y: 0, w: 40, h: 10 }, rotation: 0, opacity: 1, locked: false,
    text: 'Hello world', font: 'serif', size: 18, weight: 700, italic: true, align: 'center', leading: 1.2, tracking: 0.05,
    color: '#aa0000', binding: null, overridden: false, ...extra,
  }
}
const spread = (elements: BookElement[]): BookSpread => ({ id: 'sp', role: 'inner', background: null, elements, parked: [], entryId: null })

describe('copy / paste style', () => {
  it('FE-STUDIO-55-001: same kind takes the whole look, never the words', () => {
    const from = text('a')
    const to = text('b', { text: 'Other', font: 'sans', size: 10, color: '#000000' })
    const pasted = withPastedStyle(to, bookElementStyle(from)) as BookTextElement
    expect(pasted.text).toBe('Other')
    expect(pasted).toMatchObject({ font: 'serif', size: 18, weight: 700, italic: true, color: '#aa0000', align: 'center' })
  })

  it('FE-STUDIO-55-002: across kinds only fields that mean the same thing travel', () => {
    const style = bookElementStyle(text('a', { opacity: 0.5 }))
    const look = pastableStyle(style, 'icon')
    expect(look).toEqual({ opacity: 0.5, color: '#aa0000' })
    // A shape has neither `color` nor typography — only the opacity.
    expect(pastableStyle(style, 'shape')).toEqual({ opacity: 0.5 })
  })

  it('FE-STUDIO-55-003: a shape\'s fill does not land on a text', () => {
    const style = bookElementStyle(shape('s', undefined, { opacity: 1 }))
    expect(pastableStyle(style, 'text')).toEqual({ opacity: 1 })
  })
})

describe('sheet gestures', () => {
  it('FE-STUDIO-55-004: a marquee catches what it touches, with whole groups, never locked or hidden layers', () => {
    const sp = spread([
      shape('a', { x: 0, y: 0, w: 10, h: 10 }, { group: 'g' }),
      shape('b', { x: 100, y: 100, w: 10, h: 10 }, { group: 'g' }),
      shape('c', { x: 5, y: 5, w: 10, h: 10 }, { locked: true }),
      shape('d', { x: 6, y: 6, w: 10, h: 10 }, { hidden: true }),
      shape('e', { x: 50, y: 50, w: 10, h: 10 }),
    ])
    expect(marqueeHits(sp, rectBetween(20, 20, 2, 2))).toEqual(['a', 'b'])
  })

  it('FE-STUDIO-55-005: a page-sized element that holds the whole marquee is not caught by it', () => {
    const sp = spread([shape('bg', { x: 0, y: 0, w: 420, h: 210 }), shape('x', { x: 50, y: 50, w: 10, h: 10 })])
    expect(marqueeHits(sp, rectBetween(40, 40, 70, 70))).toEqual(['x'])
  })

  it('FE-STUDIO-55-006: Shift on a corner keeps the box\'s proportions', () => {
    const r = resizeBox({ x: 0, y: 0, w: 40, h: 20 }, 'se', { dx: 40, dy: 0 }, true)
    expect(r).toEqual({ x: 0, y: 0, w: 80, h: 40 })
  })

  it('FE-STUDIO-55-007: a box never turns inside out', () => {
    const r = resizeBox({ x: 10, y: 10, w: 20, h: 20 }, 'w', { dx: 100, dy: 0 }, false)
    expect(r.w).toBe(4)
    expect(r.x).toBe(26)
  })

  it('FE-STUDIO-55-008: frames inside a resized box are carried along with it', () => {
    expect(mapFrame({ x: 10, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 10 }, { x: 0, y: 0, w: 40, h: 20 }))
      .toEqual({ x: 20, y: 0, w: 20, h: 20 })
  })
})

describe('layer rows', () => {
  const sp = spread([shape('back'), shape('m1', undefined, { group: 'g' }), shape('m2', undefined, { group: 'g' }), text('front')])

  it('FE-STUDIO-55-009: rows run front to back, a group\'s members under its row; collapsed shows the row alone', () => {
    expect(layerRows(sp, new Set()).map(r => r.key)).toEqual(['front', 'g:g', 'm2', 'm1', 'back'])
    expect(layerRows(sp, new Set(['g'])).map(r => r.key)).toEqual(['front', 'g:g', 'back'])
  })

  it('FE-STUDIO-55-010: a drop on a member joins its group; on the group row it goes beside the whole group', () => {
    const rows = layerRows(sp, new Set())
    expect(dropOn(rows[2], true)).toEqual({ anchorId: 'm2', where: 'above', join: true })
    expect(dropOn(rows[1], false)).toEqual({ anchorId: 'm1', where: 'below', join: false })
  })

  it('FE-STUDIO-55-011: the tree keys — arrows, Enter, F2, Alt+arrows, L, H, Right into a group', () => {
    const rows = layerRows(sp, new Set())
    const o = { collapsed: new Set<string>(), rtl: false, additive: false }
    expect(layerKeyAction('ArrowDown', 0, rows, o)).toEqual({ type: 'focus', index: 1 })
    expect(layerKeyAction('Enter', 0, rows, o)).toEqual({ type: 'choose', additive: false })
    expect(layerKeyAction('F2', 0, rows, o)).toEqual({ type: 'rename' })
    expect(layerKeyAction('ArrowUp', 0, rows, { ...o, alt: true })).toEqual({ type: 'move', dir: 'up' })
    expect(layerKeyAction('l', 0, rows, o)).toEqual({ type: 'lock' })
    expect(layerKeyAction('h', 0, rows, o)).toEqual({ type: 'hide' })
    expect(layerKeyAction('ArrowRight', 1, rows, o)).toEqual({ type: 'focus', index: 2 })
    expect(layerKeyAction('ArrowLeft', 2, rows, o)).toEqual({ type: 'focus', index: 1 })
    expect(layerKeyAction('ArrowRight', 1, rows, { ...o, collapsed: new Set(['g']) })).toEqual({ type: 'expand', groupId: 'g' })
  })

  it('FE-STUDIO-55-012: a layer is called by its name, else a text\'s first words, else its kind', () => {
    expect(layerLabel(shape('a', undefined, { name: 'Sky' }), 'Shape')).toBe('Sky')
    expect(layerLabel(text('t', { text: '\n  Day one in Porto\nmore' }), 'Text')).toBe('Day one in Porto')
    expect(layerLabel(shape('a'), 'Shape')).toBe('Shape')
  })
})

describe('format revision', () => {
  it('FE-STUDIO-55-013: an unstamped book is revision 1; a stamp is only ever raised', () => {
    const doc: BookDocument = { version: 1, title: '', page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }, spreads: [] }
    expect(bookSchemaRev(doc)).toBe(1)
    expect(stampBookSchemaRev(doc).schemaRev).toBe(BOOK_SCHEMA_REV)
    const newer = { ...doc, schemaRev: BOOK_SCHEMA_REV + 3 }
    expect(stampBookSchemaRev(newer)).toBe(newer)
    expect(isBookNewerThanReader(newer)).toBe(true)
    expect(isBookNewerThanReader({ ...doc, schemaRev: 'x' })).toBe(false)
  })

  it('FE-STUDIO-55-014: the client and server agree on the current revision', () => {
    const server = readFileSync(resolve(process.cwd(), '../server/src/services/journeyBook/bookSchemaRev.ts'), 'utf8')
    const m = server.match(/export const BOOK_SCHEMA_REV = (\d+)/)
    expect(Number(m?.[1])).toBe(BOOK_SCHEMA_REV)
  })
})

describe('print readiness', () => {
  it('FE-STUDIO-55-015: a big book gets the longer wait', () => {
    expect(printReadyCeilingMs(10)).toBe(8000)
    expect(printReadyCeilingMs(41)).toBe(15000)
  })

  it('FE-STUDIO-55-016: waits for every picture and the fonts, counting them in', async () => {
    const img = document.createElement('img')
    Object.defineProperty(img, 'complete', { value: false })
    const done = document.createElement('img')
    Object.defineProperty(done, 'complete', { value: true })
    let fontsReady!: () => void
    const doc = { images: [img, done], querySelectorAll: () => [] as Element[], fonts: { ready: new Promise<void>(r => { fontsReady = r }) } }
    const progress: number[] = []
    let finished = false
    const p = whenDocumentReady(doc, () => 0, ({ done: d }) => progress.push(d)).then(() => { finished = true })
    await Promise.resolve(); await Promise.resolve()
    expect(finished).toBe(false)
    img.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(finished).toBe(false) // fonts still loading
    fontsReady()
    await p
    expect(finished).toBe(true)
    expect(progress[progress.length - 1]).toBe(2)
  })

  it('FE-STUDIO-55-017: a picture that never loads cannot hold the button past the ceiling', async () => {
    vi.useFakeTimers()
    const img = document.createElement('img')
    Object.defineProperty(img, 'complete', { value: false })
    const p = whenDocumentReady({ images: [img] }, (fn, ms) => setTimeout(fn, ms))
    vi.advanceTimersByTime(8000)
    await expect(p).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('FE-STUDIO-55-018: SVG pictures with a source are waited for; one with none is left out', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    a.setAttribute('href', '/x.jpg')
    const b = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    svg.append(a, b)
    expect(svgImagesToWait({ images: [], querySelectorAll: s => svg.querySelectorAll(s) })).toEqual([a])
  })
})

describe('photo print resolution', () => {
  it('FE-STUDIO-55-019: a 4000 px wide photo across 100 mm prints at about 1016 dpi', () => {
    expect(photoDpi({ frame: { x: 0, y: 0, w: 100, h: 75 }, fit: 'cover' }, { width: 4000, height: 3000 })).toBe(1016)
  })

  it('FE-STUDIO-55-020: a small original across a big frame is under the threshold; cover uses the stretched axis', () => {
    const dpi = photoDpi({ frame: { x: 0, y: 0, w: 300, h: 100 }, fit: 'cover' }, { width: 1200, height: 1200 })!
    expect(dpi).toBe(102)
    expect(dpi).toBeLessThan(MIN_PRINT_DPI)
    expect(photoDpi({ frame: { x: 0, y: 0, w: 300, h: 100 }, fit: 'contain' }, { width: 1200, height: 1200 })).toBe(305)
    expect(photoDpi({ frame: { x: 0, y: 0, w: 10, h: 10 }, fit: 'cover' }, null)).toBeNull()
  })
})

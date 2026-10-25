// FE-MAG-001 … — la revista #ESTODOBAJADA
import { describe, it, expect } from 'vitest'
import { buildMagazine, MAGAZINE_PAGE, seasonLabel, type MagazineInput, type MagazineJourney, type MagazineStory } from './magazineLayout'
import { storyPieces } from '../Magazine/magazineData'
import type { BookElement, BookSpread, BookTextElement } from '../../types/book'

const labels: MagazineInput['labels'] = {
  feature: 'Reportaje', story: 'Relato', contents: 'En este número', route: 'La ruta', days: 'días', by: 'Texto y fotos:',
  colophon: 'Colofón', madeWith: 'Hecho con Trek Wanderer.', editorNote: 'Nota del editor',
}
const long = (n: number) => Array.from({ length: n }, (_, i) => `Frase número ${i} de una historia que no termina nunca porque la meseta es larga.`).join(' ')

const journey = (title: string, photos = 3): MagazineJourney => ({
  kind: 'journey', title, subtitle: 'Tres días por La Moraña', author: 'juanma', coverPhotoId: 100, days: 3, distanceKm: 123, gainM: 789,
  entries: [
    { id: 1, title: 'Salida', story: 'Salimos pronto.', location: 'Arévalo', date: '2026-05-01', photos: [{ photoId: 100, width: 3000, height: 2000 }, { photoId: 101, width: 2000, height: 3000 }].slice(0, photos) },
    { id: 2, title: 'Madrigal', story: long(4), location: 'Madrigal', date: '2026-05-02', photos: [{ photoId: 102, width: 3000, height: 2000 }] },
    { id: 3, title: 'Parada', story: null, location: 'Fuente', date: '2026-05-02', photos: [] },
  ],
  route: { mapSrc: 'data:image/png;base64,AAA', elevationSrc: 'data:image/svg+xml;base64,BBB', stats: { totalDist: 123, gain: 789, loss: 747, minEle: 700, maxEle: 1111, maxSlope: 9, ibp: null } },
})
const story = (title: string): MagazineStory => ({
  kind: 'story', title, standfirst: 'Alguien mintió.', author: 'juanma', date: '2026-05-02', coverPhotoId: 200,
  pieces: [{ type: 'p', text: long(30) }, { type: 'photo', photo: { photoId: 201 }, caption: 'La muralla' }, { type: 'h', text: 'Vuelta' }, { type: 'q', text: 'Es todo bajada', cite: 'nadie' }, { type: 'p', text: long(3) }],
})
const input = (features: MagazineInput['features']): MagazineInput => ({ locale: 'es-ES', title: '#ESTODOBAJADA', volume: 1, season: 'Otoño 2026', editorNote: 'Despacio.', features, labels })

const texts = (sp: BookSpread) => sp.elements.filter((e): e is BookTextElement => e.kind === 'text').map(e => e.text)
const photosOf = (sp: BookSpread) => sp.elements.filter(e => e.kind === 'photo') as (BookElement & { photoId: number })[]

describe('buildMagazine', () => {
  it('FE-MAG-001: pocket size, cover · contents · inner spreads · colophon · back, page numbers on', () => {
    const doc = buildMagazine(input([journey('Tierras de Castilla'), story('Nos dijeron que era todo bajada')]))
    expect(doc.page).toMatchObject({ pageWidth: 120, pageHeight: 170, bleed: 3 })
    expect(doc.page.pageNumbers?.show).toBe(true)
    const roles = doc.spreads.map(s => s.role)
    expect(roles[0]).toBe('cover')
    expect(roles[1]).toBe('first')
    expect(roles.slice(-2)).toEqual(['last', 'back'])
    expect(roles.slice(2, -2).every(r => r === 'inner')).toBe(true)
    expect(doc.spreads.length).toBeGreaterThan(6)
  })

  it('FE-MAG-002: the cover carries the sticker masthead, the issue line and the cover lines', () => {
    const doc = buildMagazine(input([journey('Tierras de Castilla'), story('Nos dijeron que era todo bajada')]))
    const cover = doc.spreads[0]
    expect(texts(cover)).toEqual(expect.arrayContaining(['#ESTODOBAJADA', 'TREK WANDERER · VOL. 1 · OTOÑO 2026', 'Tierras de Castilla', 'Nos dijeron que era todo bajada']))
    const mast = cover.elements.find(e => e.kind === 'text' && (e as BookTextElement).text === '#ESTODOBAJADA') as BookTextElement
    expect(mast).toMatchObject({ font: 'jost', weight: 300, color: '#ffffff' })
    expect(photosOf(cover)[0].photoId).toBe(100)
  })

  it('FE-MAG-003: every feature opens on a left page — photo left, title right — and the contents point at it', () => {
    const doc = buildMagazine(input([journey('Uno'), story('Dos'), journey('Tres', 1)]))
    const W = MAGAZINE_PAGE.pageWidth
    const inner = doc.spreads.slice(2, -2)
    for (const title of ['Uno', 'Dos', 'Tres']) {
      const i = inner.findIndex(sp => sp.elements.some(e => e.kind === 'text' && (e as BookTextElement).text === title && e.frame.x >= W))
      expect(i, title).toBeGreaterThanOrEqual(0)
      const opener = inner[i]
      expect(photosOf(opener).some(p => p.frame.x < 0 && p.frame.x + p.frame.w <= W + MAGAZINE_PAGE.bleed)).toBe(true)
      // Contents: page number = 2 + 2 × (inner spreads before it).
      const contents = texts(doc.spreads[1])
      const at = contents.indexOf(title)
      expect(contents[at - 1]).toBe(String(2 + i * 2).padStart(2, '0'))
    }
  })

  it('FE-MAG-004: journeys keep their entries (the opener photo is not repeated) and end with the route', () => {
    const doc = buildMagazine(input([journey('Tierras de Castilla', 1)]))
    const all = doc.spreads.flatMap(s => s.elements)
    expect(all.filter(e => e.kind === 'photo' && (e as { photoId: number }).photoId === 100)).toHaveLength(2) // cover + opener
    expect(all.some(e => e.kind === 'photo' && (e as { photoId: number }).photoId === 102)).toBe(true)
    expect(all.some(e => e.kind === 'text' && (e as BookTextElement).text === 'LA RUTA')).toBe(true)
    expect(all.some(e => e.kind === 'image' && (e as { src: string }).src.startsWith('data:image/png'))).toBe(true)
    // A bare stop (no photo, no story) doesn't get a page of its own.
    expect(all.some(e => e.kind === 'text' && (e as BookTextElement).text === 'Fuente')).toBe(false)
  })

  it('FE-MAG-005: a long story flows over several pages without losing words; photos get their own page', () => {
    const s = story('Larga')
    const doc = buildMagazine(input([s]))
    const body = doc.spreads.flatMap(sp => sp.elements).filter((e): e is BookTextElement => e.kind === 'text' && e.font === 'serif' && !e.italic && e.size === 8.6)
    const words = body.map(e => e.text).join(' ').split(/\s+/).length
    const expected = (s.pieces[0] as { text: string }).text.split(/\s+/).length + (s.pieces[4] as { text: string }).text.split(/\s+/).length
    expect(words).toBe(expected)
    const pageH = MAGAZINE_PAGE.pageHeight
    expect(body.every(e => e.frame.y + e.frame.h <= pageH)).toBe(true)
    expect(doc.spreads.flatMap(sp => photosOf(sp)).some(p => p.photoId === 201)).toBe(true)
    expect(doc.spreads.flatMap(texts)).toEqual(expect.arrayContaining(['«Es todo bajada»', '— nadie', 'VUELTA']))
  })

  it('FE-MAG-006: everything the server checks: #rrggbb colours, weights, ≤ 90 elements per spread, frames inside the bleed', () => {
    const doc = buildMagazine(input([journey('Uno'), story('Dos'), story('Tres')]))
    const { pageWidth: W, pageHeight: H, bleed: B } = doc.page
    for (const sp of doc.spreads) {
      expect(sp.elements.length).toBeLessThanOrEqual(90)
      const span = sp.role === 'inner' ? W * 2 : W
      for (const e of sp.elements) {
        if (e.kind === 'text') {
          expect((e as BookTextElement).color).toMatch(/^#[0-9a-f]{6}$/i)
          expect([300, 400, 500, 600, 700]).toContain((e as BookTextElement).weight)
        }
        // Text never runs off the trimmed page (photos may bleed, as the book's own templates do).
        if (e.kind === 'text') {
          expect(e.frame.x).toBeGreaterThanOrEqual(0)
          expect(e.frame.x + e.frame.w).toBeLessThanOrEqual(span + 0.01)
          expect(e.frame.y + e.frame.h).toBeLessThanOrEqual(H + B + 0.01)
        }
      }
    }
    expect(new Set(doc.spreads.flatMap(s => [s.id, ...s.elements.map(e => e.id)])).size).toBe(doc.spreads.reduce((n, s) => n + 1 + s.elements.length, 0))
  })

  it('FE-MAG-007: season labels', () => {
    const n: [string, string, string, string] = ['Invierno', 'Primavera', 'Verano', 'Otoño']
    expect(seasonLabel(new Date('2026-10-25'), n)).toBe('Otoño 2026')
    expect(seasonLabel(new Date('2026-01-10'), n)).toBe('Invierno 2026')
    expect(seasonLabel(new Date('2026-07-01'), n)).toBe('Verano 2026')
  })
})

describe('storyPieces', () => {
  it('FE-MAG-008: blog blocks become text, headings, quotes and photo pages (sketches and maps by their image)', () => {
    const pieces = storyPieces([
      { id: 'a', type: 'paragraph', text: 'Salimos **pronto**.\n\nY volvimos tarde.' },
      { id: 'b', type: 'heading', text: 'Día 2', level: 2 },
      { id: 'c', type: 'gallery', photos: [{ photoId: 5 }, { photoId: 6 }], layout: 'grid', caption: 'Dos' },
      { id: 'd', type: 'sketch', aspect: 0.6, background: 'paper', strokes: [], image: { photoId: 7 } },
      { id: 'e', type: 'map', source: 'post', showTrack: true, showPhotos: true },
      { id: 'f', type: 'divider' },
      { id: 'g', type: 'entry', entryId: 9 },
    ], [{ id: 9, title: 'Castillo', story: 'Sombra.', entry_date: '2026-05-01', location_name: null }])
    expect(pieces).toEqual([
      { type: 'p', text: 'Salimos pronto.' }, { type: 'p', text: 'Y volvimos tarde.' },
      { type: 'h', text: 'Día 2' },
      { type: 'photo', photo: { photoId: 5 }, caption: 'Dos' }, { type: 'photo', photo: { photoId: 6 }, caption: null },
      { type: 'photo', photo: { photoId: 7 }, caption: null, contain: true },
      { type: 'h', text: 'Castillo' }, { type: 'p', text: 'Sombra.' },
    ])
  })
})

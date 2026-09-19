// FE-AUTOLAYOUT-001 to FE-AUTOLAYOUT-010
import { buildBook, emptyBook, relayoutSpread, type AutoInput, type AutoEntry } from './autoLayout'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function entry(overrides: Partial<AutoEntry> = {}): AutoEntry {
  return {
    id: 1, title: 'Day in Kyoto', story: 'We walked through the bamboo grove.', location: 'Kyoto',
    date: '2026-04-02', photos: [{ photoId: 101 }, { photoId: 102 }],
    ...overrides,
  }
}

function input(overrides: Partial<AutoInput> = {}): AutoInput {
  return {
    locale: 'en',
    title: 'Autumn in Japan',
    subtitle: 'Two weeks, three cities',
    coverPhotoId: 100,
    entries: [entry()],
    page: PAGE,
    journeyStats: { days: 5, entries: 3, photos: 20, places: 4 },
    ...overrides,
  }
}

describe('emptyBook', () => {
  it('FE-AUTOLAYOUT-001: one cover and one inner spread, no elements', () => {
    const doc = emptyBook(PAGE, 'My Trip')
    expect(doc.title).toBe('My Trip')
    expect(doc.spreads).toHaveLength(2)
    expect(doc.spreads[0].role).toBe('cover')
    expect(doc.spreads[1].role).toBe('inner')
    expect(doc.spreads.every(s => s.elements.length === 0)).toBe(true)
  })
})

describe('buildBook', () => {
  it('FE-AUTOLAYOUT-002: produces a cover, one spread per entry with content, and a closing spread', () => {
    const doc = buildBook(input())
    expect(doc.spreads[0].role).toBe('cover')
    expect(doc.spreads).toHaveLength(3) // cover + 1 entry + summary
    expect(doc.spreads[1].entryId).toBe(1)
    expect(doc.spreads[doc.spreads.length - 1].role).toBe('inner')
  })

  it('FE-AUTOLAYOUT-003: entries with neither photos nor a story are skipped entirely', () => {
    const doc = buildBook(input({
      entries: [
        entry({ id: 1 }),
        entry({ id: 2, photos: [], story: '  ' }),
      ],
    }))
    const entryIds = doc.spreads.map(s => s.entryId).filter(Boolean)
    expect(entryIds).toEqual([1])
  })

  it('FE-AUTOLAYOUT-004: an entry spread carries real photoIds from the entry, not placeholders', () => {
    const doc = buildBook(input())
    const spread = doc.spreads.find(s => s.entryId === 1)!
    const photoIds = spread.elements.filter(e => e.kind === 'photo').map(e => (e as any).photoId)
    expect(photoIds).toContain(101)
  })

  it('FE-AUTOLAYOUT-005: a template that wants a story is never chosen for an entry with none', () => {
    const doc = buildBook(input({
      entries: [entry({ id: 1, story: '', photos: [{ photoId: 1 }, { photoId: 2 }, { photoId: 3 }] })],
    }))
    const spread = doc.spreads.find(s => s.entryId === 1)!
    // No element should carry the (empty) story text — a body slot for an
    // entry with no story would otherwise show a blank text box.
    const bodies = spread.elements.filter(e => e.kind === 'text' && (e as any).text === '')
    expect(bodies).toHaveLength(0)
  })

  it('FE-AUTOLAYOUT-006: the cover uses the given title, subtitle and cover photo', () => {
    const doc = buildBook(input())
    const cover = doc.spreads[0]
    const texts = cover.elements.filter(e => e.kind === 'text').map(e => (e as any).text)
    expect(texts).toContain('Autumn in Japan')
    expect(texts).toContain('Two weeks, three cities')
    const photo = cover.elements.find(e => e.kind === 'photo') as any
    expect(photo?.photoId).toBe(100)
  })

  it('FE-AUTOLAYOUT-007: with no cover photo, the cover still has a title and no photo element', () => {
    const doc = buildBook(input({ coverPhotoId: null }))
    const cover = doc.spreads[0]
    expect(cover.elements.some(e => e.kind === 'photo')).toBe(false)
    expect(cover.elements.some(e => e.kind === 'text' && (e as any).text === 'Autumn in Japan')).toBe(true)
  })

  it('FE-AUTOLAYOUT-008: respects the 150-spread cap', () => {
    const many = Array.from({ length: 200 }, (_, i) => entry({ id: i + 1, photos: [{ photoId: i }] }))
    const doc = buildBook(input({ entries: many }))
    expect(doc.spreads.length).toBeLessThanOrEqual(150)
  })

  it('FE-AUTOLAYOUT-011: every text/shape colour is a plain #rrggbb hex, never rgba() or a CSS name', () => {
    // The server validates colour fields with a strict #rrggbb regex — no
    // alpha channel — since fading is expressed through the element's own
    // `opacity`, not baked into the colour string. A colour that fails this
    // (e.g. 'rgba(255,255,255,0.5)') passes client-side rendering fine but
    // gets rejected by the save endpoint with a 400, silently dropping the
    // user's edits since nothing after that point is version 1 anymore.
    const doc = buildBook(input())
    const hex = /^#[0-9a-fA-F]{6}$/
    for (const spread of doc.spreads) {
      for (const el of [...spread.elements, ...spread.parked]) {
        if (el.kind === 'text') expect(el.color).toMatch(hex)
        if (el.kind === 'shape') {
          if (el.fill != null) expect(el.fill).toMatch(hex)
          if (el.stroke != null) expect(el.stroke).toMatch(hex)
        }
      }
    }
  })
})

describe('relayoutSpread', () => {
  it('FE-AUTOLAYOUT-009: returns null for a spread with no entryId', () => {
    const doc = buildBook(input())
    const cover = doc.spreads[0]
    expect(relayoutSpread(cover, input())).toBeNull()
  })

  it('FE-AUTOLAYOUT-010: regenerating a spread keeps its id but rebuilds its content', () => {
    const inp = input()
    const doc = buildBook(inp)
    const original = doc.spreads.find(s => s.entryId === 1)!
    const relaid = relayoutSpread(original, inp, 0)
    expect(relaid).not.toBeNull()
    expect(relaid!.id).toBe(original.id)
    expect(relaid!.entryId).toBe(1)
    expect(relaid!.elements.length).toBeGreaterThan(0)
  })
})

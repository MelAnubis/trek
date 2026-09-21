// FE-AUTOLAYOUT-001 to FE-AUTOLAYOUT-030
import { buildBook, emptyBook, estimateTextHeight, relayoutSpread, tightenHeroStory, type AutoInput, type AutoEntry } from './autoLayout'
import { TEMPLATES, applyTemplate } from './templates'
import type { BookElement, BookSpread } from '../../types/book'

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

const EMPTY_STATS = { totalDist: 0, gain: 0, loss: 0, minEle: null, maxEle: null, maxSlope: 0, ibp: null }
const FULL_STATS = { totalDist: 26.33, gain: 843, loss: 612, minEle: 12, maxEle: 621, maxSlope: 18, ibp: 92 }

describe('buildBook — route spreads', () => {
  it('FE-AUTOLAYOUT-012: a day with a matching route image gets its own spread, right before that day\'s entry', () => {
    const inp = input({
      routeImagesByDate: new Map([['2026-04-02', { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: null, stats: EMPTY_STATS }]]),
    })
    const doc = buildBook(inp)
    const entryIdx = doc.spreads.findIndex(s => s.entryId === 1)
    expect(entryIdx).toBeGreaterThan(-1)
    const routeSpread = doc.spreads[entryIdx - 1]
    expect(routeSpread.entryId).toBeNull()
    expect(routeSpread.elements.some(e => e.kind === 'image')).toBe(true)
  })

  it('FE-AUTOLAYOUT-013: a day with no matching route image gets no extra spread', () => {
    const inp = input({ routeImagesByDate: new Map() })
    const withImages = buildBook(inp).spreads.length
    const without = buildBook(input()).spreads.length
    expect(withImages).toBe(without)
  })

  it('FE-AUTOLAYOUT-014: with entries sharing a date, the route spread lands before the first of that day\'s entries, not the last', () => {
    const inp = input({
      entries: [
        entry({ id: 1, date: '2026-04-02', title: 'Morning' }),
        entry({ id: 2, date: '2026-04-02', title: 'Evening' }),
      ],
      routeImagesByDate: new Map([['2026-04-02', { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: null, stats: EMPTY_STATS }]]),
    })
    const doc = buildBook(inp)
    const entryIndices = doc.spreads.map((s, i) => s.entryId != null ? i : -1).filter(i => i >= 0)
    expect(entryIndices).toEqual([2, 3])
    expect(doc.spreads[1].elements.some(e => e.kind === 'image')).toBe(true)
  })

  it('FE-AUTOLAYOUT-015: with no routeImagesByDate at all, behaves exactly as before (backward compatible)', () => {
    const withField = buildBook(input({ routeImagesByDate: undefined }))
    const withoutField = buildBook(input())
    const shape = (d: typeof withField) => d.spreads.map(s => ({ role: s.role, entryId: s.entryId, kinds: s.elements.map(e => e.kind) }))
    expect(shape(withField)).toEqual(shape(withoutField))
  })

  it('FE-AUTOLAYOUT-016: both a map and an elevation image are placed when both are available', () => {
    const inp = input({
      routeImagesByDate: new Map([['2026-04-02', { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: 'data:image/svg+xml;base64,BBBB', stats: EMPTY_STATS }]]),
    })
    const doc = buildBook(inp)
    const routeSpread = doc.spreads.find(s => s.entryId === null && s.elements.some(e => e.kind === 'image'))!
    const images = routeSpread.elements.filter(e => e.kind === 'image')
    expect(images).toHaveLength(2)
  })

  it('FE-AUTOLAYOUT-022: no element in a route spread straddles the gutter — the map (left page) and the label+elevation (right page) each stand on their own leaf', () => {
    const inp = input({
      routeImagesByDate: new Map([['2026-04-02', { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: 'data:image/svg+xml;base64,BBBB', stats: FULL_STATS }]]),
    })
    const doc = buildBook(inp)
    const routeSpread = doc.spreads.find(s => s.entryId === null && s.elements.some(e => e.kind === 'image'))!
    for (const el of routeSpread.elements) {
      const crosses = el.frame.x < PAGE.pageWidth && el.frame.x + el.frame.w > PAGE.pageWidth
      expect(crosses, el.kind).toBe(false)
    }
  })

  it('FE-AUTOLAYOUT-024: a full stats line (distance, gain, loss, altitude range, slope, IBP) renders as one text element', () => {
    const inp = input({
      routeImagesByDate: new Map([['2026-04-02', { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: null, stats: FULL_STATS }]]),
    })
    const doc = buildBook(inp)
    const routeSpread = doc.spreads.find(s => s.entryId === null && s.elements.some(e => e.kind === 'image'))!
    const statsText = routeSpread.elements.find((e): e is Extract<typeof e, { kind: 'text' }> => e.kind === 'text' && (e as any).text.includes('km'))
    expect(statsText).toBeDefined()
    const text = (statsText as any).text as string
    expect(text).toContain('26.3 km')
    expect(text).toContain('843 m')
    expect(text).toContain('612 m')
    expect(text).toContain('12–621 m')
    expect(text).toContain('18%')
    expect(text).toContain('IBP 92')
  })

  it('FE-AUTOLAYOUT-025: with no elevation data on the track (all-zero stats), the stats line is skipped entirely (only the date label text remains)', () => {
    const inp = input({
      routeImagesByDate: new Map([['2026-04-02', { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: null, stats: EMPTY_STATS }]]),
    })
    const doc = buildBook(inp)
    const routeSpread = doc.spreads.find(s => s.entryId === null && s.elements.some(e => e.kind === 'image'))!
    const texts = routeSpread.elements.filter(e => e.kind === 'text')
    expect(texts).toHaveLength(1)
    expect((texts[0] as any).text).not.toContain('km')
  })
})

describe('estimateTextHeight', () => {
  it('FE-AUTOLAYOUT-017: grows with text length for a fixed box width', () => {
    const short = estimateTextHeight('A short line.', 172, 10, 1.6)
    const long = estimateTextHeight('A much longer paragraph '.repeat(20), 172, 10, 1.6)
    expect(long).toBeGreaterThan(short)
  })

  it('FE-AUTOLAYOUT-018: empty text has zero height', () => {
    expect(estimateTextHeight('   ', 172, 10, 1.6)).toBe(0)
  })

  it('FE-AUTOLAYOUT-019: a narrower box wraps the same text into more, taller lines', () => {
    const text = 'word '.repeat(60)
    const wide = estimateTextHeight(text, 172, 10, 1.6)
    const narrow = estimateTextHeight(text, 60, 10, 1.6)
    expect(narrow).toBeGreaterThan(wide)
  })
})

describe('buildBook — hero-story avoids a blank gap above its photo grid', () => {
  // Unit-tests tightenHeroStory directly against the hero-story template's
  // own output, rather than through buildBook/entrySpread — since the
  // reference templates (referenceTemplates.ts) are now tried first and a
  // 4-photo entry with a story is exactly what one of them (ref-6) also
  // wants, buildBook can no longer be relied on to land on hero-story
  // specifically for a fixture built to probe its own tightening logic.
  const heroStoryTpl = TEMPLATES.find(t => t.id === 'hero-story')!

  function heroStorySpread(story: string, page = PAGE): BookSpread {
    const elements: BookElement[] = [
      { id: 'p1', kind: 'photo', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, photoId: 1, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null },
      { id: 'p2', kind: 'photo', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, photoId: 2, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null },
      { id: 'p3', kind: 'photo', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, photoId: 3, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null },
      { id: 'p4', kind: 'photo', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, photoId: 4, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null },
      { id: 't1', kind: 'text', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, text: 'Day in Kyoto', font: 'sans', size: 22, weight: 700, italic: false, align: 'left', leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: true },
      { id: 't2', kind: 'text', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, text: 'April 2, 2026 · Kyoto', font: 'sans', size: 7.5, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: true },
      { id: 't3', kind: 'text', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false, text: story, font: 'sans', size: 10, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: true },
    ]
    const raw: BookSpread = { id: 'sp1', role: 'inner', background: null, elements, parked: [], entryId: 1 }
    return applyTemplate(raw, heroStoryTpl, page)
  }

  function heroStoryGridY(story: string, page = PAGE) {
    const laidOut = tightenHeroStory(heroStorySpread(story, page), page)
    const small = laidOut.elements.filter(e => e.kind === 'photo' && e.frame.w < page.pageWidth * 0.4)
    expect(small).toHaveLength(3)
    return Math.min(...small.map(e => e.frame.y))
  }

  it('FE-AUTOLAYOUT-020: a short story pulls the photo grid up, closer to the text', () => {
    const pinnedY = heroStoryGridY('A long story. '.repeat(120)) // fills the box — grid stays at its template position
    const shortY = heroStoryGridY('Just arrived.')
    expect(shortY).toBeLessThan(pinnedY)
  })

  it('FE-AUTOLAYOUT-023: on a page much taller than the template was tuned for, a short story still leaves a reasonable margin below the grid, not the whole extra height as dead space', () => {
    // Roughly Blurb's 8x10in portrait trim size — the report that surfaced
    // this ("se me va a dos páginas descojonadas" was the gutter bug; this
    // one showed up right after as "todo el hueco se va abajo") only shows
    // up once the page is meaningfully taller than the ~210mm square
    // default every template was written against.
    const tallPage = { ...PAGE, pageWidth: 203.2, pageHeight: 254 }
    const laidOut = tightenHeroStory(heroStorySpread('Just arrived.', tallPage), tallPage)
    const small = laidOut.elements.filter(e => e.kind === 'photo' && e.frame.w < tallPage.pageWidth * 0.4)
    expect(small).toHaveLength(3)
    const gridBottom = Math.max(...small.map(e => e.frame.y + e.frame.h))
    const marginBelow = tallPage.pageHeight - gridBottom
    // Before the centring fix this was the entire freed-up height (~120mm
    // on this page size) — bounding it well under half the page confirms
    // the leftover room is actually split, not dumped below the grid.
    expect(marginBelow).toBeLessThan(tallPage.pageHeight * 0.35)
  })
})

describe('buildBook — every auto-generated entry spread stands on its own single leaf', () => {
  // Single-leaf ("Páginas sueltas") export cuts a spread exactly at
  // page.pageWidth — a template picked here that straddles that line comes
  // out as two disconnected fragments on two separate sheets, which is
  // exactly the "queda fatal en todas" report this guards against.
  function crossesGutter(x: number, w: number, pageWidth: number) {
    return x < pageWidth && x + w > pageWidth
  }

  // Square (the old default), a tall portrait trim (roughly Blurb's
  // 8x10in) and a wide landscape one — crossesGutter is defined purely in
  // terms of page.pageWidth, but templateFit's scoring and the gridH/bandH/
  // etc. proportions inside each template's own build() all read
  // page.pageHeight too, so a page-shape change can plausibly pick a
  // different template or shift a slot enough to matter — worth the sweep
  // rather than assuming the square case generalises for free.
  const PAGE_SHAPES = [
    { ...PAGE, pageWidth: 210, pageHeight: 210 },
    { ...PAGE, pageWidth: 203.2, pageHeight: 254 },
    { ...PAGE, pageWidth: 254, pageHeight: 203.2 },
  ]

  it('FE-AUTOLAYOUT-021: no element in an auto-generated entry spread straddles the gutter, across a range of photo counts, story lengths and page shapes', () => {
    for (const page of PAGE_SHAPES) {
      for (let photoCount = 0; photoCount <= 9; photoCount++) {
        for (const story of ['', 'A short story.']) {
          const doc = buildBook(input({
            page,
            entries: [entry({ id: 1, story, photos: Array.from({ length: photoCount }, (_, i) => ({ photoId: i })) })],
          }))
          const spread = doc.spreads.find(s => s.entryId === 1)
          if (!spread) continue // no content at all (0 photos, no story) is skipped entirely — nothing to check
          for (const el of spread.elements) {
            expect(crossesGutter(el.frame.x, el.frame.w, page.pageWidth), `${page.pageWidth}x${page.pageHeight}, ${el.kind} in a ${photoCount}-photo${story ? '+story' : ''} spread`).toBe(false)
          }
        }
      }
    }
  })
})

describe('buildBook — pros/cons spread', () => {
  it('FE-AUTOLAYOUT-026: an entry with both pros and cons gets its own spread right after it, with a list element on each page', () => {
    const doc = buildBook(input({
      entries: [entry({ id: 1, prosCons: { pros: ['Great views'], cons: ['Rained all day'] } })],
    }))
    const entryIdx = doc.spreads.findIndex(s => s.entryId === 1)
    const pcSpread = doc.spreads[entryIdx + 1]
    expect(pcSpread.entryId).toBeNull()
    const lists = pcSpread.elements.filter(e => e.kind === 'list')
    expect(lists).toHaveLength(2)
  })

  it('FE-AUTOLAYOUT-027: an entry with only pros gets one list element, on the left page, nothing on the right', () => {
    const doc = buildBook(input({
      entries: [entry({ id: 1, prosCons: { pros: ['Great views'], cons: [] } })],
    }))
    const entryIdx = doc.spreads.findIndex(s => s.entryId === 1)
    const pcSpread = doc.spreads[entryIdx + 1]
    const lists = pcSpread.elements.filter(e => e.kind === 'list')
    expect(lists).toHaveLength(1)
    expect(lists[0].frame.x).toBeLessThan(PAGE.pageWidth)
  })

  it('FE-AUTOLAYOUT-028: an entry with no prosCons at all gets no extra spread', () => {
    const withPc = buildBook(input({ entries: [entry({ id: 1 })] })).spreads.length
    const without = buildBook(input({ entries: [entry({ id: 1, prosCons: undefined })] })).spreads.length
    expect(withPc).toBe(without)
  })

  it('FE-AUTOLAYOUT-029: an entry with prosCons present but both arrays empty gets no extra spread (blank strings don\'t count either)', () => {
    const without = buildBook(input({ entries: [entry({ id: 1 })] })).spreads.length
    const withEmpty = buildBook(input({ entries: [entry({ id: 1, prosCons: { pros: ['  '], cons: [] } })] })).spreads.length
    expect(withEmpty).toBe(without)
  })

  it('FE-AUTOLAYOUT-030: neither list element in a pros/cons spread straddles the gutter', () => {
    const doc = buildBook(input({
      entries: [entry({ id: 1, prosCons: { pros: ['Great views', 'Friendly locals'], cons: ['Rained all day', 'Expensive food'] } })],
    }))
    const entryIdx = doc.spreads.findIndex(s => s.entryId === 1)
    const pcSpread = doc.spreads[entryIdx + 1]
    for (const el of pcSpread.elements) {
      const crosses = el.frame.x < PAGE.pageWidth && el.frame.x + el.frame.w > PAGE.pageWidth
      expect(crosses, el.kind).toBe(false)
    }
  })
})

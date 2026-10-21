// FE-AUTOLAYOUT-001 to FE-AUTOLAYOUT-045
import { buildBook, emptyBook, estimateTextHeight, relayoutSpread, tightenHeroStory, pairPhotosToFrames, cropCost, stationsSpread, type AutoInput, type AutoEntry } from './autoLayout'
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

/** The summary that closes the content — the last inner spread, before the single last page and the back cover. */
function closingSpread(doc: ReturnType<typeof buildBook>) {
  const inner = doc.spreads.filter(s => s.role === 'inner')
  return inner[inner.length - 1]
}

describe('emptyBook', () => {
  it('FE-AUTOLAYOUT-001: a bound book\'s pages — cover, first page, one inner spread, last page, back cover — all empty', () => {
    const doc = emptyBook(PAGE, 'My Trip')
    expect(doc.title).toBe('My Trip')
    expect(doc.spreads.map(s => s.role)).toEqual(['cover', 'first', 'inner', 'last', 'back'])
    expect(doc.spreads.every(s => s.elements.length === 0)).toBe(true)
    // The single first page is page 1.
    expect(doc.page.pageNumbers?.startAt).toBe(1)
  })
})

describe('buildBook', () => {
  it('FE-AUTOLAYOUT-002: produces a cover, one spread per entry with content, and a closing spread', () => {
    const doc = buildBook(input())
    // cover, first page, 1 entry, summary, last page, back cover
    expect(doc.spreads.map(s => s.role)).toEqual(['cover', 'first', 'inner', 'inner', 'last', 'back'])
    expect(doc.spreads[2].entryId).toBe(1)
    expect(doc.spreads[1].elements).toEqual([]) // first page left for the author
    expect(doc.page.pageNumbers?.startAt).toBe(1)
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
    expect(entryIndices).toEqual([3, 4]) // cover, first page, route spread, then the day's entries
    expect(doc.spreads[2].elements.some(e => e.kind === 'image')).toBe(true)
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

describe('buildBook — closing summary spread', () => {
  // "Montañas Vacías" — a journey whose GPX never got matched to any
  // specific day (no gpx file per jornada) came out of the book with zero
  // maps anywhere: routeImagesByDate stayed empty (correctly, no per-day
  // spread), but the closing spread had no route content of its own to
  // fall back to either. overviewRoute is what JourneyStudioPage now
  // builds for exactly that gap — from every track when nothing matched a
  // day at all, or from just the leftover ones when some did.
  it('FE-AUTOLAYOUT-033: with no overviewRoute, the closing spread keeps its plain two-page poster — no image elements', () => {
    const doc = buildBook(input())
    const closing = closingSpread(doc)
    expect(closing.elements.some(e => e.kind === 'image')).toBe(false)
    const bg = closing.elements.find(e => e.kind === 'shape')!
    expect(bg.frame.w).toBeGreaterThan(PAGE.pageWidth) // spans both pages as one poster
  })

  it('FE-AUTOLAYOUT-034: an overviewRoute map is placed full-bleed on the closing spread\'s left page', () => {
    const doc = buildBook(input({
      overviewRoute: { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: null, stats: EMPTY_STATS },
    }))
    const closing = closingSpread(doc)
    const map = closing.elements.find(e => e.kind === 'image')
    expect(map).toBeDefined()
    expect(map!.frame.x).toBeLessThan(PAGE.pageWidth)
  })

  it('FE-AUTOLAYOUT-035: no element in the closing spread straddles the gutter when an overviewRoute is given', () => {
    const doc = buildBook(input({
      overviewRoute: { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: 'data:image/svg+xml;base64,BBBB', stats: FULL_STATS },
    }))
    const closing = closingSpread(doc)
    for (const el of closing.elements) {
      const crosses = el.frame.x < PAGE.pageWidth && el.frame.x + el.frame.w > PAGE.pageWidth
      expect(crosses, el.kind).toBe(false)
    }
  })

  it('FE-AUTOLAYOUT-036: an overviewRoute elevation profile is placed on the closing spread\'s right page', () => {
    const doc = buildBook(input({
      overviewRoute: { mapSrc: null, elevationSrc: 'data:image/svg+xml;base64,BBBB', stats: EMPTY_STATS },
    }))
    const closing = closingSpread(doc)
    const ele = closing.elements.find(e => e.kind === 'image')
    expect(ele).toBeDefined()
    expect(ele!.frame.x).toBeGreaterThanOrEqual(PAGE.pageWidth)
  })

  it('FE-AUTOLAYOUT-037: the closing spread\'s stats line shows the journey\'s true total distance/elevation, not just the (possibly leftover-only) overview map\'s own subset', () => {
    const doc = buildBook(input({
      journeyStats: { days: 5, entries: 3, photos: 20, places: 4, distanceKm: 26.33, elevationGainM: 843, elevationLossM: 612 },
      overviewRoute: { mapSrc: 'data:image/png;base64,AAAA', elevationSrc: null, stats: EMPTY_STATS },
    }))
    const closing = closingSpread(doc)
    const totalText = closing.elements.find((e): e is Extract<typeof e, { kind: 'text' }> => e.kind === 'text' && (e as any).text.includes('km'))
    expect(totalText).toBeDefined()
    expect((totalText as any).text).toContain('26.3 km')
  })

  it('FE-AUTOLAYOUT-038: with no route stats at all (no GPX anywhere in the journey), the closing spread has no distance/elevation line', () => {
    const doc = buildBook(input())
    const closing = closingSpread(doc)
    const totalText = closing.elements.find(e => e.kind === 'text' && (e as any).text.includes('km'))
    expect(totalText).toBeUndefined()
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

describe('buildBook — pros/cons footer', () => {
  // A spread of their own was two whole pages for two or three lines of
  // text on most entries ("un gasto ridículo de espacio") — pros/cons now
  // ride along on the entry's own page as a compact footer instead.
  it('FE-AUTOLAYOUT-026: pros and cons ride on the entry\'s own spread — never a spread of their own', () => {
    const withPc = buildBook(input({
      entries: [entry({ id: 1, prosCons: { pros: ['Great views'], cons: ['Rained all day'] } })],
    }))
    const without = buildBook(input({ entries: [entry({ id: 1, prosCons: undefined })] }))
    expect(withPc.spreads.length).toBe(without.spreads.length)

    const entrySpreadRow = withPc.spreads.find(s => s.entryId === 1)!
    const lists = entrySpreadRow.elements.filter(e => e.kind === 'list')
    expect(lists).toHaveLength(2)
  })

  it('FE-AUTOLAYOUT-027: an entry with only pros gets one list element, on the left page, nothing on the right', () => {
    const doc = buildBook(input({
      entries: [entry({ id: 1, prosCons: { pros: ['Great views'], cons: [] } })],
    }))
    const entrySpreadRow = doc.spreads.find(s => s.entryId === 1)!
    const lists = entrySpreadRow.elements.filter(e => e.kind === 'list')
    expect(lists).toHaveLength(1)
    expect(lists[0].frame.x).toBeLessThan(PAGE.pageWidth)
  })

  it('FE-AUTOLAYOUT-028: an entry with no prosCons at all gets no list element and no shrunk layout', () => {
    const withPc = buildBook(input({ entries: [entry({ id: 1 })] }))
    const without = buildBook(input({ entries: [entry({ id: 1, prosCons: undefined })] }))
    expect(withPc.spreads.length).toBe(without.spreads.length)
    const entrySpreadRow = without.spreads.find(s => s.entryId === 1)!
    expect(entrySpreadRow.elements.some(e => e.kind === 'list')).toBe(false)
  })

  it('FE-AUTOLAYOUT-029: an entry with prosCons present but both arrays empty gets no list element either (blank strings don\'t count)', () => {
    const doc = buildBook(input({ entries: [entry({ id: 1, prosCons: { pros: ['  '], cons: [] } })] }))
    const entrySpreadRow = doc.spreads.find(s => s.entryId === 1)!
    expect(entrySpreadRow.elements.some(e => e.kind === 'list')).toBe(false)
  })

  it('FE-AUTOLAYOUT-030: neither list element in the footer straddles the gutter', () => {
    const doc = buildBook(input({
      entries: [entry({ id: 1, prosCons: { pros: ['Great views', 'Friendly locals'], cons: ['Rained all day', 'Expensive food'] } })],
    }))
    const entrySpreadRow = doc.spreads.find(s => s.entryId === 1)!
    for (const el of entrySpreadRow.elements.filter(e => e.kind === 'list')) {
      const crosses = el.frame.x < PAGE.pageWidth && el.frame.x + el.frame.w > PAGE.pageWidth
      expect(crosses, el.kind).toBe(false)
    }
  })

  it('FE-AUTOLAYOUT-031: the footer sits below the entry\'s own readable content — no text/photo/list reaches into it', () => {
    // Decorative `shape` elements are exempt: some reference templates draw
    // one deliberately larger than the page (a circle cropped by the trim
    // edge) — ref-4's own ellipse already ran ~27mm past a real 210mm page
    // before this feature existed. Painted first (the back of the stack),
    // it never obscures anything; only content someone actually reads has
    // to stay clear of the footer.
    const doc = buildBook(input({
      entries: [entry({ id: 1, photos: [{ photoId: 1 }, { photoId: 2 }], prosCons: { pros: ['Great views', 'Friendly locals', 'Cheap food'], cons: ['Rained all day'] } })],
    }))
    const entrySpreadRow = doc.spreads.find(s => s.entryId === 1)!
    const footer = entrySpreadRow.elements.filter(e => e.kind === 'list' || (e.kind === 'text' && (e.text === 'Pros' || e.text === 'Cons')))
    const rest = entrySpreadRow.elements.filter(e => !footer.includes(e) && e.kind !== 'shape')
    expect(footer.length).toBeGreaterThan(0)
    const footerTop = Math.min(...footer.map(e => e.frame.y))
    for (const el of rest) {
      // A small tolerance for print bleed (elements are allowed to run past
      // the trim edge on purpose) — not for genuinely overlapping the footer.
      expect(el.frame.y + el.frame.h, el.kind).toBeLessThanOrEqual(footerTop + PAGE.bleed + 0.5)
    }
  })

  it('FE-AUTOLAYOUT-032: a long pros/cons list is capped rather than growing the footer past a third of the page', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Reason ${i}`)
    const doc = buildBook(input({ entries: [entry({ id: 1, prosCons: { pros: many, cons: many } })] }))
    const entrySpreadRow = doc.spreads.find(s => s.entryId === 1)!
    const list = entrySpreadRow.elements.find(e => e.kind === 'list')! as { items: unknown[] }
    expect(list.items.length).toBeLessThan(many.length)
    const footer = entrySpreadRow.elements.filter(e => e.kind === 'list' || (e.kind === 'text' && (e.text === 'Pros' || e.text === 'Cons')))
    const footerH = PAGE.pageHeight - Math.min(...footer.map(e => e.frame.y))
    expect(footerH).toBeLessThan(PAGE.pageHeight / 3)
  })
})

describe('shape-aware placement', () => {
  const portrait = (id: number) => ({ photoId: id, width: 3000, height: 4500 })
  const landscape = (id: number) => ({ photoId: id, width: 4500, height: 3000 })

  it('FE-AUTOLAYOUT-039: a portrait photo goes into the tallest frame, landscapes into the wide ones', () => {
    const frames = [{ w: 100, h: 60 }, { w: 40, h: 90 }, { w: 100, h: 55 }]
    const order = pairPhotosToFrames(frames, [landscape(1), portrait(2), landscape(3)])
    expect(order[1]).toBe(1) // the tall frame takes photo index 1, the portrait
    expect(new Set(order)).toEqual(new Set([0, 1, 2]))
  })

  it('FE-AUTOLAYOUT-040: photos with unknown size keep their order and cost nothing', () => {
    const frames = [{ w: 100, h: 60 }, { w: 40, h: 90 }]
    expect(pairPhotosToFrames(frames, [{ photoId: 1 }, { photoId: 2 }])).toEqual([0, 1])
    expect(cropCost(frames, [{ photoId: 1 }, { photoId: 2 }])).toBe(0)
  })

  it('FE-AUTOLAYOUT-041: the crop cost of a matched pairing is lower than the mismatched one', () => {
    const frames = [{ w: 40, h: 90 }, { w: 100, h: 60 }]
    const matched = cropCost(frames, [portrait(1), landscape(2)])
    const forced = cropCost([{ w: 100, h: 60 }, { w: 100, h: 60 }], [portrait(1), landscape(2)])
    expect(matched).toBeLessThan(forced)
  })

  it('FE-AUTOLAYOUT-042: the placed photo frames match the photos\' shapes on a portrait page', () => {
    const A4P = { ...PAGE, preset: 'a4-portrait' as const, pageWidth: 210, pageHeight: 297 }
    const doc = buildBook(input({ page: A4P, entries: [entry({ story: null, photos: [portrait(1), landscape(2)] })] }))
    const sp = doc.spreads.find(x => x.entryId === 1)!
    const placed = sp.elements.filter((e): e is Extract<BookElement, { kind: 'photo' }> => e.kind === 'photo' && e.photoId != null)
    const p1 = placed.find(e => e.photoId === 1)
    const p2 = placed.find(e => e.photoId === 2)
    expect(p1).toBeDefined()
    expect(p2).toBeDefined()
    expect(p1!.frame.h / p1!.frame.w).toBeGreaterThanOrEqual(p2!.frame.h / p2!.frame.w)
  })
})

describe('stations', () => {
  const bare = (id: number, title: string, date: string): AutoEntry => ({ id, title, story: null, location: null, date, photos: [] })

  it('FE-AUTOLAYOUT-043: consecutive stops with no photos and no story become one itinerary spread, in order', () => {
    const doc = buildBook(input({ stationsLabel: 'Etapas', entries: [entry({ id: 1 }), bare(2, 'Hakone', '2026-04-03'), bare(3, 'Nara', '2026-04-04'), entry({ id: 4, date: '2026-04-05' })] }))
    const inner = doc.spreads.filter(sp => sp.role === 'inner')
    const ids = inner.map(sp => sp.entryId)
    const stIdx = ids.indexOf(null)
    expect(ids.indexOf(1)).toBeLessThan(stIdx)
    expect(ids.indexOf(4)).toBeGreaterThan(stIdx)
    const texts = inner[stIdx].elements.filter(e => e.kind === 'text').map(e => (e as Extract<BookElement, { kind: 'text' }>).text)
    expect(texts).toEqual(expect.arrayContaining(['ETAPAS', 'Hakone', 'Nara']))
  })

  it('FE-AUTOLAYOUT-044: an entry with nothing at all — no name either — is still left out', () => {
    const doc = buildBook(input({ entries: [entry({ id: 1 }), { id: 9, title: null, story: null, location: null, date: null, photos: [] }] }))
    expect(doc.spreads.some(sp => sp.elements.some(e => e.kind === 'text' && (e as { text: string }).text.toUpperCase() === 'STATIONS'))).toBe(false)
  })

  it('FE-AUTOLAYOUT-045: a long run splits into spreads of at most 26 stops, each under the element cap, inside the page', () => {
    const many = Array.from({ length: 30 }, (_, k) => bare(100 + k, `Stop ${k}`, '2026-05-01'))
    const doc = buildBook(input({ entries: many }))
    const st = doc.spreads.filter(sp => sp.role === 'inner' && sp.entryId === null && sp.background === '#faf8f4')
    expect(st.length).toBe(2)
    for (const sp of st) {
      expect(sp.elements.length).toBeLessThanOrEqual(90)
      for (const el of sp.elements) expect(el.frame.y + el.frame.h).toBeLessThanOrEqual(PAGE.pageHeight)
    }
    const small = stationsSpread(many.slice(0, 26), input({ page: { ...PAGE, preset: 'a5-landscape', pageWidth: 210, pageHeight: 148 } }))
    for (const el of small.elements) expect(el.frame.y + el.frame.h).toBeLessThanOrEqual(148)
  })
})

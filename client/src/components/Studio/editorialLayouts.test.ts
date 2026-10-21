// FE-EDITORIAL-001 to FE-EDITORIAL-016
import { EDITORIAL_DESIGNS, editorialSpread, journeyDays, pickEditorialDesign, type EditorialEntry } from './editorialLayouts'
import type { BookElement, BookSpread } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }
const INPUT = { locale: 'es', page: PAGE, dayLabel: 'Día' }

function entry(overrides: Partial<EditorialEntry> = {}): EditorialEntry {
  return {
    id: 7, title: 'Lisboa', story: 'Subimos al mirador al atardecer.', location: 'Alfama',
    date: '2026-04-03', photos: [{ photoId: 1, width: 3000, height: 2000 }, { photoId: 2 }, { photoId: 3 }],
    lat: 38.7139, lng: -9.1334, country: 'pt', dayNumber: 3, dayCount: 9,
    ...overrides,
  }
}

const of = <K extends BookElement['kind']>(sp: BookSpread, kind: K) => sp.elements.filter((e): e is Extract<BookElement, { kind: K }> => e.kind === kind)

describe('editorialSpread', () => {
  it('FE-EDITORIAL-001: every design builds an inner spread tied to its entry', () => {
    for (const d of EDITORIAL_DESIGNS) {
      const sp = editorialSpread(entry(), INPUT, 0, d)
      expect(sp.role).toBe('inner')
      expect(sp.entryId).toBe(7)
      expect(sp.elements.length).toBeGreaterThan(3)
      // Unique ids within a spread — the editor selects by id.
      expect(new Set(sp.elements.map(e => e.id)).size).toBe(sp.elements.length)
    }
  })

  it('FE-EDITORIAL-002: every frame is a real, positive box that stays on the sheet (bleed allowed)', () => {
    for (const d of EDITORIAL_DESIGNS) {
      for (const idx of [0, 1]) {
        const sp = editorialSpread(entry(), INPUT, idx, d)
        for (const el of sp.elements) {
          const f = el.frame
          expect(Number.isFinite(f.x) && Number.isFinite(f.y) && f.w > 0 && f.h > 0).toBe(true)
          expect(f.x).toBeGreaterThanOrEqual(-PAGE.bleed - 0.01)
          expect(f.y).toBeGreaterThanOrEqual(-PAGE.bleed - 0.01)
          expect(f.x + f.w).toBeLessThanOrEqual(PAGE.pageWidth * 2 + PAGE.bleed + 0.01)
          expect(f.y + f.h).toBeLessThanOrEqual(PAGE.pageHeight + PAGE.bleed + 0.01)
        }
      }
    }
  })

  it('FE-EDITORIAL-003: the story and the title stay bound to the journal, so fixing a typo there fixes the book', () => {
    const sp = editorialSpread(entry(), INPUT, 0, 'story')
    const texts = of(sp, 'text')
    expect(texts.find(t => t.binding?.source === 'entry.story')?.text).toBe('Subimos al mirador al atardecer.')
    const title = texts.find(t => t.binding?.source === 'entry.title')
    expect(title?.text).toBe('Lisboa')
    expect(title?.overridden).toBe(false)
  })

  it('FE-EDITORIAL-004: the travel marks — flag row with the localised country name, coordinates, date numeral, day chip', () => {
    const sp = editorialSpread(entry(), INPUT, 0, 'story')
    const flag = of(sp, 'countries').find(c => c.showFlag)
    expect(flag?.codes).toEqual(['PT'])
    expect(flag?.names[0]).toBe('Portugal')
    const badges = of(sp, 'badge')
    // Coordinates are the place page's mark (and the immersive one's), not every page's.
    const place = of(editorialSpread(entry(), INPUT, 0, 'place'), 'badge')
    expect(place.find(b => b.variant === 'coords')?.text).toMatch(/38° 42' \d+" N/)
    const date = badges.find(b => b.variant === 'date')
    expect(date?.text).toBe('3')
    expect(date?.sub).toBe('ABRIL')
    expect(badges.find(b => b.variant === 'day')?.text).toBe('DÍA 3')
  })

  it('FE-EDITORIAL-005: the progress dot sits as far along the rule as the day is into the journey', () => {
    const sp = editorialSpread(entry({ dayNumber: 5, dayCount: 9 }), INPUT, 0, 'gallery')
    const dot = of(sp, 'shape').find(s => s.shape === 'ellipse')!
    const rule = of(sp, 'shape').find(s => s.frame.h === 0.3)!
    const centre = dot.frame.x + dot.frame.w / 2
    expect((centre - rule.frame.x) / rule.frame.w).toBeCloseTo(0.5, 2)
  })

  it('FE-EDITORIAL-006: no country, no coordinates, no dates — the marks are simply left out', () => {
    const sp = editorialSpread(entry({ country: null, lat: null, lng: null, date: null, dayNumber: null, dayCount: null }), INPUT, 0, 'story')
    expect(of(sp, 'countries')).toHaveLength(0)
    expect(of(sp, 'badge')).toHaveLength(0)
    expect(of(sp, 'shape').some(s => s.shape === 'ellipse')).toBe(false)
  })

  it('FE-EDITORIAL-007: a design with no photo still leaves an empty frame to drop one into', () => {
    for (const d of EDITORIAL_DESIGNS) {
      const sp = editorialSpread(entry({ photos: [] }), INPUT, 0, d)
      expect(of(sp, 'photo').some(p => p.photoId == null)).toBe(true)
    }
  })

  it('FE-EDITORIAL-008: the hand alternates — the hero photo changes page between neighbours', () => {
    const a = of(editorialSpread(entry(), INPUT, 0, 'story'), 'photo')[0]
    const b = of(editorialSpread(entry(), INPUT, 1, 'story'), 'photo')[0]
    expect(a.frame.x < PAGE.pageWidth).toBe(true)
    expect(b.frame.x >= PAGE.pageWidth).toBe(true)
  })

  it('FE-EDITORIAL-009: panorama and immersive run across the fold; panel puts a second photo across the join', () => {
    const pano = of(editorialSpread(entry(), INPUT, 0, 'pano'), 'photo')[0]
    expect(pano.frame.x < PAGE.pageWidth && pano.frame.x + pano.frame.w > PAGE.pageWidth).toBe(true)
    const imm = of(editorialSpread(entry(), INPUT, 0, 'immersive'), 'photo')[0]
    expect(imm.frame.w).toBeCloseTo(PAGE.pageWidth * 2 + PAGE.bleed * 2)
    const panel = of(editorialSpread(entry(), INPUT, 0, 'panel'), 'photo')
    expect(panel.some(p => p.photoId === 2 && p.frame.x < PAGE.pageWidth && p.frame.x + p.frame.w > PAGE.pageWidth)).toBe(true)
  })

  it('FE-EDITORIAL-010: never more than five photos on a spread, whatever the entry has', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ photoId: 100 + i }))
    for (const d of EDITORIAL_DESIGNS) {
      const ids = of(editorialSpread(entry({ photos: many }), INPUT, 0, d), 'photo').map(p => p.photoId).filter(Boolean)
      expect(ids.length).toBeLessThanOrEqual(5)
      expect(ids.every(id => (id as number) < 105)).toBe(true)
    }
  })

  it('FE-EDITORIAL-011: scales to a small trim — a 148 mm page keeps every frame on the sheet', () => {
    const small = { ...PAGE, pageWidth: 148, pageHeight: 148 }
    for (const d of EDITORIAL_DESIGNS) {
      for (const el of editorialSpread(entry(), { ...INPUT, page: small }, 0, d).elements) {
        expect(el.frame.x + el.frame.w).toBeLessThanOrEqual(small.pageWidth * 2 + small.bleed + 0.01)
        expect(el.frame.y + el.frame.h).toBeLessThanOrEqual(small.pageHeight + small.bleed + 0.01)
      }
    }
  })
})

describe('pickEditorialDesign', () => {
  it('FE-EDITORIAL-012: a bare stop gets the place page, a panorama the fold, the rest rotate without opening loud', () => {
    expect(pickEditorialDesign(entry({ photos: [], story: '' }), 3)).toBe('place')
    expect(pickEditorialDesign(entry({ photos: [{ photoId: 1, width: 6000, height: 2000 }] }), 1)).toBe('pano')
    expect(pickEditorialDesign(entry(), 0)).not.toBe('immersive')
    const picks = new Set([0, 1, 2, 3, 4, 5].map(i => pickEditorialDesign(entry(), i)))
    expect(picks.size).toBeGreaterThanOrEqual(4)
  })
})

describe('journeyDays', () => {
  it('FE-EDITORIAL-013: day 1 is the earliest date, the count runs to the latest — gaps still count', () => {
    const d = journeyDays(['2026-04-05', null, '2026-04-01', '2026-04-03'])
    expect(d.count).toBe(5)
    expect(d.dayOf('2026-04-01')).toBe(1)
    expect(d.dayOf('2026-04-05')).toBe(5)
    expect(d.dayOf(null)).toBeNull()
  })

  it('FE-EDITORIAL-014: an undated journey has no days at all', () => {
    const d = journeyDays([null, null])
    expect(d.count).toBeNull()
    expect(d.dayOf('2026-04-01')).toBeNull()
  })
})

describe('foot clearance', () => {
  it('FE-EDITORIAL-015: no photo runs into the day chip and progress rule along the foot', () => {
    for (const d of EDITORIAL_DESIGNS) {
      if (d === 'immersive') continue // full-bleed by design, no foot marks
      for (const idx of [0, 1]) {
        const sp = editorialSpread(entry({ photos: [1, 2, 3, 4, 5].map(i => ({ photoId: i })) }), INPUT, idx, d)
        const chip = sp.elements.find(e => e.kind === 'badge' && e.variant === 'day')
        if (!chip) continue
        const overlaps = sp.elements.filter(e => (e.kind === 'photo' && e.frame.w < PAGE.pageWidth * 0.9) || (e.kind === 'countries' && e.opacity === 1)).filter(p =>
          p.frame.x < chip.frame.x + chip.frame.w && p.frame.x + p.frame.w > chip.frame.x &&
          p.frame.y < chip.frame.y + chip.frame.h && p.frame.y + p.frame.h > chip.frame.y)
        expect(overlaps.map(() => d)).toEqual([])
      }
    }
  })
})

describe('contrast', () => {
  it('FE-EDITORIAL-016: on the dark panel the day chip takes the accent, not ink', () => {
    const chip = (d: 'panel' | 'story') => editorialSpread(entry(), INPUT, 0, d).elements.find(e => e.kind === 'badge' && e.variant === 'day') as { accent: string }
    expect(chip('panel').accent).toBe('#c2410c')
    expect(chip('story').accent).toBe('#1a1a1a')
  })
})

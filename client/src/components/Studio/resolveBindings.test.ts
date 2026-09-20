// FE-RESOLVEBIND-001 to FE-RESOLVEBIND-007
import { resolveBindings, coordValue, type BindingSource } from './resolveBindings'
import type { BookDocument, BookTextElement, BookTextBinding, BookSpread } from '../../types/book'

function boundText(id: string, text: string, binding: BookTextBinding | null, overridden = false): BookTextElement {
  return {
    id, kind: 'text', frame: { x: 0, y: 0, w: 50, h: 10 }, rotation: 0, opacity: 1, locked: false,
    text, font: 'sans', size: 10, weight: 400, italic: false, align: 'left', leading: 1.2, tracking: 0,
    color: '#111827', binding, overridden,
  }
}

function spread(id: string, elements: BookTextElement[]): BookSpread {
  return { id, role: 'inner', background: null, elements, parked: [], entryId: null }
}

function docWith(elements: BookTextElement[]): BookDocument {
  return {
    version: 1,
    title: 't',
    page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
    spreads: [spread('s1', elements)],
  }
}

const baseSource: BindingSource = {
  title: 'My Trip',
  subtitle: 'A journey',
  entries: [
    { id: 1, title: 'Day 1', story: 'It was great', location: 'Paris', date: '2026-05-28', lat: 48.8566, lng: 2.3522 },
  ],
  photos: [{ photoId: 1, caption: 'Nice photo' }],
}

describe('resolveBindings', () => {
  it('FE-RESOLVEBIND-001: a missing/deleted source value never blanks existing text', () => {
    const el = boundText('e1', 'Old Title', { source: 'entry.title', entryId: 999 })
    const doc = docWith([el])
    const result = resolveBindings(doc, baseSource, 'en')
    expect((result.spreads[0].elements[0] as BookTextElement).text).toBe('Old Title')
  })

  it('FE-RESOLVEBIND-002: overridden true permanently severs the link, even when the source changed', () => {
    const el = boundText('e1', 'Stale Title', { source: 'journey.title' }, true)
    const doc = docWith([el])
    const result = resolveBindings(doc, baseSource, 'en')
    expect((result.spreads[0].elements[0] as BookTextElement).text).toBe('Stale Title')
    expect(result).toBe(doc)
  })

  it('FE-RESOLVEBIND-003: journey.title resolves and updates plain text', () => {
    const el = boundText('e1', 'Old', { source: 'journey.title' })
    const doc = docWith([el])
    const result = resolveBindings(doc, baseSource, 'en')
    expect((result.spreads[0].elements[0] as BookTextElement).text).toBe('My Trip')
  })

  it('FE-RESOLVEBIND-004: entry.date only re-resolves when the stored raw value differs from the source date', () => {
    const upToDate = boundText('e1', 'May 28, 2026', { source: 'entry.date', entryId: 1, value: '2026-05-28' })
    const docSame = docWith([upToDate])
    const resultSame = resolveBindings(docSame, baseSource, 'en')
    expect(resultSame).toBe(docSame)

    const stale = boundText('e1', 'old text', { source: 'entry.date', entryId: 1, value: '2026-01-01' })
    const docStale = docWith([stale])
    const resultStale = resolveBindings(docStale, baseSource, 'en')
    const updated = resultStale.spreads[0].elements[0] as BookTextElement
    expect(updated.text).toContain('2026')
    expect(updated.binding?.value).toBe('2026-05-28')
  })

  it('FE-RESOLVEBIND-005: entry.location with a coord format compares against the raw coordinate value, not the formatted string', () => {
    const value = coordValue(48.8566, 2.3522)
    const upToDate = boundText('e1', "48° 51' 24\" N   2° 21' 8\" E", { source: 'entry.location', entryId: 1, format: 'dms', value })
    const doc = docWith([upToDate])
    const result = resolveBindings(doc, baseSource, 'en')
    expect(result).toBe(doc)
  })

  it('FE-RESOLVEBIND-006: returns the exact same document reference when nothing changed', () => {
    const el = boundText('e1', 'My Trip', { source: 'journey.title' })
    const doc = docWith([el])
    const result = resolveBindings(doc, baseSource, 'en')
    expect(result).toBe(doc)
  })

  it('FE-RESOLVEBIND-007: only touched spreads are replaced; untouched spreads keep identity', () => {
    const stale = boundText('e1', 'Old', { source: 'journey.title' })
    const fresh = boundText('e2', 'A journey', { source: 'journey.subtitle' })
    const doc: BookDocument = {
      version: 1,
      title: 't',
      page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
      spreads: [spread('s1', [stale]), spread('s2', [fresh])],
    }
    const result = resolveBindings(doc, baseSource, 'en')
    expect(result).not.toBe(doc)
    expect(result.spreads[0]).not.toBe(doc.spreads[0])
    expect(result.spreads[1]).toBe(doc.spreads[1])
  })
})

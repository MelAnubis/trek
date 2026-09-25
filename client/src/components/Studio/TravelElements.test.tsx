// FE-TRAVELELEMENTS-001 to FE-TRAVELELEMENTS-027
import { render } from '@testing-library/react'
import { ElementView } from './SpreadView'
import { formatMetricValue } from './TravelElements'
import type { BookAccommodationElement, BookBadgeElement, BookIconElement, BookListElement, BookMapElement, BookPackingElement, BookPlacesElement, BookStatsElement } from '../../types/book'

const base = { id: 'el-1', frame: { x: 0, y: 0, w: 40, h: 40 }, rotation: 0, opacity: 1, locked: false }
const typeset = { font: 'sans' as const, color: '#1a1a1a', accent: '#111111' }

function statsEl(overrides: Partial<BookStatsElement> = {}): BookStatsElement {
  return {
    ...base, ...typeset, kind: 'stats', metrics: ['distance', 'days'], layout: 'grid', showIcons: true,
    units: 'metric', currency: null, values: { distance: 26330, days: 5 }, ...overrides,
  }
}

function placesEl(overrides: Partial<BookPlacesElement> = {}): BookPlacesElement {
  return {
    ...base, ...typeset, kind: 'places',
    places: [{ name: 'Reykjavik', note: 'Blue Lagoon' }, { name: 'Oslo' }],
    layout: 'list', align: 'center', ...overrides,
  }
}

function badgeEl(overrides: Partial<BookBadgeElement> = {}): BookBadgeElement {
  return { ...base, ...typeset, kind: 'badge', variant: 'date', text: '13', sub: 'April', code: null, style: 'plain', ...overrides }
}

function iconEl(overrides: Partial<BookIconElement> = {}): BookIconElement {
  return { ...base, kind: 'icon', name: 'Compass', color: '#111827', lineWidth: 2, ...overrides }
}

function listEl(overrides: Partial<BookListElement> = {}): BookListElement {
  return {
    ...base, ...typeset, kind: 'list',
    items: [{ text: 'Great views', tone: 'pro' }, { text: 'Rained all day', tone: 'con' }],
    layout: 'columns', showMarks: true, proLabel: 'Pros', conLabel: 'Cons', ...overrides,
  }
}

function mapEl(overrides: Partial<BookMapElement> = {}): BookMapElement {
  return { ...base, kind: 'map', src: null, fit: 'cover', radius: 0, ...overrides }
}

function packingEl(overrides: Partial<BookPackingElement> = {}): BookPackingElement {
  return {
    ...base, ...typeset, kind: 'packing',
    items: [{ name: 'Passport', category: 'Documents', checked: true, quantity: 1 }, { name: 'Socks', category: 'Clothes', checked: false, quantity: 4 }],
    groupByCategory: true, showQuantity: true, columns: 2, ...overrides,
  }
}

function accommodationEl(overrides: Partial<BookAccommodationElement> = {}): BookAccommodationElement {
  return {
    ...base, ...typeset, kind: 'accommodation',
    stays: [{ name: 'Hotel Roma', address: 'Rome', checkIn: '2026-04-01', checkOut: '2026-04-04', confirmation: 'XYZ123' }],
    showConfirmation: true, layout: 'cards', ...overrides,
  }
}

describe('formatMetricValue', () => {
  it('FE-TRAVELELEMENTS-001: distance in metres formats to whole kilometres by default', () => {
    expect(formatMetricValue('distance', 26330, 'metric')).toBe('26 km')
  })

  it('FE-TRAVELELEMENTS-002: distance converts to miles under imperial units', () => {
    expect(formatMetricValue('distance', 26330, 'imperial')).toBe('16 mi')
  })

  it('FE-TRAVELELEMENTS-003: a non-distance metric is a plain rounded count regardless of units', () => {
    expect(formatMetricValue('days', 5, 'metric')).toBe('5')
    expect(formatMetricValue('photos', 1234, 'imperial')).toBe('1,234')
  })

  it('FE-TRAVELELEMENTS-017: elevation gain/loss in metres formats to whole metres under metric units', () => {
    expect(formatMetricValue('elevationGain', 843, 'metric')).toBe('843 m')
    expect(formatMetricValue('elevationLoss', 621, 'metric')).toBe('621 m')
  })

  it('FE-TRAVELELEMENTS-018: elevation gain/loss converts to feet under imperial units', () => {
    expect(formatMetricValue('elevationGain', 843, 'imperial')).toBe('2,766 ft')
  })

  it('FE-TRAVELELEMENTS-019: budget formats as a currency amount using the element\'s own ISO code', () => {
    expect(formatMetricValue('budget', 1240, 'metric', 'EUR')).toBe('€1,240')
    expect(formatMetricValue('budget', 1240, 'metric', 'USD')).toBe('$1,240')
  })

  it('FE-TRAVELELEMENTS-020: budget falls back to a plain rounded number when no currency is set', () => {
    expect(formatMetricValue('budget', 1240.6, 'metric', null)).toBe('1,241')
    expect(formatMetricValue('budget', 1240.6, 'metric')).toBe('1,241')
  })

  it('FE-TRAVELELEMENTS-021: budget falls back to a plain suffixed number for a currency Intl doesn\'t recognise, rather than throwing', () => {
    expect(formatMetricValue('budget', 500, 'metric', 'XXX_NOT_REAL')).toBe('500 XXX_NOT_REAL')
  })
})

describe('StatsView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-004: only renders metrics that actually have a value', () => {
    const { container } = render(<ElementView el={statsEl({ metrics: ['distance', 'days', 'photos'], values: { distance: 1000, days: 3 } })} big />)
    expect(container.textContent).toContain('Distance')
    expect(container.textContent).toContain('Days')
    expect(container.textContent).not.toContain('Photos')
  })

  it('FE-TRAVELELEMENTS-005: showIcons false renders no lucide <svg> icons', () => {
    const { container } = render(<ElementView el={statsEl({ showIcons: false })} big />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })
})

describe('PlacesView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-006: renders every place\'s name', () => {
    const { container } = render(<ElementView el={placesEl()} big />)
    expect(container.textContent).toContain('Reykjavik')
    expect(container.textContent).toContain('Oslo')
  })

  it('FE-TRAVELELEMENTS-007: a place with a note renders it alongside the name', () => {
    const { container } = render(<ElementView el={placesEl()} big />)
    expect(container.textContent).toContain('Blue Lagoon')
  })

  it('FE-TRAVELELEMENTS-008: a place with no note renders just the name, no stray empty line', () => {
    const { container } = render(<ElementView el={placesEl({ places: [{ name: 'Oslo' }] })} big />)
    expect(container.textContent).toBe('Oslo')
  })
})

describe('BadgeView (via ElementView)', () => {
  it.each(['plain', 'chip', 'outline', 'stacked'] as const)('FE-TRAVELELEMENTS-009: style "%s" renders both the text and the sub-line', style => {
    const { container } = render(<ElementView el={badgeEl({ style })} big />)
    expect(container.textContent).toContain('13')
    expect(container.textContent).toContain('April')
  })

  it('FE-TRAVELELEMENTS-010: an empty sub renders no extra empty line', () => {
    const { container } = render(<ElementView el={badgeEl({ sub: '' })} big />)
    expect(container.textContent).toBe('13')
  })
})

describe('IconView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-011: a recognised lucide name renders an <svg>', () => {
    const { container } = render(<ElementView el={iconEl({ name: 'Compass' })} big />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('FE-TRAVELELEMENTS-012: an unrecognised name renders nothing rather than throwing', () => {
    expect(() => render(<ElementView el={iconEl({ name: 'NotARealLucideIcon' })} big />)).not.toThrow()
  })
})

describe('ListView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-013: columns layout puts pro items and con items in separate columns', () => {
    const { container } = render(<ElementView el={listEl()} big />)
    expect(container.textContent).toContain('Great views')
    expect(container.textContent).toContain('Rained all day')
    expect(container.textContent).toContain('Pros')
    expect(container.textContent).toContain('Cons')
  })

  it('FE-TRAVELELEMENTS-014: stacked layout renders every item in document order, ignoring tone grouping', () => {
    const { container } = render(<ElementView el={listEl({ layout: 'stacked', items: [{ text: 'First', tone: 'pro' }, { text: 'Second', tone: 'con' }] })} big />)
    const idxFirst = container.textContent!.indexOf('First')
    const idxSecond = container.textContent!.indexOf('Second')
    expect(idxFirst).toBeGreaterThanOrEqual(0)
    expect(idxSecond).toBeGreaterThan(idxFirst)
  })
})

describe('MapView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-015: with no src yet, renders a placeholder rather than a broken <img>', () => {
    const { container } = render(<ElementView el={mapEl()} big />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('FE-TRAVELELEMENTS-016: with a src, renders a plain <img> — self-contained, no live fetch', () => {
    const { container } = render(<ElementView el={mapEl({ src: 'data:image/png;base64,AAAA' })} big />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })
})

describe('PackingView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-022: groupByCategory groups items under their category headings', () => {
    const { container } = render(<ElementView el={packingEl()} big />)
    expect(container.textContent).toContain('Documents')
    expect(container.textContent).toContain('Passport')
    expect(container.textContent).toContain('Clothes')
    expect(container.textContent).toContain('Socks')
  })

  it('FE-TRAVELELEMENTS-023: showQuantity renders a ×N badge only for quantities greater than 1', () => {
    const { container } = render(<ElementView el={packingEl()} big />)
    expect(container.textContent).toContain('×4')
    expect(container.textContent).not.toContain('×1')
  })

  it('FE-TRAVELELEMENTS-024: groupByCategory false renders every item flat, with no category heading', () => {
    const { container } = render(<ElementView el={packingEl({ groupByCategory: false })} big />)
    expect(container.textContent).not.toContain('Documents')
    expect(container.textContent).not.toContain('Clothes')
    expect(container.textContent).toContain('Passport')
    expect(container.textContent).toContain('Socks')
  })
})

describe('AccommodationView (via ElementView)', () => {
  it('FE-TRAVELELEMENTS-025: renders a stay\'s name, address and confirmation number', () => {
    const { container } = render(<ElementView el={accommodationEl()} big />)
    expect(container.textContent).toContain('Hotel Roma')
    expect(container.textContent).toContain('Rome')
    expect(container.textContent).toContain('XYZ123')
  })

  it('FE-TRAVELELEMENTS-026: showConfirmation false hides the confirmation number', () => {
    const { container } = render(<ElementView el={accommodationEl({ showConfirmation: false })} big />)
    expect(container.textContent).not.toContain('XYZ123')
  })

  it('FE-TRAVELELEMENTS-027: a stay with no address renders no stray empty line for it', () => {
    const { container } = render(<ElementView el={accommodationEl({ stays: [{ name: 'Cabin' }], showConfirmation: false })} big />)
    expect(container.textContent).toBe('Cabin')
  })
})

// FE-ALBUMBROWSER-001 to FE-ALBUMBROWSER-010
import { albumSections, albumYear, filterAlbums, overlapsRange, sortAlbums, type PickerAlbum } from './albumBrowser'

const al = (id: string, albumName: string, extra: Partial<PickerAlbum> = {}): PickerAlbum => ({ id, albumName, assetCount: 10, ...extra })

// The real names from the screenshot that prompted this.
const NAMES = [
  al('a', '2019 07 Danubio', { assetCount: 373 }),
  al('b', '2020 Montañas Vacías', { assetCount: 134 }),
  al('c', '2023 07 velodyssee y Velosud', { assetCount: 194 }),
  al('d', 'Vias Verdes Plazaola y Bidasoa', { assetCount: 103 }),
  al('e', 'Vía de la plata', { assetCount: 334 }),
]

describe('albumYear', () => {
  it('FE-ALBUMBROWSER-001: prefers the provider date, then a year in the name, else null', () => {
    expect(albumYear(al('x', '2019 07 Danubio', { startDate: '2021-05-02T00:00:00Z' }))).toBe(2021)
    expect(albumYear(al('x', '2019 07 Danubio'))).toBe(2019)
    expect(albumYear(al('x', 'Verano 2022 en Asturias'))).toBe(2022)
    expect(albumYear(al('x', 'Vía de la plata'))).toBeNull()
    expect(albumYear(al('x', 'IMG 12019 test'))).toBeNull()
  })
})

describe('sortAlbums', () => {
  it('FE-ALBUMBROWSER-002: recent puts the newest first (year + month from the name) and undated last, by name', () => {
    expect(sortAlbums(NAMES, 'recent').map(a => a.id)).toEqual(['c', 'b', 'a', 'e', 'd'])
  })
  it('FE-ALBUMBROWSER-003: name is alphabetical and accent-insensitive; size is most photos first', () => {
    expect(sortAlbums(NAMES, 'name').map(a => a.id)).toEqual(['a', 'b', 'c', 'e', 'd'])
    expect(sortAlbums(NAMES, 'size').map(a => a.id)).toEqual(['a', 'e', 'c', 'b', 'd'])
  })
})

describe('filterAlbums', () => {
  it('FE-ALBUMBROWSER-004: matches every word, ignoring accents and case', () => {
    expect(filterAlbums(NAMES, 'via').map(a => a.id)).toEqual(['d', 'e'])
    expect(filterAlbums(NAMES, 'MONTANAS vac').map(a => a.id)).toEqual(['b'])
    expect(filterAlbums(NAMES, '  ')).toHaveLength(5)
  })
})

describe('overlapsRange', () => {
  it('FE-ALBUMBROWSER-005: overlap by the album\'s own dates; no dates never matches', () => {
    const a = al('x', 'Cid', { startDate: '2026-06-01T08:00:00Z', endDate: '2026-06-12T20:00:00Z' })
    expect(overlapsRange(a, '2026-06-10', '2026-06-20')).toBe(true)
    expect(overlapsRange(a, '2026-06-13', '2026-06-20')).toBe(false)
    expect(overlapsRange(al('y', '2026 Cid'), '2026-06-10', '2026-06-20')).toBe(false)
    expect(overlapsRange(a, '', '')).toBe(false)
  })
})

describe('albumSections', () => {
  const opts = { sort: 'recent' as const, query: '', tripFrom: '', tripTo: '' }

  it('FE-ALBUMBROWSER-006: recent groups by year, newest first, undated last', () => {
    expect(albumSections(NAMES, opts).map(s => s.key)).toEqual(['2023', '2020', '2019', 'undated'])
  })

  it('FE-ALBUMBROWSER-007: albums overlapping the journey come first, and only there', () => {
    const cid = al('cid', 'Camino del Cid', { startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-12T00:00:00Z' })
    const s = albumSections([...NAMES, cid], { ...opts, tripFrom: '2026-06-05', tripTo: '2026-06-15' })
    expect(s[0]).toEqual({ key: 'trip', albums: [cid] })
    expect(s.flatMap(x => x.albums).filter(a => a.id === 'cid')).toHaveLength(1)
  })

  it('FE-ALBUMBROWSER-008: sorting by name or size is one flat list', () => {
    expect(albumSections(NAMES, { ...opts, sort: 'name' }).map(s => s.key)).toEqual(['all'])
    expect(albumSections(NAMES, { ...opts, sort: 'size' })[0].albums[0].id).toBe('a')
  })

  it('FE-ALBUMBROWSER-009: a search flattens to results, without the trip section', () => {
    const s = albumSections(NAMES, { ...opts, query: 'via' })
    expect(s.map(x => x.key)).toEqual(['all'])
    expect(s[0].albums.map(a => a.id).sort()).toEqual(['d', 'e'])
  })

  it('FE-ALBUMBROWSER-010: nothing found is no sections at all', () => {
    expect(albumSections(NAMES, { ...opts, query: 'zzz' })).toEqual([])
    expect(albumSections([], opts)).toEqual([])
  })
})

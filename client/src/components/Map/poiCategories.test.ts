// FE-POICATS-001 to FE-POICATS-003
import { POI_CATEGORIES, POI_CATEGORY_BY_KEY, poiDisplayName } from './poiCategories'
import { buildPoiPopupHtml } from './placePopup'

const t = (k: string) => `T(${k})`

describe('poiCategories', () => {
  it('FE-POICATS-001: the bikepacking categories are offered, with keys the server knows (CATEGORY_OSM_FILTERS)', () => {
    const keys = POI_CATEGORIES.map(c => c.key)
    expect(keys).toEqual(expect.arrayContaining(['water', 'camping', 'supermarket', 'bike_shop']))
    expect(new Set(keys).size).toBe(keys.length)
    expect(POI_CATEGORY_BY_KEY.water.labelKey).toBe('poi.cat.water')
  })

  it('FE-POICATS-002: an unnamed POI (a fountain) is called by its category; a named one keeps its name', () => {
    expect(poiDisplayName({ name: '', category: 'water' }, t)).toBe('T(poi.cat.water)')
    expect(poiDisplayName({ name: '  ', category: 'camping' }, t)).toBe('T(poi.cat.camping)')
    expect(poiDisplayName({ name: 'Fuente del Rey', category: 'water' }, t)).toBe('Fuente del Rey')
    expect(poiDisplayName({ name: '', category: 'unknown' }, t)).toBe('')
  })

  it('FE-POICATS-003: the hover card shows the display name, escaped', () => {
    const poi = { osm_id: 'n1', name: '', lat: 0, lng: 0, category: 'water', poi_type: 'drinking_water', address: null, website: null, phone: null, opening_hours: null, cuisine: null, source: 'openstreetmap' as const }
    expect(buildPoiPopupHtml(poi, 'Agua <potable>')).toContain('Agua &lt;potable&gt;')
  })
})

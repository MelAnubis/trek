// FE-PLACEABOUT-001 to FE-PLACEABOUT-005
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import PlaceAbout, { factLabel } from './PlaceAbout'
import { mapsApi } from '../../api/client'

vi.mock('../../api/client', () => ({ mapsApi: { enrich: vi.fn() } }))

const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(',')}` : k)
let seq = 0
const place = (o: Record<string, unknown> = {}) => ({ id: 1000 + ++seq, name: 'Alhambra', lat: 37.17, lng: -3.58, osm_id: 'way:1', ...o })

const FULL = {
  description: { text: 'La Alhambra es una ciudad palatina andalusí situada en Granada. '.repeat(8), source: 'wikipedia', sourceUrl: 'https://es.wikipedia.org/wiki/Alhambra', license: 'CC BY-SA 4.0', lang: 'es' },
  facts: [{ kind: 'elevation', value: 740 }, { kind: 'century', value: 13 }, { kind: 'website', value: 'https://alhambra.org' }, { kind: 'wikidata', value: 'https://www.wikidata.org/wiki/Q1' }],
  photos: [{ thumbUrl: 'https://upload.wikimedia.org/t.jpg', fullUrl: 'https://upload.wikimedia.org/f.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', title: 'A.jpg', author: 'Ana Pérez', license: 'CC BY-SA 4.0', licenseUrl: null }],
}

afterEach(() => vi.mocked(mapsApi.enrich).mockReset())

describe('PlaceAbout', () => {
  it('FE-PLACEABOUT-001: asks with the place\'s OSM id, coordinates, language and category, and shows text, facts and credited photos', async () => {
    vi.mocked(mapsApi.enrich).mockResolvedValue(FULL)
    const p = place()
    render(<PlaceAbout place={p} categoryName="Monumento" language="es" locale="es-ES" t={t} />)
    await screen.findByText(/ciudad palatina/)
    expect(mapsApi.enrich).toHaveBeenCalledWith({ name: 'Alhambra', lat: 37.17, lng: -3.58, osm_id: 'way:1', lang: 'es', kind: 'Monumento' })
    expect(screen.getByText('Wikipedia').closest('a')?.getAttribute('href')).toBe('https://es.wikipedia.org/wiki/Alhambra')
    expect(document.querySelector('[data-fact="elevation"]')?.textContent).toBe('place.about.elevation:740')
    expect(document.querySelector('[data-fact="century"]')?.textContent).toBe('place.about.century:XIII')
    expect(screen.getByText('place.about.website').closest('a')?.getAttribute('href')).toBe('https://alhambra.org')
    expect(screen.getByText('Ana Pérez · CC BY-SA 4.0')).toBeTruthy()
    expect(screen.getByAltText('A.jpg').getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('FE-PLACEABOUT-002: a long text is clamped behind "show more"', async () => {
    vi.mocked(mapsApi.enrich).mockResolvedValue(FULL)
    render(<PlaceAbout place={place()} language="es" locale="es" t={t} />)
    const more = await screen.findByText('place.about.more')
    fireEvent.click(more)
    expect(screen.getByText('place.about.less')).toBeTruthy()
  })

  it('FE-PLACEABOUT-003: nothing found, disabled or an error — no section at all', async () => {
    for (const r of [{ description: null, facts: [], photos: [] }, { description: null, facts: [], photos: [], disabled: true }]) {
      vi.mocked(mapsApi.enrich).mockResolvedValueOnce(r)
      const { container, unmount } = render(<PlaceAbout place={place()} language="es" locale="es" t={t} />)
      await waitFor(() => expect(mapsApi.enrich).toHaveBeenCalled())
      await waitFor(() => expect(container.querySelector('[data-testid="place-about-loading"]')).toBeNull())
      expect(container.querySelector('section')).toBeNull()
      unmount(); vi.mocked(mapsApi.enrich).mockClear()
    }
    vi.mocked(mapsApi.enrich).mockRejectedValueOnce(new Error('500'))
    const { container } = render(<PlaceAbout place={place()} language="es" locale="es" t={t} />)
    await waitFor(() => expect(container.querySelector('[data-testid="place-about-loading"]')).toBeNull())
    expect(container.querySelector('section')).toBeNull()
  })

  it('FE-PLACEABOUT-004: a place with neither OSM id nor coordinates is never looked up', async () => {
    render(<PlaceAbout place={place({ osm_id: null, lat: null, lng: null })} language="es" locale="es" t={t} />)
    await new Promise(r => setTimeout(r, 300))
    expect(mapsApi.enrich).not.toHaveBeenCalled()
  })

  it('FE-PLACEABOUT-005: fact labels — thousands separators, BC years and centuries', () => {
    expect(factLabel({ kind: 'population', value: 684234 }, t, 'es-ES')).toBe('place.about.population:684.234')
    expect(factLabel({ kind: 'inception', value: -200 }, t, 'es')).toBe('place.about.foundedBC:200')
    expect(factLabel({ kind: 'century', value: -3 }, t, 'es')).toBe('place.about.centuryBC:III')
    expect(factLabel({ kind: 'website', value: 'https://x' }, t, 'es')).toBeNull()
  })
})

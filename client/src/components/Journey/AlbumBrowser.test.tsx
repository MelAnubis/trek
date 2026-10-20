// FE-COMP-ALBUMBROWSER-001 to FE-COMP-ALBUMBROWSER-006
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AlbumBrowser, albumCoverUrl, normalizeAlbums } from './AlbumBrowser'

const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(',')}` : k)
const ALBUMS = normalizeAlbums([
  { id: 'a', albumName: '2019 07 Danubio', assetCount: 373 },
  { id: 'b', albumName: '2020 Montañas Vacías', assetCount: 134 },
  { id: 'e', albumName: 'Vía de la plata', assetCount: 334 },
  { id: 'cid', albumName: 'Camino del Cid', assetCount: 53, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-12T00:00:00Z', albumThumbnailAssetId: 'thumb-1', shared: true },
])

function setup(extra: Partial<Parameters<typeof AlbumBrowser>[0]> = {}) {
  const onPick = vi.fn()
  render(<AlbumBrowser albums={ALBUMS} loading={false} provider="immich" userId={7} tripFrom="2026-06-05" tripTo="2026-06-15" onPick={onPick} t={t} locale="es" {...extra} />)
  return { onPick }
}

describe('AlbumBrowser', () => {
  it('FE-COMP-ALBUMBROWSER-001: shows the trip-match section first, then years, then undated', () => {
    setup()
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings[0]).toMatch(/albumsMatchTrip/)
    expect(headings.slice(1).map(h => h!.split('·')[0].trim())).toEqual(['2020', '2019', 'journey.picker.albumsUndated'])
  })

  it('FE-COMP-ALBUMBROWSER-002: clicking an album card picks it', () => {
    const { onPick } = setup()
    fireEvent.click(screen.getByTitle('2019 07 Danubio'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('FE-COMP-ALBUMBROWSER-003: search narrows the cards and says so when nothing matches', () => {
    setup()
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'via' } })
    expect(screen.getAllByRole('button').filter(b => b.title)).toHaveLength(1)
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText(/albumsNoMatch/)).toBeInTheDocument()
  })

  it('FE-COMP-ALBUMBROWSER-004: sort by most photos gives one flat list, biggest first', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'journey.picker.albumsSort.size' }))
    const section = screen.getAllByRole('region').at(-1)!
    const titles = within(section).getAllByRole('button').map(b => b.title)
    expect(titles[0]).toBe('2019 07 Danubio')
  })

  it('FE-COMP-ALBUMBROWSER-005: Immich cards use the album cover; others fall back to a placeholder', () => {
    setup()
    const card = screen.getByTitle('Camino del Cid')
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/api/integrations/memories/immich/assets/0/thumb-1/7/thumbnail')
    expect(screen.getByTitle('Vía de la plata').querySelector('img')).toBeNull()
  })

  it('FE-COMP-ALBUMBROWSER-006: an empty list says there are no albums', () => {
    setup({ albums: [] })
    expect(screen.getByText('journey.picker.noAlbums')).toBeInTheDocument()
  })
})

describe('normalizeAlbums / albumCoverUrl', () => {
  it('FE-COMP-ALBUMBROWSER-007: OneDrive name/count become albumName/assetCount, and its cover is the item itself', () => {
    const [od] = normalizeAlbums([{ id: 'OD1', name: 'Pirinexus', count: 88 }])
    expect(od).toMatchObject({ id: 'OD1', albumName: 'Pirinexus', assetCount: 88 })
    expect(albumCoverUrl('onedrive', 3, od)).toBe('/api/integrations/memories/onedrive/assets/0/OD1/3/thumbnail')
    expect(albumCoverUrl('synologyphotos', 3, od)).toBeNull()
  })
})

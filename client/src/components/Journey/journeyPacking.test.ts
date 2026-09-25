// FE-JOURNEYPACKING-001 to FE-JOURNEYPACKING-004
import { fetchJourneyPacking } from './journeyPacking'
import { packingApi } from '../../api/client'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, packingApi: { ...actual.packingApi, list: vi.fn() } }
})

describe('fetchJourneyPacking', () => {
  it('FE-JOURNEYPACKING-001: maps each trip\'s packing items, coercing checked to a boolean and defaulting quantity', async () => {
    vi.mocked(packingApi.list).mockResolvedValue({
      items: [{ name: 'Passport', category: 'Documents', checked: 1, quantity: 1 }, { name: 'Socks', category: null, checked: 0, quantity: 4 }],
    })
    const items = await fetchJourneyPacking([{ trip_id: 5 }])
    expect(items).toEqual([
      { name: 'Passport', category: 'Documents', checked: true, quantity: 1 },
      { name: 'Socks', category: undefined, checked: false, quantity: 4 },
    ])
  })

  it('FE-JOURNEYPACKING-002: aggregates items across multiple linked trips, in order', async () => {
    vi.mocked(packingApi.list)
      .mockResolvedValueOnce({ items: [{ name: 'Tent', category: '', checked: 0, quantity: 1 }] })
      .mockResolvedValueOnce({ items: [{ name: 'Stove', category: '', checked: 0, quantity: 1 }] })
    const items = await fetchJourneyPacking([{ trip_id: 1 }, { trip_id: 2 }])
    expect(items.map(i => i.name)).toEqual(['Tent', 'Stove'])
  })

  it('FE-JOURNEYPACKING-003: skips items with a blank/missing name', async () => {
    vi.mocked(packingApi.list).mockResolvedValue({ items: [{ name: '  ', category: '', checked: 0, quantity: 1 }] })
    const items = await fetchJourneyPacking([{ trip_id: 1 }])
    expect(items).toEqual([])
  })

  it('FE-JOURNEYPACKING-004: one trip\'s fetch failing does not blank the whole list — other trips\' items still come back', async () => {
    vi.mocked(packingApi.list)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [{ name: 'Map', category: '', checked: 0, quantity: 1 }] })
    const items = await fetchJourneyPacking([{ trip_id: 1 }, { trip_id: 2 }])
    expect(items).toEqual([{ name: 'Map', category: undefined, checked: false, quantity: 1 }])
  })
})

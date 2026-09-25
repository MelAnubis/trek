// FE-JOURNEYACCOM-001 to FE-JOURNEYACCOM-004
import { fetchJourneyAccommodations } from './journeyAccommodations'
import { accommodationsApi } from '../../api/client'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, accommodationsApi: { ...actual.accommodationsApi, list: vi.fn() } }
})

describe('fetchJourneyAccommodations', () => {
  it('FE-JOURNEYACCOM-001: maps the joined place_name/place_address fields, not the raw place_id', async () => {
    vi.mocked(accommodationsApi.list).mockResolvedValue({
      accommodations: [{ id: 1, place_name: 'Hotel Roma', place_address: 'Rome', check_in: '2026-04-01', check_out: '2026-04-04', confirmation: 'XYZ123' }],
    })
    const stays = await fetchJourneyAccommodations([{ trip_id: 5 }])
    expect(stays).toEqual([{ name: 'Hotel Roma', address: 'Rome', checkIn: '2026-04-01', checkOut: '2026-04-04', confirmation: 'XYZ123' }])
  })

  it('FE-JOURNEYACCOM-002: falls back to the linked reservation\'s title when the accommodation has no place attached', async () => {
    vi.mocked(accommodationsApi.list).mockResolvedValue({
      accommodations: [{ id: 1, place_name: null, reservation_title: 'Campsite booking', place_address: null, check_in: null, check_out: null, confirmation: null }],
    })
    const stays = await fetchJourneyAccommodations([{ trip_id: 5 }])
    expect(stays).toEqual([{ name: 'Campsite booking', address: undefined, checkIn: null, checkOut: null, confirmation: undefined }])
  })

  it('FE-JOURNEYACCOM-003: skips an accommodation with neither a place name nor a reservation title', async () => {
    vi.mocked(accommodationsApi.list).mockResolvedValue({ accommodations: [{ id: 1, place_name: null, reservation_title: null }] })
    const stays = await fetchJourneyAccommodations([{ trip_id: 5 }])
    expect(stays).toEqual([])
  })

  it('FE-JOURNEYACCOM-004: one trip\'s fetch failing does not blank the whole list — other trips\' stays still come back', async () => {
    vi.mocked(accommodationsApi.list)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ accommodations: [{ id: 2, place_name: 'Cabin', place_address: null, check_in: null, check_out: null, confirmation: null }] })
    const stays = await fetchJourneyAccommodations([{ trip_id: 1 }, { trip_id: 2 }])
    expect(stays).toEqual([{ name: 'Cabin', address: undefined, checkIn: null, checkOut: null, confirmation: undefined }])
  })
})

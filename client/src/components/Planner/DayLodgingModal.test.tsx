// Alojamiento por día: búsqueda en Booking con la localidad final y alta del hotel elegido (lugar + alojamiento + reserva + gasto).
import React from 'react'
import { render, screen, waitFor, fireEvent } from '../../../tests/helpers/render'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/helpers/msw/server'
import { useAuthStore } from '../../store/authStore'
import { useTripStore } from '../../store/tripStore'
import { useAddonStore } from '../../store/addonStore'
import { useSettingsStore } from '../../store/settingsStore'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { buildUser, buildTrip, buildDay, buildPlace, buildAssignment } from '../../../tests/helpers/factories'
import DayLodgingModal from './DayLodgingModal'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('../shared/Toast', () => ({ useToast: () => toast }))

// Día 2: Martos y, al final, Alcaudete (la localidad que cuenta). Días 3 y 4 después.
const martos = buildPlace({ id: 11, name: 'Martos', address: '23600 Martos, Jaén, España', lat: 37.7213, lng: -3.9703 })
const alcaudete = buildPlace({ id: 12, name: 'Alcaudete', address: '23660 Alcaudete, Jaén, España', lat: 37.5912, lng: -4.0888 })
const day1 = buildDay({ id: 101, trip_id: 1, day_number: 1, date: '2026-10-17', title: 'Jaen' })
const day2 = buildDay({ id: 102, trip_id: 1, day_number: 2, date: '2026-10-18', title: 'Alcaudete', assignments: [
  buildAssignment({ id: 1, day_id: 102, order_index: 0, place: martos }),
  buildAssignment({ id: 2, day_id: 102, order_index: 1, place: alcaudete }),
] })
const day3 = buildDay({ id: 103, trip_id: 1, day_number: 3, date: '2026-10-19', title: 'Zuheros' })
const days = [day1, day2, day3]

let placeBody: any, reservationBody: any, searchBody: any
const onClose = vi.fn(), onSaved = vi.fn()

function setup(opts: { budget?: boolean; search?: unknown; members?: number; day?: any } = {}) {
  const budget = opts.budget ?? true
  seedStore(useAddonStore, { addons: budget ? [{ id: 'budget', name: 'Budget', type: 'trip', icon: 'x', enabled: true }] : [], loaded: true } as any)
  server.use(
    http.get('/api/trips/1/members', () => HttpResponse.json({ owner: { id: 1 }, members: Array.from({ length: opts.members ?? 2 }, (_, i) => ({ id: 10 + i })) })),
    http.post('/api/maps/search', async ({ request }) => { searchBody = await request.json(); return HttpResponse.json(opts.search ?? { places: [] }) }),
    http.post('/api/trips/1/places', async ({ request }) => { placeBody = await request.json(); return HttpResponse.json({ place: { id: 555, ...placeBody } }, { status: 201 }) }),
    http.post('/api/trips/1/reservations', async ({ request }) => { reservationBody = await request.json(); return HttpResponse.json({ reservation: { id: 777, trip_id: 1, ...reservationBody } }, { status: 201 }) }),
  )
  return render(<DayLodgingModal day={opts.day ?? day2} days={days} tripId={1} onClose={onClose} onSaved={onSaved} />)
}

beforeEach(() => {
  resetAllStores(); vi.clearAllMocks(); placeBody = reservationBody = searchBody = undefined
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true })
  seedStore(useTripStore, { trip: buildTrip({ id: 1 }), reservations: [] } as any)
  seedStore(useSettingsStore, { settings: { time_format: '24h', temperature_unit: 'celsius' } } as any)
})

const bookingLink = () => screen.getByRole('link', { name: /Buscar en Booking|Search on Booking/ }) as HTMLAnchorElement

describe('DayLodgingModal — buscar', () => {
  it('propone la localidad del ÚLTIMO lugar del día y abre Booking con las fechas de esa noche', async () => {
    setup()
    expect((screen.getByLabelText(/Localidad|Town/) as HTMLInputElement).value).toBe('Alcaudete, Jaén, España')
    const href = bookingLink().href
    expect(href).toContain('booking.com/searchresults.html')
    expect(href).toContain('ss=Alcaudete%2C%20Ja%C3%A9n%2C%20Espa%C3%B1a')
    expect(href).toContain('checkin=2026-10-18&checkout=2026-10-19')
    expect(bookingLink().target).toBe('_blank')
    expect(bookingLink().rel).toContain('noopener')
  })

  it('el nº de viajeros sale de los miembros del viaje', async () => {
    setup({ members: 2 })                                                            // propietario + 2
    await waitFor(() => expect(bookingLink().href).toContain('group_adults=3'))
  })

  it('con varias noches, la salida se mueve y el enlace también', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Noches|Nights/), { target: { value: '2' } })
    await waitFor(() => expect(bookingLink().href).toContain('checkin=2026-10-18&checkout=2026-10-20'))
  })

  it('las noches no pueden pasarse del último día del viaje', async () => {
    setup()                                                                          // día 2 de 3 → como máximo 2 noches
    fireEvent.change(screen.getByLabelText(/Noches|Nights/), { target: { value: '9' } })
    expect((screen.getByLabelText(/Noches|Nights/) as HTMLInputElement).value).toBe('2')
  })

  it('si cambias la localidad, el enlace la usa', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Localidad|Town/), { target: { value: 'Baena, Córdoba' } })
    await waitFor(() => expect(bookingLink().href).toContain('ss=Baena%2C%20C%C3%B3rdoba'))
  })

  it('un viaje sin fechas lo dice y busca sin fechas', async () => {
    setup({ day: { ...day2, date: '' } })
    expect(screen.getByText(/no tiene fechas|no dates/)).toBeInTheDocument()
    expect(bookingLink().href).not.toContain('checkin')
  })

  it('si el día no tiene lugares usa el título del día como localidad', async () => {
    setup({ day: { ...day3 } })
    expect((screen.getByLabelText(/Localidad|Town/) as HTMLInputElement).value).toBe('Zuheros')
  })
})

describe('DayLodgingModal — enlace de un hotel de Booking', () => {
  const hotelUrl = 'https://www.booking.com/hotel/es/hotel-sercotel-alcaudete.es.html?checkin=2026-10-18&checkout=2026-10-19&group_adults=2'

  it('al pegarlo propone el nombre del hotel (sin pisar el que ya hayas escrito)', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Enlace del hotel|Hotel link/), { target: { value: hotelUrl } })
    await waitFor(() => expect((screen.getByLabelText(/Nombre del alojamiento|Accommodation name/) as HTMLInputElement).value).toBe('Hotel Sercotel Alcaudete'))
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Mi nombre' } })
    fireEvent.change(screen.getByLabelText(/Enlace del hotel|Hotel link/), { target: { value: hotelUrl + '&x=1' } })
    expect((screen.getByLabelText(/Nombre del alojamiento|Accommodation name/) as HTMLInputElement).value).toBe('Mi nombre')
  })

  it('avisa si las fechas del enlace no son las de este día, y si el enlace no es de Booking', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Enlace del hotel|Hotel link/), { target: { value: hotelUrl.replace('2026-10-18', '2026-10-25').replace('2026-10-19', '2026-10-26') } })
    await waitFor(() => expect(screen.getByText(/no coinciden|do not match/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Enlace del hotel|Hotel link/), { target: { value: 'https://evil.example/hotel' } })
    await waitFor(() => expect(screen.getByText(/no es de Booking|not from Booking/)).toBeInTheDocument())
  })
})

describe('DayLodgingModal — añadir el elegido', () => {
  it('sin nombre no se puede añadir', () => {
    setup()
    expect(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ })).toBeDisabled()
  })

  it('crea el lugar y UNA reserva de hotel que lleva el alojamiento del día y el gasto, con los datos del formulario', async () => {
    setup({ search: { places: [{ name: 'Hotel Sercotel', address: 'Calle X, 23660 Alcaudete', lat: 37.593, lng: -4.087, google_place_id: 'gp1' }] } })
    fireEvent.change(screen.getByLabelText(/Enlace del hotel|Hotel link/), { target: { value: 'https://www.booking.com/hotel/es/hotel-sercotel.es.html?checkin=2026-10-18&checkout=2026-10-19' } })
    await waitFor(() => expect((screen.getByLabelText(/Nombre del alojamiento|Accommodation name/) as HTMLInputElement).value).toBe('Hotel Sercotel'))
    fireEvent.change(screen.getByLabelText(/Precio total|Total price/), { target: { value: '95,50' } })
    fireEvent.change(screen.getByLabelText(/^Estado|^Status/), { target: { value: 'confirmed' } })
    fireEvent.change(screen.getByLabelText(/Nº de confirmación|Confirmation no/), { target: { value: 'ABC123' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()

    expect(searchBody.query).toBe('Hotel Sercotel, Alcaudete, Jaén, España')
    expect(placeBody).toMatchObject({ name: 'Hotel Sercotel', lat: 37.593, lng: -4.087, google_place_id: 'gp1', address: 'Calle X, 23660 Alcaudete' })
    expect(placeBody.website).toContain('booking.com/hotel/es/hotel-sercotel')

    expect(reservationBody).toMatchObject({
      title: 'Hotel Sercotel', type: 'hotel', status: 'confirmed', confirmation_number: 'ABC123', location: 'Alcaudete, Jaén, España',
      accommodation_id: null, assignment_id: null, needs_review: false,
    })
    expect(reservationBody.notes).toContain('Booking: https://www.booking.com/hotel/es/hotel-sercotel')
    expect(reservationBody.create_accommodation).toMatchObject({ place_id: 555, start_day_id: 102, end_day_id: 102, confirmation: 'ABC123' })
    expect(reservationBody.create_budget_entry).toMatchObject({ total_price: 95.5, category: expect.any(String) })
    expect(reservationBody.metadata).toMatchObject({ price: '95.5' })
  })

  it('con varias noches el alojamiento cubre desde este día hasta el último día de la estancia', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Casa Rural' } })
    fireEvent.change(screen.getByLabelText(/Noches|Nights/), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))
    await waitFor(() => expect(reservationBody).toBeDefined())
    expect(reservationBody.create_accommodation).toMatchObject({ start_day_id: 102, end_day_id: 103 })
  })

  it('si la búsqueda no encuentra el hotel (o lo sitúa a más de 25 km), lo coloca en el centro de la población', async () => {
    setup({ search: { places: [{ name: 'Otro Hotel', lat: 40.4, lng: -3.7 }] } })           // Madrid: lejos de Alcaudete
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Casa Rural' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))
    await waitFor(() => expect(placeBody).toBeDefined())
    expect(placeBody).toMatchObject({ lat: 37.5912, lng: -4.0888, address: 'Alcaudete, Jaén, España' })
  })

  it('si la búsqueda de lugares falla el alta sigue adelante', async () => {
    setup()
    server.use(http.post('/api/maps/search', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Casa Rural' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(placeBody.lat).toBe(37.5912)
  })

  it('sin el addon de presupuesto no hay campo de precio ni gasto', async () => {
    setup({ budget: false })
    expect(screen.queryByLabelText(/Precio total|Total price/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Casa Rural' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))
    await waitFor(() => expect(reservationBody).toBeDefined())
    expect(reservationBody.create_budget_entry).toBeUndefined()
    expect(reservationBody.metadata).toBeNull()
  })

  it('con presupuesto y sin precio manda un gasto a 0 (como la ventana de reservas)', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Casa Rural' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))
    await waitFor(() => expect(reservationBody).toBeDefined())
    expect(reservationBody.create_budget_entry).toEqual({ total_price: 0 })
  })

  it('si la reserva falla se avisa y la ventana sigue abierta con lo escrito', async () => {
    setup()
    server.use(http.post('/api/trips/1/reservations', () => HttpResponse.json({ error: 'No permission' }, { status: 403 })))
    fireEvent.change(screen.getByLabelText(/Nombre del alojamiento|Accommodation name/), { target: { value: 'Casa Rural' } })
    fireEvent.click(screen.getByRole('button', { name: /Añadir alojamiento|Add accommodation/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/Nombre del alojamiento|Accommodation name/) as HTMLInputElement).value).toBe('Casa Rural')
  })
})

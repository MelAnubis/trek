// Pestaña Reservas: generar una reserva de alojamiento pendiente por día, y elegir hotel desde cada una.
import React from 'react'
import { render, screen, waitFor, within, fireEvent } from '../../../tests/helpers/render'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/helpers/msw/server'
import { useAuthStore } from '../../store/authStore'
import { useTripStore } from '../../store/tripStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useAddonStore } from '../../store/addonStore'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { buildUser, buildTrip, buildReservation, buildDay, buildPlace, buildAssignment } from '../../../tests/helpers/factories'
import ReservationsPanel from './ReservationsPanel'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('../shared/Toast', () => ({ useToast: () => toast }))
vi.mock('../../api/authUrl', () => ({ getAuthUrl: vi.fn().mockResolvedValue('http://test/file') }))

const martos = buildPlace({ id: 11, name: 'Martos', address: '23600 Martos, Jaén, España', lat: 37.7213, lng: -3.9703 })
const alcaudete = buildPlace({ id: 12, name: 'Alcaudete', address: '23660 Alcaudete, Jaén, España', lat: 37.5912, lng: -4.0888 })
const zuheros = buildPlace({ id: 13, name: 'Zuheros', address: '14870 Zuheros, Córdoba, España', lat: 37.5424, lng: -4.3139 })

const days = [
  buildDay({ id: 101, trip_id: 1, day_number: 1, date: '2026-10-17', title: 'Jaen' }),
  buildDay({ id: 102, trip_id: 1, day_number: 2, date: '2026-10-18', title: 'Alcaudete' }),
  buildDay({ id: 103, trip_id: 1, day_number: 3, date: '2026-10-19', title: 'Zuheros' }),
]
const assignments = {
  '102': [buildAssignment({ id: 1, day_id: 102, order_index: 0, place: martos }), buildAssignment({ id: 2, day_id: 102, order_index: 1, place: alcaudete })],
  '103': [buildAssignment({ id: 3, day_id: 103, order_index: 0, place: zuheros })],
}

const onLodgingChange = vi.fn()
const baseProps = { tripId: 1, days, assignments, files: [], onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onNavigateToFiles: vi.fn(), lodgingTools: true, onLodgingChange }

let created: any[] = [], updated: any[] = [], placesCreated: any[] = []

beforeEach(() => {
  resetAllStores(); vi.clearAllMocks(); created = []; updated = []; placesCreated = []
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true })
  seedStore(useTripStore, { trip: buildTrip({ id: 1 }), reservations: [] } as any)
  seedStore(useSettingsStore, { settings: { time_format: '24h', blur_booking_codes: false, temperature_unit: 'celsius', language: 'en', dark_mode: false } } as any)
  seedStore(useAddonStore, { addons: [{ id: 'budget', name: 'Budget', type: 'trip', icon: 'x', enabled: true }], loaded: true } as any)
  server.use(
    http.get('/api/trips/1/members', () => HttpResponse.json({ owner: { id: 1 }, members: [] })),
    http.post('/api/trips/1/reservations', async ({ request }) => {
      const b: any = await request.json(); created.push(b)
      return HttpResponse.json({ reservation: { id: 900 + created.length, trip_id: 1, ...b } }, { status: 201 })
    }),
    http.put('/api/trips/1/reservations/:id', async ({ request, params }) => {
      const b: any = await request.json(); updated.push({ id: Number(params.id), ...b })
      return HttpResponse.json({ reservation: { id: Number(params.id), trip_id: 1, ...b } })
    }),
    http.post('/api/trips/1/places', async ({ request }) => {
      const b: any = await request.json(); placesCreated.push(b)
      return HttpResponse.json({ place: { id: 555, ...b } }, { status: 201 })
    }),
    http.post('/api/maps/search', () => HttpResponse.json({ places: [] })),
    http.get('/api/trips/1/budget', () => HttpResponse.json({ items: [] })),
  )
})

const pendingLodging = (over: Record<string, unknown> = {}) => buildReservation({
  id: 31, trip_id: 1, title: 'Accommodation in Alcaudete', type: 'hotel', status: 'pending', day_id: 102, end_day_id: 102,
  location: 'Alcaudete, Jaén, España', accommodation_id: null, ...over,
} as any)

describe('Reservas — generar alojamientos por día', () => {
  it('las herramientas de alojamiento NO salen en el panel de transportes (lodgingTools apagado)', () => {
    render(<ReservationsPanel {...baseProps} lodgingTools={false} reservations={[pendingLodging()]} />)
    expect(screen.queryByRole('button', { name: /Lodging per day|Alojamientos por día/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Find accommodation|Buscar alojamiento/ })).not.toBeInTheDocument()
  })

  it('el botón «Lodging per day» solo aparece si el viaje tiene días', () => {
    const { unmount } = render(<ReservationsPanel {...baseProps} reservations={[]} />)
    expect(screen.getByRole('button', { name: /Lodging per day|Alojamientos por día/ })).toBeInTheDocument()
    unmount()
    render(<ReservationsPanel {...baseProps} days={[]} reservations={[]} />)
    expect(screen.queryByRole('button', { name: /Lodging per day|Alojamientos por día/ })).not.toBeInTheDocument()
  })

  it('lista los días con su localidad final (la del ÚLTIMO lugar), con el último día sin noche por defecto', async () => {
    const user = userEvent.setup()
    render(<ReservationsPanel {...baseProps} reservations={[]} />)
    await user.click(screen.getByRole('button', { name: /Lodging per day|Alojamientos por día/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Alcaudete, Jaén, España')).toBeInTheDocument()       // no Martos
    expect(within(dialog).queryByText(/Martos/)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/Zuheros, Córdoba, España/)).toBeInTheDocument()
    expect(within(dialog).getByText('Jaen')).toBeInTheDocument()                           // día sin lugares: usa el título
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map(b => b.checked)).toEqual([true, true, false])                         // el último día no se marca
    expect(within(dialog).getByText(/last day|último día/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Create 2 pending|Crear 2 reserva/ })).toBeInTheDocument()
  })

  it('crea UNA reserva de hotel PENDIENTE por noche marcada, con el día y la localidad, sin hotel todavía', async () => {
    const user = userEvent.setup()
    render(<ReservationsPanel {...baseProps} reservations={[]} />)
    await user.click(screen.getByRole('button', { name: /Lodging per day|Alojamientos por día/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Create 2 pending|Crear 2 reserva/ }))
    await waitFor(() => expect(created).toHaveLength(2))
    expect(created[0]).toMatchObject({
      type: 'hotel', status: 'pending', day_id: 101, end_day_id: 101, location: 'Jaen',
      accommodation_id: null, assignment_id: null, reservation_time: null, needs_review: false,
    })
    expect(created[0].title).toMatch(/Jaen/)
    expect(created[1]).toMatchObject({ day_id: 102, end_day_id: 102, location: 'Alcaudete, Jaén, España' })
    expect(created[1].create_accommodation).toBeUndefined()                               // el alojamiento se crea al elegir hotel
    expect(created[1].create_budget_entry).toBeUndefined()
    expect(toast.success).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('respeta lo que desmarques, y no vuelve a generar días que ya tienen alojamiento', async () => {
    const user = userEvent.setup()
    const reservations = [buildReservation({ id: 40, trip_id: 1, type: 'hotel', status: 'confirmed', title: 'Hotel Jaén', day_id: 101, end_day_id: 101, accommodation_id: 7, accommodation_start_day_id: 101, accommodation_end_day_id: 101 } as any)]
    render(<ReservationsPanel {...baseProps} reservations={reservations} />)
    await user.click(screen.getByRole('button', { name: /Lodging per day|Alojamientos por día/ }))
    const dialog = await screen.findByRole('dialog')
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0]).toBeDisabled()                                                         // día 1 ya cubierto
    expect(within(dialog).getByText(/already has accommodation|ya tiene alojamiento/)).toBeInTheDocument()
    await user.click(boxes[1])                                                              // desmarca el día 2
    await user.click(boxes[2])                                                              // marca el último día
    await user.click(within(dialog).getByRole('button', { name: /Create 1 pending|Crear 1 reserva/ }))
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0].day_id).toBe(103)
  })

  it('si alguna falla lo dice y la ventana sigue abierta', async () => {
    const user = userEvent.setup()
    server.use(http.post('/api/trips/1/reservations', () => HttpResponse.json({ error: 'No permission' }, { status: 403 })))
    render(<ReservationsPanel {...baseProps} reservations={[]} />)
    await user.click(screen.getByRole('button', { name: /Lodging per day|Alojamientos por día/ }))
    await user.click(await screen.findByRole('button', { name: /Create 2 pending|Crear 2 reserva/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('sin ningún día elegible lo explica y no deja crear', async () => {
    const user = userEvent.setup()
    render(<ReservationsPanel {...baseProps} days={[buildDay({ id: 1, trip_id: 1, day_number: 1, date: '2026-10-17', title: '' })]} assignments={{}} reservations={[]} />)
    await user.click(screen.getByRole('button', { name: /Lodging per day|Alojamientos por día/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/no days with a town|no hay días con localidad/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Create 0|Crear 0/ })).toBeDisabled()
  })
})

describe('Reservas — elegir alojamiento desde la reserva pendiente', () => {
  const options = {
    options: [
      { id: 'osm:node:1', name: 'Hostal Centro', lat: 37.5915, lng: -4.0885, distance_m: 41, sources: ['osm'], osm_id: 'node:1' },
      { id: 'google:g2', name: 'Casa Rural La Fuente', lat: 37.593, lng: -4.087, distance_m: 260, sources: ['osm', 'google'], osm_id: 'node:2', google_place_id: 'g2' },
    ],
    sources: { osm: 'ok', google: 'used', errors: [] }, center: { lat: 37.5912, lng: -4.0888 }, radius_m: 2500,
  }

  it('«Find accommodation» solo sale en hoteles pendientes sin alojamiento asignado', () => {
    const reservations = [
      pendingLodging(),
      pendingLodging({ id: 32, accommodation_id: 9 }),                 // ya tiene hotel
      pendingLodging({ id: 33, status: 'confirmed' }),                 // reservada
      buildReservation({ id: 34, trip_id: 1, type: 'flight', status: 'pending', title: 'Vuelo' } as any),
    ]
    render(<ReservationsPanel {...baseProps} reservations={reservations} />)
    expect(screen.getAllByRole('button', { name: /Find accommodation|Buscar alojamiento/ })).toHaveLength(1)
  })

  it('abre las opciones de la localidad de ese día con las fechas de esa noche en los enlaces a Booking', async () => {
    const user = userEvent.setup()
    server.use(http.post('/api/maps/lodging-near', async ({ request }) => {
      const b: any = await request.json()
      expect(b).toMatchObject({ lat: 37.5912, lng: -4.0888, radius: 2500 })                // centro = último lugar del día
      return HttpResponse.json(options)
    }))
    render(<ReservationsPanel {...baseProps} reservations={[pendingLodging()]} />)
    await user.click(screen.getByRole('button', { name: /Find accommodation|Buscar alojamiento/ }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/Town|Localidad/) as HTMLInputElement).value).toBe('Alcaudete, Jaén, España')
    await user.click(within(dialog).getByRole('button', { name: /See accommodation in Alcaudete|Ver alojamientos en Alcaudete/ }))
    const list = await within(dialog).findByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText(/41 m|40 m/)).toBeInTheDocument()
    expect(within(list).getByText(/OpenStreetMap \+ Google/)).toBeInTheDocument()          // un hotel visto por las dos fuentes
    const booking = within(list).getByRole('link', { name: 'Booking: Hostal Centro' }) as HTMLAnchorElement
    expect(booking.href).toContain('ss=Hostal%20Centro%2C%20Alcaudete')
    expect(booking.href).toContain('checkin=2026-10-18&checkout=2026-10-19')
    expect(within(dialog).getByText(/no price or availability|no incluye precio/i)).toBeInTheDocument()
  })

  it('al elegir una opción y pulsar «Use this accommodation» rellena ESA reserva (no crea otra) con hotel, días y alojamiento', async () => {
    const user = userEvent.setup()
    server.use(http.post('/api/maps/lodging-near', () => HttpResponse.json(options)))
    render(<ReservationsPanel {...baseProps} reservations={[pendingLodging({ notes: 'Preferir con parking' })]} />)
    await user.click(screen.getByRole('button', { name: /Find accommodation|Buscar alojamiento/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /See accommodation in|Ver alojamientos en/ }))
    await user.click(await within(dialog).findByRole('button', { name: /Choose: Casa Rural La Fuente|Elegir: Casa Rural La Fuente/ }))
    expect((within(dialog).getByLabelText(/Accommodation name|Nombre del alojamiento/) as HTMLInputElement).value).toBe('Casa Rural La Fuente')
    fireEvent.change(within(dialog).getByLabelText(/Total price|Precio total/), { target: { value: '88' } })
    await user.click(within(dialog).getByRole('button', { name: /Use this accommodation|Usar este alojamiento/ }))

    await waitFor(() => expect(updated).toHaveLength(1))
    expect(created).toHaveLength(0)                                                         // no se crea una reserva nueva
    expect(placesCreated[0]).toMatchObject({ name: 'Casa Rural La Fuente', lat: 37.593, lng: -4.087, google_place_id: 'g2', osm_id: 'node:2', address: 'Alcaudete, Jaén, España' })
    expect(updated[0]).toMatchObject({
      id: 31, title: 'Casa Rural La Fuente', type: 'hotel', status: 'pending', place_id: 555, day_id: 102, end_day_id: 102, location: 'Alcaudete, Jaén, España',
    })
    expect(updated[0].create_accommodation).toMatchObject({ place_id: 555, start_day_id: 102, end_day_id: 102 })
    expect(updated[0].create_budget_entry).toMatchObject({ total_price: 88 })
    expect(updated[0].notes).toBe('Preferir con parking')                                    // no pisa las notas que ya había
    expect(toast.success).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onLodgingChange).toHaveBeenCalled()                                              // se recargan los alojamientos del viaje
  })

  it('avisa de qué fuentes han fallado o faltan, sin ocultar las que sí respondieron', async () => {
    const user = userEvent.setup()
    server.use(http.post('/api/maps/lodging-near', () => HttpResponse.json({
      ...options, sources: { osm: 'partial', google: 'no-key', errors: ['overpass-api.de: HTTP 504'] },
    })))
    render(<ReservationsPanel {...baseProps} reservations={[pendingLodging()]} />)
    await user.click(screen.getByRole('button', { name: /Find accommodation|Buscar alojamiento/ }))
    await user.click(await screen.findByRole('button', { name: /See accommodation in|Ver alojamientos en/ }))
    expect(await screen.findByText(/Some areas could not be queried|Algunas zonas no se pudieron/)).toBeInTheDocument()
    expect(screen.getByText(/Google Maps key|clave de Google Maps/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    server.use(http.post('/api/maps/lodging-near', () => HttpResponse.json({ options: [], sources: { osm: 'failed', google: 'failed', errors: ['overpass-api.de: HTTP 504'] }, center: { lat: 1, lng: 1 }, radius_m: 2500 })))
    await user.click(screen.getByRole('button', { name: /See accommodation in|Ver alojamientos en/ }))
    expect(await screen.findByText(/OpenStreetMap did not answer|OpenStreetMap no respondió/)).toBeInTheDocument()
    expect(screen.getByText(/Google did not answer|Google no respondió/)).toBeInTheDocument()
    expect(screen.getByText(/No accommodation found|No se han encontrado/)).toBeInTheDocument()
  })

  it('si la búsqueda falla del todo lo dice y se puede seguir con el alta manual', async () => {
    const user = userEvent.setup()
    server.use(http.post('/api/maps/lodging-near', () => HttpResponse.json({ error: 'Failed to search accommodation' }, { status: 500 })))
    render(<ReservationsPanel {...baseProps} reservations={[pendingLodging()]} />)
    await user.click(screen.getByRole('button', { name: /Find accommodation|Buscar alojamiento/ }))
    await user.click(await screen.findByRole('button', { name: /See accommodation in|Ver alojamientos en/ }))
    expect(await screen.findByText('Failed to search accommodation')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Accommodation name|Nombre del alojamiento/), { target: { value: 'Mi hotel' } })
    expect(screen.getByRole('button', { name: /Use this accommodation|Usar este alojamiento/ })).toBeEnabled()
  })
})

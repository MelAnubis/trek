/**
 * Render del planificador completo (con el mapa y el perfil sustituidos por stubs, que no funcionan en jsdom):
 * comprueba que la pestaña «Etapas» enseña lo que debe, que los enlaces a Booking llevan las fechas de cada noche y
 * que «Dividir» / «Ajustar» aplican los cortes del servidor.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '../../tests/helpers/render'

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('../components/shared/Toast', () => ({ useToast: () => toast }))
vi.mock('../components/Layout/Navbar', () => ({ default: () => <div data-testid="navbar" /> }))
vi.mock('../components/Planner/PlannerMap', () => ({ default: () => <div data-testid="map" />, STAGE_COLORS: ['#e85d24', '#2563eb', '#16a34a', '#a855f7', '#f59e0b'] }))
vi.mock('../components/Planner/PlannerProfile', () => ({ default: () => <div data-testid="profile" /> }))
vi.mock('../components/Planner/OverviewMap', () => ({ default: () => <div data-testid="overview" /> }))

const api = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), smartCuts: vi.fn(),
  poisAlongRoute: vi.fn(), assistant: vi.fn(), overview: vi.fn(), renameFolder: vi.fn(),
}))
vi.mock('../api/client', () => ({ plannerApi: api }))

import PlannerPage from './PlannerPage'

// 101 puntos hacia el norte, ≈ 111 km
const points: [number, number, number | null][] = Array.from({ length: 101 }, (_, i) => [40 + i * 0.01, -3, 600 + (i % 10)])
const routeFull = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Ávila – Ciudad Rodrigo', orig_name: 'x.gpx', total_distance_km: 111, elevation_gain: 100, elevation_loss: 90,
  point_count: 101, stage_count: 3, folder: null, favorite: false, preview: [], created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00',
  points,
  cuts: [{ index: 35, lodged: false, town: true, place: 'Béjar', shiftKm: 4.2 }, { index: 70, lodged: true, place: 'Guijuelo', source: 'google', shiftKm: -2 }],
  waypoints: [], settings: { stageKm: 40 },
  ...over,
})
const library = { routes: [], total: 0, page: 1, pages: 1, limit: 12, folders: [], totals: { all: 0, favorites: 0, unfiled: 0 } }

async function openStages() {
  const utils = render(<PlannerPage />, { initialEntries: ['/planner?id=1'] })
  await screen.findByDisplayValue('Ávila – Ciudad Rodrigo')
  fireEvent.click(screen.getByRole('button', { name: /^(Etapas|Stages)$/ }))
  return utils
}

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset())
  Object.values(toast).forEach(f => f.mockReset())
  api.list.mockResolvedValue(library)
  api.get.mockResolvedValue({ route: routeFull() })
  api.update.mockImplementation(async (_id: number, data: Record<string, unknown>) => ({ route: routeFull(data) }))
  api.overview.mockResolvedValue({ routes: [] })
})

describe('PlannerPage — pestaña Etapas', () => {
  it('muestra el campo «Fecha de salida» (type=date) en la tarjeta de división automática', async () => {
    const { container } = await openStages()
    const date = container.querySelector('input[type="date"]') as HTMLInputElement
    expect(date).toBeTruthy()
    expect(date.value).toBe('')
    expect(screen.getByText(/Fecha de salida|Start date/)).toBeInTheDocument()
  })

  it('cada etapa dice dónde termina: población sin alojamiento mapeado, o alojamiento de Google', async () => {
    await openStages()
    expect(screen.getByText(/Termina en Béjar|Ends in Béjar/)).toBeInTheDocument()
    expect(screen.getByText(/Termina en Guijuelo|Ends in Guijuelo/)).toBeInTheDocument()
    expect(screen.getByText(/· Google/)).toBeInTheDocument()
  })

  it('los enlaces a Booking llevan la población y, con fecha de salida, la noche de cada etapa', async () => {
    const { container } = await openStages()
    const bookingLinks = () => Array.from(container.querySelectorAll('a')).filter(a => a.href.includes('booking.com')) as HTMLAnchorElement[]

    expect(bookingLinks().length).toBeGreaterThanOrEqual(2)
    expect(bookingLinks()[0].href).toContain('ss=B%C3%A9jar')
    expect(bookingLinks()[0].href).not.toContain('checkin')                    // sin fecha: solo la población
    expect(bookingLinks()[0].target).toBe('_blank')
    expect(bookingLinks()[0].rel).toContain('noopener')

    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-12' } })
    await waitFor(() => expect(bookingLinks()[0].href).toContain('checkin=2026-10-12&checkout=2026-10-13'))
    expect(bookingLinks()[1].href).toContain('ss=Guijuelo')
    expect(bookingLinks()[1].href).toContain('checkin=2026-10-13&checkout=2026-10-14')   // la 2ª etapa duerme la noche siguiente
  })

  it('también hay un enlace a hoteles en Google Maps por etapa', async () => {
    const { container } = await openStages()
    const g = Array.from(container.querySelectorAll('a')).filter(a => a.href.includes('google.com/maps/search/hotel')) as HTMLAnchorElement[]
    expect(g.length).toBe(3)                                                    // una por etapa (3 etapas)
    expect(g[0].href).toMatch(/@40\.\d+,-3\.\d+,14z$/)
  })

  it('la fecha de salida se guarda sola en la ruta (autoguardado)', async () => {
    const { container } = await openStages()
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-12' } })
    await waitFor(() => expect(api.update).toHaveBeenCalled(), { timeout: 4000 })
    const [id, body] = api.update.mock.calls.at(-1)!
    expect(id).toBe(1)
    expect((body as { settings: { startDate: string } }).settings.startDate).toBe('2026-10-12')
  })

  it('«Dividir» pide al servidor cortes en poblaciones con alojamiento y aplica el resultado', async () => {
    api.smartCuts.mockResolvedValue({
      cuts: [{ index: 50, km: 55.6, lodged: true, shiftKm: 0.1, place: 'Navacerrada', source: 'osm' }],
      lodgingChecked: true, queries: 2, failed: 0, totalKm: 111, sources: { google: 'not-needed', googleQueries: 0, googleFound: 0 },
    })
    await openStages()
    fireEvent.click(screen.getByRole('button', { name: /^(Dividir|Split)$/ }))
    await waitFor(() => expect(api.smartCuts).toHaveBeenCalledWith(1, { stageKm: 40 }))
    await waitFor(() => expect(screen.getByText(/Termina en Navacerrada|Ends in Navacerrada/)).toBeInTheDocument())
    expect(screen.queryByText(/Termina en Béjar|Ends in Béjar/)).not.toBeInTheDocument()   // los cortes antiguos se sustituyen
  })

  it('«Ajustar cortes» manda los km de los cortes actuales y avisa si no hay clave de Google', async () => {
    api.smartCuts.mockResolvedValue({
      cuts: [
        { index: 36, km: 40, lodged: false, shiftKm: 0, town: true, place: 'Béjar' },
        { index: 70, km: 77, lodged: false, shiftKm: 0 },
      ],
      lodgingChecked: true, queries: 2, failed: 0, totalKm: 111, sources: { google: 'no-key', googleQueries: 0, googleFound: 0 },
    })
    await openStages()
    fireEvent.click(screen.getByRole('button', { name: /Ajustar cortes|Adjust cuts/ }))
    await waitFor(() => expect(api.smartCuts).toHaveBeenCalled())
    const [, body] = api.smartCuts.mock.calls[0]
    expect((body as { marks: number[] }).marks).toHaveLength(2)
    expect((body as { marks: number[] }).marks[0]).toBeGreaterThan(30)
    await waitFor(() => expect(toast.info).toHaveBeenCalled())
    expect(toast.info.mock.calls.map(c => String(c[0])).join(' ')).toMatch(/clave de Google|Google Maps key/)
  })

  it('si no se pudo comprobar el alojamiento, la etapa lo dice (no afirma que no haya)', async () => {
    api.get.mockResolvedValue({ route: routeFull({ cuts: [{ index: 50, lodged: false, unchecked: true }] }) })
    await openStages()
    expect(screen.getByText(/no se pudo comprobar|could not be checked/i)).toBeInTheDocument()
    expect(screen.queryByText(/Sin alojamiento detectado|No accommodation detected/)).not.toBeInTheDocument()
  })

  it('una ruta sin cortes se puede dividir; con una sola etapa no hay botón de «Ajustar»', async () => {
    api.get.mockResolvedValue({ route: routeFull({ cuts: [] }) })
    await openStages()
    expect(screen.getByRole('button', { name: /^(Dividir|Split)$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajustar cortes|Adjust cuts/ })).not.toBeInTheDocument()
  })
})

// FE-SITE-001 … — zona pública #ESTODOBAJADA
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Routes, Route } from 'react-router-dom'
import { render, screen, waitFor } from '../../tests/helpers/render'
import { server } from '../../tests/helpers/msw/server'
import { http, HttpResponse } from 'msw'
import { useAuthStore } from '../store/authStore'
import { resetAllStores } from '../../tests/helpers/store'
import { biggestClimb, profilePaths } from './profile'
import { SiteHomePage, SiteRoutePage, SiteStoryPage } from './SitePages'

vi.mock('../components/Journey/JourneyMap', () => ({ default: (p: { trail: unknown[]; entries: unknown[] }) => <div data-testid="map" data-trail={p.trail.length} data-entries={p.entries.length} /> }))

const profile: [number, number][] = [[0, 800], [5, 790], [10, 760], [15, 900], [20, 1100], [25, 1050], [30, 1080]]
const route = {
  id: 7, title: 'Circular de Arévalo', description: 'Tres días por La Moraña.', start_date: '2026-05-01', end_date: '2026-05-03',
  cover_image: null, cycling: true, author: 'juanma', days: 3, distance_km: 112.4, gain_m: 1240, loss_m: 1240, max_ele_m: 1100,
  profile, lines: [[[41, -4.7], [41.1, -4.6]]],
}
const story = { id: 's1', journey_id: 1, title: 'Nos dijeron que era todo bajada', slug: 'todo-bajada', excerpt: 'Alguien mintió.', cover_photo_id: 42, status: 'published', post_date: '2026-05-02', published_at: 1, version: 1, created_at: 1, updated_at: 1, author: { username: 'juanma' } }

beforeEach(() => {
  resetAllStores()
  useAuthStore.setState({ isAuthenticated: false, isLoading: false })
})

describe('profile', () => {
  it('FE-SITE-001: the biggest climb runs from the lowest point before it to the highest after', () => {
    expect(biggestClimb(profile)).toEqual({ from: 2, to: 4, gain: 340 })
    expect(biggestClimb([[0, 900], [5, 800], [10, 700]])).toBeNull()
    expect(biggestClimb([])).toBeNull()
  })

  it('FE-SITE-002: paths fit the box; a flat route still gets some relief', () => {
    const g = profilePaths(profile, 600, 100, { top: 0, bottom: 0 })!
    expect(g.x(0)).toBe(0)
    expect(g.x(30)).toBe(600)
    expect(g.y(1100)).toBeCloseTo(0)
    expect(g.y(760)).toBeCloseTo(100)
    const flat = profilePaths([[0, 500], [10, 500]], 600, 100, { top: 0, bottom: 0 })!
    expect(flat.y(500)).toBe(100)
    expect(profilePaths([[0, 1]], 600, 100)).toBeNull()
  })
})

describe('Site pages', () => {
  it('FE-SITE-003: a visitor sees the story on the cover, routes by their profile with the sticker, and the join band', async () => {
    server.use(http.get('/api/site', () => HttpResponse.json({ routes: [route], stories: [story], registration: true })))
    render(<SiteHomePage />)
    expect(await screen.findByRole('heading', { level: 1, name: story.title })).toBeInTheDocument()
    expect(screen.getAllByTestId('site-route-card')).toHaveLength(1)
    expect(screen.getByRole('img', { name: /Perfil de altimetría de Circular de Arévalo|Elevation profile of Circular/ })).toBeInTheDocument()
    expect(screen.getAllByText('#ESTODOBAJADA').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByRole('link', { name: /Crear cuenta|Create account/ })[0]).toHaveAttribute('href', '/login?mode=register')
  })

  it('FE-SITE-004: with registration closed there is no sign-up button; a logged-in user gets "open the app" and no join band', async () => {
    server.use(http.get('/api/site', () => HttpResponse.json({ routes: [route], stories: [], registration: false })))
    const { unmount } = render(<SiteHomePage />)
    await screen.findByRole('heading', { level: 1, name: route.title })
    expect(screen.queryByRole('link', { name: /Crear cuenta|Create account|Únete|Join/ })).toBeNull()
    unmount()
    useAuthStore.setState({ isAuthenticated: true })
    render(<SiteHomePage />)
    await screen.findByRole('heading', { level: 1, name: route.title })
    expect(screen.getByRole('link', { name: /Abrir la app|Open the app/ })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('link', { name: /Entrar|Sign in/ })).toBeNull()
  })

  it('FE-SITE-005: a route shows its stats, map, stages, and the GPX only behind an account', async () => {
    const detail = { ...route, extra_lines: [], gpx: true, stages: [{ day_number: 1, date: '2026-05-01', title: 'Arévalo → Madrigal', distance_km: 38.4, gain_m: 740, loss_m: 120, max_ele_m: 900, lines: [[[41, -4.7], [41.1, -4.6]]], profile, places: [{ name: 'Castillo', lat: 41, lng: -4.7, category: null }] }] }
    server.use(
      http.get('/api/site/routes/7', () => HttpResponse.json(detail)),
      http.get('/api/site', () => HttpResponse.json({ routes: [route], stories: [], registration: true })),
    )
    const ui = <Routes><Route path="/rutas/:id" element={<SiteRoutePage />} /></Routes>
    const { unmount } = render(ui, { initialEntries: ['/rutas/7'] })
    expect(await screen.findByRole('heading', { level: 1, name: route.title })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-entries', '1')
    expect(screen.getByText('Arévalo → Madrigal')).toBeInTheDocument()
    expect(screen.getByText('Castillo')).toBeInTheDocument()
    const gpx = screen.getByTestId('site-gpx')
    expect(gpx.querySelector('a[href^="/api/site/routes/7/gpx"]')).toBeNull()
    const join = gpx.querySelector('a[href^="/login?mode=register"]')!
    expect(decodeURIComponent(join.getAttribute('href')!)).toBe('/login?mode=register&redirect=/rutas/7')
    unmount()
    useAuthStore.setState({ isAuthenticated: true })
    render(ui, { initialEntries: ['/rutas/7'] })
    await screen.findByRole('heading', { level: 1, name: route.title })
    expect(screen.getByTestId('site-gpx').querySelector('a[href="/api/site/routes/7/gpx"]')).not.toBeNull()
  })

  it('FE-SITE-006: a story renders with photos from the public site route; a missing one says so', async () => {
    server.use(
      http.get('/api/site/stories/todo-bajada', () => HttpResponse.json({ post: { ...story, blocks: [{ id: 'p', type: 'paragraph', text: 'Salimos **pronto**.' }, { id: 'f', type: 'photo', photo: { galleryId: 1, photoId: 9 }, layout: 'wide' }], entry_ids: [], entries: [], maps: {} }, prev: null, next: null })),
      http.get('/api/site/stories/nope', () => new HttpResponse(null, { status: 404 })),
    )
    const ui = (p: string) => render(<Routes><Route path="/relatos/:slug" element={<SiteStoryPage />} /></Routes>, { initialEntries: [p] })
    const { unmount } = ui('/relatos/todo-bajada')
    expect(await screen.findByRole('heading', { level: 1, name: story.title })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('img[src="/api/site/photos/9/original"]')).not.toBeNull())
    expect(document.querySelector('img[src="/api/site/photos/42/original"]')).not.toBeNull()
    unmount()
    ui('/relatos/nope')
    expect(await screen.findByText(/no existe|doesn't exist/)).toBeInTheDocument()
  })
})

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Leaflet does not draw in jsdom; the map is not what is tested here.
vi.mock('../../../src/components/Navigation/NavigationMap', () => ({
  default: () => <div data-testid="map" />,
  TILE_LAYERS: { topo: { label: 'Topo' }, cyclosm: { label: 'Ciclismo' }, dark: { label: 'Oscuro' }, osm: { label: 'Estándar' } },
  loadTileKey: () => 'topo',
}))
vi.mock('../../../src/components/Navigation/NavSummary', () => ({
  default: (p: { recordedPoints: unknown[]; onDiscard: () => void }) => (
    <div data-testid="summary">{p.recordedPoints.length} puntos<button onClick={p.onDiscard}>descartar</button></div>
  ),
}))
vi.mock('../../../src/services/navVoice', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/navVoice')>()),
  navVoice: { isMuted: () => false, setMuted: vi.fn(), speak: vi.fn(), stop: vi.fn() },
}))

import NavigationView from '../../../src/components/Navigation/NavigationView'
import NavDraftNotice from '../../../src/components/Navigation/NavDraftNotice'
import { saveNavDraft, loadNavDraft, clearNavDraft } from '../../../src/services/navDraftStore'

const T0 = Date.now() - 3600_000
const points = Array.from({ length: 40 }, (_, i) => ({ lat: 40 + i * 0.0002, lng: -3.7, alt: 600, speed: 4, timestamp: T0 + i * 5000 }))

beforeEach(async () => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  })
  await clearNavDraft()
  await saveNavDraft({ startedAt: T0, points, pausedMs: 0, elevationGainM: 10, elevationLossM: 0, path: '/navigate?tripId=3', trackName: 'Salida del domingo', tripId: 3, following: false })
})

describe('NavigationView — unfinished recording', () => {
  it('offers to recover it and opens its summary', async () => {
    render(<MemoryRouter initialEntries={['/navigate?tripId=3']}><NavigationView tripId={3} onExit={() => {}} /></MemoryRouter>)
    expect(await screen.findByText('Grabación sin terminar')).toBeInTheDocument()
    expect(screen.getByText(/Salida del domingo · 0,9 km/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Terminar y guardar'))
    expect(await screen.findByTestId('summary')).toHaveTextContent('40 puntos')
    fireEvent.click(screen.getByText('descartar'))
    await waitFor(async () => expect(await loadNavDraft()).toBeNull())
  })

  it('carries on recording from where it was', async () => {
    render(<MemoryRouter initialEntries={['/navigate?tripId=3']}><NavigationView tripId={3} onExit={() => {}} /></MemoryRouter>)
    fireEvent.click(await screen.findByText('Continuar grabando'))
    expect(await screen.findByText('Pausa')).toBeInTheDocument()
    expect(screen.getByText('40 pts')).toBeInTheDocument()
    expect(screen.queryByText('Grabación sin terminar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Pausa'))
    expect(await screen.findByTestId('nav-paused')).toHaveTextContent('Grabación en pausa')
  })

  it('the app-wide notice takes you back to it from any page', async () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><NavDraftNotice /></MemoryRouter>)
    expect(await screen.findByTestId('nav-draft-notice')).toHaveTextContent('Tienes una grabación sin terminar')
  })
})

// FE-MAG-UI-001 … — «Nueva revista»
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Routes, Route } from 'react-router-dom'
import { render, screen, fireEvent, waitFor } from '../../../tests/helpers/render'
import { resetAllStores } from '../../../tests/helpers/store'
import MagazineDialog from './MagazineDialog'
import type { MagazineJourney, MagazineStory } from '../Studio/magazineLayout'

const h = vi.hoisted(() => ({
  sources: vi.fn(), create: vi.fn(), journey: vi.fn(), story: vi.fn(), saveBook: vi.fn(),
}))
vi.mock('./magazineData', () => ({
  magazineApi: { sources: h.sources, create: h.create },
  loadJourneyFeature: h.journey,
  loadStoryFeature: h.story,
}))
vi.mock('../../api/client', async (orig) => {
  const real = await orig<typeof import('../../api/client')>()
  return { ...real, journeyApi: { ...real.journeyApi, saveBook: h.saveBook } }
})

const J: MagazineJourney = { kind: 'journey', title: 'Circular de Arévalo', subtitle: null, author: 'juanma', coverPhotoId: 1, entries: [], days: 3 }
const S: MagazineStory = { kind: 'story', title: 'Todo bajada', standfirst: null, author: 'juanma', date: '2026-05-02', coverPhotoId: 2, pieces: [{ type: 'p', text: 'Hola.' }] }

beforeEach(() => {
  resetAllStores()
  Object.values(h).forEach(f => f.mockReset())
  h.sources.mockResolvedValue({
    journeys: [{ id: 7, title: 'Circular de Arévalo', subtitle: null, cover_image: null, entry_count: 3, photo_count: 9, date_min: '2026-05-01', date_max: '2026-05-03' }],
    stories: [{ id: 'abc', journey_id: 1, title: 'Todo bajada', slug: 'todo-bajada', excerpt: null, cover_photo_id: 2, status: 'published', post_date: '2026-05-02', published_at: 1, version: 1, created_at: 1, updated_at: 1, author: { username: 'juanma' } }],
  })
  h.create.mockResolvedValue({ journey_id: 42, volume: 3 })
  h.journey.mockResolvedValue(J)
  h.story.mockResolvedValue(S)
  h.saveBook.mockResolvedValue({ book: {} })
})

describe('MagazineDialog', () => {
  it('FE-MAG-UI-001: picks in click order, creates on the server, lays out, saves the book and opens the Studio', async () => {
    render(<Routes><Route path="/journey" element={<MagazineDialog onClose={() => {}} />} /><Route path="/journey/:id/studio" element={<div>Studio</div>} /></Routes>, { initialEntries: ['/journey'] })
    const create = await screen.findByTestId('mag-create')
    expect(create).toBeDisabled()
    fireEvent.click(await screen.findByTestId('mag-pick-s:abc'))
    fireEvent.click(screen.getByTestId('mag-pick-j:7'))
    expect(screen.getByTestId('mag-pick-s:abc')).toHaveTextContent('1')
    expect(screen.getByTestId('mag-pick-j:7')).toHaveTextContent('2')
    fireEvent.click(create)
    await screen.findByText('Studio')
    expect(h.create).toHaveBeenCalledWith({ title: '#ESTODOBAJADA', journey_ids: [7], story_ids: ['abc'] })
    expect(h.saveBook).toHaveBeenCalledTimes(1)
    const [id, { document }] = h.saveBook.mock.calls[0]
    expect(id).toBe(42)
    expect(document.page.pageWidth).toBe(120)
    // The story was picked first, so it opens the issue (first in the contents).
    const contents = document.spreads[1].elements.filter((e: { kind: string }) => e.kind === 'text').map((e: { text: string }) => e.text)
    expect(contents.indexOf('Todo bajada')).toBeLessThan(contents.indexOf('Circular de Arévalo'))
    expect(document.spreads[0].elements.some((e: { text?: string }) => e.text?.includes('VOL. 3'))).toBe(true)
  })

  it('FE-MAG-UI-002: a failure says so and lets you try again', async () => {
    h.create.mockRejectedValue(new Error('boom'))
    render(<MagazineDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByTestId('mag-pick-j:7'))
    fireEvent.click(screen.getByTestId('mag-create'))
    await waitFor(() => expect(screen.getByTestId('mag-create')).not.toBeDisabled())
    expect(h.saveBook).not.toHaveBeenCalled()
  })
})

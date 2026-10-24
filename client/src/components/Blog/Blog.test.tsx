// FE-BLOG-UI-001 …
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { Routes, Route } from 'react-router-dom'
import { render, screen, fireEvent, waitFor } from '../../../tests/helpers/render'
import { server } from '../../../tests/helpers/msw/server'
import { http, HttpResponse } from 'msw'
import { SketchCanvas } from './SketchCanvas'
import BlockEditor from './BlockEditor'
import BlogPostView from './BlogPostView'
import EntriesPanel from './EntriesPanel'
import type { JourneyMeta } from '../../blog/journeyMeta'
import JourneyBlogPage from '../../pages/JourneyBlogPage'
import { offlineDb, clearAll } from '../../db/offlineDb'
import { emptyPost, _resetBlogSync } from '../../blog/blogSync'
import type { BlogBlock, SketchStroke } from '../../blog/types'

vi.mock('../Journey/JourneyMapAuto', () => ({ default: () => <div data-testid="map" /> }))
vi.mock('../Journey/JourneyMap', () => ({ default: () => <div data-testid="map" /> }))
vi.mock('../Layout/Navbar', () => ({ default: () => <nav /> }))

function sizeSvg(el: Element) {
  (el as SVGSVGElement).getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 310, right: 500, bottom: 310, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  ;(el as SVGSVGElement).setPointerCapture = () => {}
}

describe('SketchCanvas', () => {
  const draw = (el: Element, pointerType: string, pressure = 0.5) => {
    fireEvent.pointerDown(el, { pointerId: 1, pointerType, clientX: 50, clientY: 50, pressure, button: 0, buttons: 1 })
    fireEvent.pointerMove(el, { pointerId: 1, pointerType, clientX: 100, clientY: 80, pressure })
    fireEvent.pointerMove(el, { pointerId: 1, pointerType, clientX: 150, clientY: 120, pressure })
    fireEvent.pointerUp(el, { pointerId: 1, pointerType, clientX: 150, clientY: 120 })
  }

  it('FE-BLOG-UI-001: a pen stroke keeps the real pressure, in units of the drawing width', () => {
    const onChange = vi.fn()
    render(<SketchCanvas strokes={[]} aspect={0.62} background="paper" tool="pen" color="#2563eb" size={4} penOnly={false} onPenDetected={() => {}} onChange={onChange} />)
    const svg = screen.getByTestId('sketch-canvas')
    sizeSvg(svg)
    draw(svg, 'pen', 0.8)
    const [strokes] = onChange.mock.calls[0] as [SketchStroke[]]
    expect(strokes).toHaveLength(1)
    expect(strokes[0]).toMatchObject({ c: '#2563eb', w: 4, tool: 'pen' })
    expect(strokes[0].p.slice(0, 3)).toEqual([100, 100, 0.8])     // 50px of 500 → 100/1000
  })

  it('FE-BLOG-UI-002: with "pen only" on, a palm or finger draws nothing; the first pen use is reported', () => {
    const onChange = vi.fn(), onPen = vi.fn()
    render(<SketchCanvas strokes={[]} aspect={0.62} background="paper" tool="pen" color="#000000" size={4} penOnly onPenDetected={onPen} onChange={onChange} />)
    const svg = screen.getByTestId('sketch-canvas')
    sizeSvg(svg)
    draw(svg, 'touch')
    expect(onChange).not.toHaveBeenCalled()
    draw(svg, 'pen', 0.4)
    expect(onPen).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('FE-BLOG-UI-003: the eraser removes the strokes it passes over', () => {
    const onChange = vi.fn()
    const strokes: SketchStroke[] = [
      { c: '#000000', w: 4, tool: 'pen', p: [100, 100, 0.5, 120, 100, 0.5] },
      { c: '#000000', w: 4, tool: 'pen', p: [800, 500, 0.5, 820, 500, 0.5] },
    ]
    render(<SketchCanvas strokes={strokes} aspect={0.62} background="paper" tool="eraser" color="#000000" size={4} penOnly={false} onPenDetected={() => {}} onChange={onChange} />)
    const svg = screen.getByTestId('sketch-canvas')
    sizeSvg(svg)
    fireEvent.pointerDown(svg, { pointerId: 2, pointerType: 'mouse', clientX: 55, clientY: 50, button: 0, buttons: 1 })
    expect((onChange.mock.calls[0][0] as SketchStroke[]).map(s => s.p[0])).toEqual([800])
  })
})

describe('BlockEditor', () => {
  const base = (blocks: BlogBlock[], onChange = vi.fn()) => {
    render(<BlockEditor blocks={blocks} onChange={onChange} meta={null} maps={{}} postDate="2026-05-01" selectedId={null} onSelect={() => {}} requestPhotos={() => {}} touch={false} />)
    return onChange
  }

  it('FE-BLOG-UI-004: "Add block" → Heading appends a heading (an empty last line is replaced)', () => {
    const onChange = base([{ id: 'a', type: 'paragraph', text: 'Hola' }])
    fireEvent.click(screen.getByText('Add block'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Heading/ }))
    expect((onChange.mock.calls[0][0] as BlogBlock[]).map(b => b.type)).toEqual(['paragraph', 'heading'])
  })

  it('FE-BLOG-UI-005: Enter on an empty last line starts a new paragraph; Backspace on an empty one removes it', () => {
    const onChange = base([{ id: 'a', type: 'paragraph', text: 'Hola\n' }, { id: 'b', type: 'paragraph', text: '' }])
    const [first, second] = screen.getAllByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement[]
    first.setSelectionRange(first.value.length, first.value.length)
    fireEvent.keyDown(first, { key: 'Enter' })
    const after = onChange.mock.calls[0][0] as BlogBlock[]
    expect(after.map(b => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect((after[0] as { text: string }).text).toBe('Hola')
    fireEvent.keyDown(second, { key: 'Backspace' })
    expect((onChange.mock.calls[1][0] as BlogBlock[]).map(b => b.id)).toEqual(['a'])
  })

  it('FE-BLOG-UI-006: a photo block asks for photos and is inserted with what was picked', () => {
    const onChange = vi.fn()
    const requestPhotos = vi.fn((_m: boolean, done: (r: { galleryId: number; photoId: number }[]) => void) => done([{ galleryId: 3, photoId: 7 }]))
    render(<BlockEditor blocks={[{ id: 'a', type: 'paragraph', text: 'x' }]} onChange={onChange} meta={null} maps={{}} postDate={null} selectedId={null} onSelect={() => {}} requestPhotos={requestPhotos} touch={false} />)
    fireEvent.click(screen.getByText('Add block'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Photo/ }))
    expect(requestPhotos).toHaveBeenCalledWith(false, expect.any(Function))
    const out = onChange.mock.calls[0][0] as BlogBlock[]
    expect(out[1]).toMatchObject({ type: 'photo', photo: { galleryId: 3, photoId: 7 }, layout: 'wide' })
  })
})

describe('BlogPostView', () => {
  it('FE-BLOG-UI-007: renders markdown, headings, quotes, public photo URLs, sketches and entry cards', () => {
    render(<BlogPostView isPublic ctx={{ publicToken: 'tok', maps: {}, entries: [{ id: 5, title: 'Vuelta', story: 'Río', entry_date: '2026-05-03', location_name: 'Adaja', photo_id: null }] }} blocks={[
      { id: 'p', type: 'paragraph', text: 'Salimos de **Arévalo**' },
      { id: 'h', type: 'heading', text: 'Viento', level: 2 },
      { id: 'q', type: 'quote', text: 'La meseta', cite: 'Yo' },
      { id: 'f', type: 'photo', photo: { galleryId: 1, photoId: 42 }, layout: 'wide', caption: 'Castillo' },
      { id: 's', type: 'sketch', aspect: 0.62, background: 'grid', strokes: [{ c: '#000000', w: 4, tool: 'pen', p: [0, 0, 0.5, 10, 10, 0.5] }] },
      { id: 'e', type: 'entry', entryId: 5 },
    ]} />)
    expect(screen.getByText('Arévalo').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { name: 'Viento' })).toBeInTheDocument()
    expect(screen.getByText('— Yo')).toBeInTheDocument()
    expect((screen.getByAltText('Castillo') as HTMLImageElement).src).toContain('/api/public/journey/tok/photos/42/original')
    expect(screen.getByText('Vuelta')).toBeInTheDocument()
    expect(document.querySelectorAll('svg path').length).toBeGreaterThan(0)
  })
})

describe('JourneyBlogPage', () => {
  beforeEach(async () => {
    _resetBlogSync()
    await clearAll()
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  const mount = (path: string) => render(
    <Routes>
      <Route path="/journey/:id/blog" element={<JourneyBlogPage />} />
      <Route path="/journey/:id/blog/:postId" element={<JourneyBlogPage />} />
    </Routes>,
    { initialEntries: [path] },
  )

  const serve = (access: 'edit' | 'view', role: 'owner' | 'viewer') => {
    const post = { ...emptyPost(3, { id: 'post-ui-00001', title: 'Arévalo' }), dirty: 0 as const, baseVersion: 1 }
    server.use(
      http.get('/api/journeys/3', () => HttpResponse.json({ id: 3, title: 'Castilla', my_role: role, entries: [], gallery: [] })),
      http.get('/api/journeys/3/blog', () => HttpResponse.json({ access, posts: [{ id: post.id, journey_id: 3, title: 'Arévalo', slug: 'arevalo', excerpt: null, cover_photo_id: null, status: 'private', post_date: '2026-05-01', published_at: null, version: 1, created_at: 1, updated_at: 1, author: null }] })),
      http.get('/api/journeys/3/blog/posts/:id', () => HttpResponse.json({ post: { id: post.id, journey_id: 3, title: 'Arévalo', slug: 'arevalo', excerpt: null, cover_photo_id: null, status: 'private', post_date: '2026-05-01', published_at: null, version: 1, created_at: 1, updated_at: 1, author: null, blocks: [{ id: 'b', type: 'paragraph', text: 'Hola' }], entry_ids: [], entries: [], maps: {} } })),
    )
    return post
  }

  it('FE-BLOG-UI-008: an editor opening a post lands in the editor once permissions are known (it used to stay in reading mode on tablets)', async () => {
    serve('edit', 'owner')
    mount('/journey/3/blog/post-ui-00001')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument())
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement).value).toBe('Arévalo')
  })

  it('FE-BLOG-UI-009: a viewer reads the post and gets no editing controls', async () => {
    serve('view', 'viewer')
    mount('/journey/3/blog/post-ui-00001')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Arévalo' })).toBeInTheDocument())
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
    expect(screen.queryByText('Publish')).toBeNull()
  })

  it('FE-BLOG-UI-010: the list shows posts and, for editors, the new-post button', async () => {
    serve('edit', 'owner')
    mount('/journey/3/blog')
    await waitFor(() => expect(screen.getByText('Arévalo')).toBeInTheDocument())
    expect(screen.getByText('New post')).toBeInTheDocument()
    expect(await offlineDb.blogPosts.get('post-ui-00001')).toBeTruthy()     // cached for offline reading
  })
})

const META: JourneyMeta = {
  id: 3, title: 'Castilla', subtitle: null, cover_image: null, my_role: 'owner', gallery: [],
  entries: [
    { id: 11, title: 'Salida desde Arévalo', entry_date: '2026-05-01', location_name: 'Arévalo', type: 'entry', story: 'Salimos **temprano**.\n\nHacía frío.', photo_id: 70, photo_ids: [{ galleryId: 7, photoId: 70 }, { galleryId: 8, photoId: 80 }] },
    { id: 12, title: 'Madrigal', entry_date: '2026-05-02', location_name: null, type: 'entry', story: null, photo_id: null, photo_ids: [] },
  ],
}

describe('EntriesPanel', () => {
  it('FE-BLOG-UI-011: shows the journey entries by day with their text, and brings text and photos into the post', () => {
    const onInsert = vi.fn(), onToggleLink = vi.fn()
    render(<EntriesPanel meta={META} mode="editor" linkedIds={[11]} onInsert={onInsert} onToggleLink={onToggleLink} />)
    expect(screen.getByText('Day 1', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Day 2', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('temprano').tagName).toBe('STRONG')
    fireEvent.click(screen.getAllByText('Use text and photos')[0])
    expect((onInsert.mock.calls[0][0] as BlogBlock[]).map(b => b.type)).toEqual(['heading', 'paragraph', 'paragraph', 'gallery'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert this photo into the post' })[1])
    expect(onInsert.mock.calls[1][0][0]).toMatchObject({ type: 'photo', photo: { galleryId: 8, photoId: 80 } })
    fireEvent.click(screen.getAllByText('As a card')[1])
    expect(onInsert.mock.calls[2][0][0]).toMatchObject({ type: 'entry', entryId: 12 })
    fireEvent.click(screen.getAllByRole('button', { name: /^Link$/ })[0])
    expect(onToggleLink).toHaveBeenCalledWith(12)
  })

  it('FE-BLOG-UI-012: search narrows the list; "linked only" keeps the linked ones', () => {
    render(<EntriesPanel meta={META} mode="editor" linkedIds={[11]} onInsert={() => {}} onToggleLink={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search entries…' }), { target: { value: 'madrigal' } })
    expect(screen.queryByText('Salida desde Arévalo')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search entries…' }), { target: { value: '' } })
    fireEvent.click(screen.getByText('Linked only'))
    expect(screen.queryByText('Madrigal')).toBeNull()
    expect(screen.getByText('Salida desde Arévalo')).toBeInTheDocument()
  })
})

describe('Blog from an entry', () => {
  beforeEach(async () => {
    _resetBlogSync()
    await clearAll()
    localStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    server.use(
      http.get('/api/journeys/3', () => HttpResponse.json({ ...META, entries: META.entries.map(e => ({ ...e, photos: e.photo_ids.map(p => ({ id: p.galleryId, photo_id: p.photoId })) })), gallery: [] })),
      http.get('/api/journeys/3/blog', () => HttpResponse.json({ access: 'edit', posts: [] })),
      http.put('/api/journeys/3/blog/posts/:id', () => HttpResponse.json({ error: 'offline in test' }, { status: 503 })),
    )
  })

  it('FE-BLOG-UI-013: the list has a tab with the journey entries, and "write a post" starts one with its title, date, text and link', async () => {
    render(
      <Routes>
        <Route path="/journey/:id/blog" element={<JourneyBlogPage />} />
        <Route path="/journey/:id/blog/:postId" element={<JourneyBlogPage />} />
      </Routes>,
      { initialEntries: ['/journey/3/blog'] },
    )
    fireEvent.click(await screen.findByRole('button', { name: /Journey entries/ }))
    fireEvent.click((await screen.findAllByText('Write a post from this entry'))[0])
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement).value).toBe('Salida desde Arévalo'))
    const texts = (screen.getAllByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement[]).map(t => t.value)
    expect(texts).toEqual(['Salimos **temprano**.', 'Hacía frío.'])
    await waitFor(async () => {
      const [saved] = await offlineDb.blogPosts.toArray()
      expect(saved).toMatchObject({ title: 'Salida desde Arévalo', post_date: '2026-05-01', entry_ids: [11] })
    })
  })
})

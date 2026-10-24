/**
 * Blog offline sync — FE-BLOG-SYNC-001 …
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { server } from '../../helpers/msw/server'
import { http, HttpResponse } from 'msw'
import { offlineDb, clearAll } from '../../../src/db/offlineDb'
import {
  emptyPost, saveLocal, addPhotos, flush, getLocalPost, deleteLocal, resolveConflict, refreshJourney, pendingCount, _resetBlogSync,
} from '../../../src/blog/blogSync'
import { apiClient } from '../../../src/api/client'

// A multipart POST hangs under MSW + jsdom (see filesSlice.test.ts), so the
// upload is answered at the API boundary; everything else goes through MSW.
function mockUploads(handler: (clientId: string, form: FormData, config: any) => Promise<unknown>) {
  const real = apiClient.post.bind(apiClient)
  return vi.spyOn(apiClient, 'post').mockImplementation((async (url: string, body: unknown, config?: unknown) => {
    if (String(url).endsWith('/blog/uploads')) {
      const form = body as FormData
      return handler(String(form.get('client_id')), form, config)
    }
    return real(url, body, config as any)
  }) as any)
}
const netError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })
const httpError = (status: number, data: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } })
import type { ServerPost } from '../../../src/blog/types'

const J = 7

function serverPost(over: Partial<ServerPost> = {}): ServerPost {
  return {
    id: 'p1', journey_id: J, title: 'T', slug: 't', excerpt: null, cover_photo_id: null, status: 'draft', post_date: '2026-05-01',
    published_at: null, version: 1, created_at: 1, updated_at: 1, author: { id: 1, username: 'juanma' },
    blocks: [], entry_ids: [], own_entry_id: null, add_to_journey: false, entries: [], maps: {}, ...over,
  }
}

const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, writable: true, configurable: true })

beforeEach(async () => {
  _resetBlogSync()
  await clearAll()
  setOnline(true)
})
afterEach(() => { vi.restoreAllMocks() })

describe('blogSync', () => {
  it('FE-BLOG-SYNC-001: written offline it stays on the device; online, photos upload first and the post goes with gallery ids', async () => {
    setOnline(false)
    const post = emptyPost(J, { id: 'post-aaaa-0001', title: 'Arévalo' })
    const [ref] = await addPhotos(J, post.id, [new File([new Uint8Array([1, 2, 3])], 'IMG_1.jpg', { type: 'image/jpeg' })])
    await saveLocal({ ...post, blocks: [{ id: 'b1', type: 'photo', photo: ref, layout: 'wide' }] })
    await flush()
    expect((await getLocalPost(post.id))?.dirty).toBe(1)
    expect(await pendingCount(J)).toMatchObject({ posts: 1, photos: 1 })

    const calls: string[] = []
    let sentBody: any = null
    let clientId = ''
    let uploadConfig: any = null
    mockUploads(async (id, form, config) => {
      calls.push('upload')
      clientId = id
      uploadConfig = config
      expect((form.get('photo') as File).name).toBe('IMG_1.jpg')
      return { data: { upload: { client_id: id, gallery_id: 55, photo_id: 99 } } }
    })
    server.use(
      http.put(`/api/journeys/${J}/blog/posts/${post.id}`, async ({ request }) => {
        calls.push('put')
        sentBody = await request.json()
        return HttpResponse.json({ post: serverPost({ id: post.id, title: 'Arévalo', blocks: sentBody.blocks, version: 1 }) }, { status: 201 })
      }),
    )
    setOnline(true)
    await flush()
    expect(calls).toEqual(['upload', 'put'])
    expect(clientId).toBe(ref.localId)
    expect(uploadConfig.headers['Content-Type']).toBe('multipart/form-data')
    expect(uploadConfig.timeout).toBeGreaterThan(60_000)
    expect(sentBody.blocks[0].photo).toEqual({ galleryId: 55, photoId: 99 })
    expect(sentBody.base_version).toBeNull()
    const stored = await getLocalPost(post.id)
    expect(stored).toMatchObject({ dirty: 0, baseVersion: 1 })
    expect(await pendingCount(J)).toMatchObject({ posts: 0, photos: 0 })
  })

  it('FE-BLOG-SYNC-002: a network error leaves everything pending, and the retry reuses the same client_id', async () => {
    const ids: string[] = []
    let fail = true
    mockUploads(async (id) => {
      ids.push(id)
      if (fail) throw netError()
      return { data: { upload: { gallery_id: 1, photo_id: 2 } } }
    })
    server.use(http.put(`/api/journeys/${J}/blog/posts/:id`, async ({ request }) => HttpResponse.json({ post: serverPost({ id: 'post-bbbb-0001', blocks: ((await request.json()) as any).blocks }) })))
    const post = emptyPost(J, { id: 'post-bbbb-0001' })
    const [ref] = await addPhotos(J, post.id, [new Blob([new Uint8Array([1])], { type: 'image/jpeg' })])
    await saveLocal({ ...post, blocks: [{ id: 'g', type: 'gallery', photos: [ref], layout: 'grid' }] })
    await flush()
    expect((await offlineDb.blogUploads.get(ref.localId!))?.status).toBe('pending')
    expect((await getLocalPost(post.id))?.dirty).toBe(1)
    fail = false
    await flush()
    expect(ids).toEqual([ref.localId, ref.localId])
    expect((await getLocalPost(post.id))?.dirty).toBe(0)
  })

  it('FE-BLOG-SYNC-003: a 409 keeps my copy and stores theirs; "keep mine" resends with force-free newer base, "theirs" replaces', async () => {
    let n = 0
    const bodies: any[] = []
    server.use(http.put(`/api/journeys/${J}/blog/posts/:id`, async ({ request }) => {
      bodies.push(await request.json())
      n++
      if (n === 1) return HttpResponse.json({ error: 'Conflict', post: serverPost({ id: 'post-cccc-0001', title: 'De la tablet', version: 4 }) }, { status: 409 })
      return HttpResponse.json({ post: serverPost({ id: 'post-cccc-0001', title: 'Del móvil', version: 5 }) })
    }))
    await offlineDb.blogPosts.put({ ...emptyPost(J, { id: 'post-cccc-0001', title: 'Del móvil' }), baseVersion: 3 })
    await flush()
    const c = await getLocalPost('post-cccc-0001')
    expect(c?.conflict?.title).toBe('De la tablet')
    expect(c?.title).toBe('Del móvil')
    await resolveConflict('post-cccc-0001', 'mine')
    await flush()
    expect(bodies[1].base_version).toBe(4)
    expect(await getLocalPost('post-cccc-0001')).toMatchObject({ title: 'Del móvil', baseVersion: 5, conflict: null, dirty: 0 })
  })

  it('FE-BLOG-SYNC-004: a photo the server refuses for good is dropped from the post instead of blocking it forever', async () => {
    let body: any = null
    mockUploads(async () => { throw httpError(400, { error: 'File type .heic is not allowed' }) })
    server.use(
      http.put(`/api/journeys/${J}/blog/posts/:id`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ post: serverPost({ id: 'post-dddd-0001', blocks: body.blocks }) }) }),
    )
    const post = emptyPost(J, { id: 'post-dddd-0001' })
    const [ref] = await addPhotos(J, post.id, [new File([new Uint8Array([1])], 'x.heic', { type: 'image/heic' })])
    await saveLocal({ ...post, blocks: [{ id: 't', type: 'paragraph', text: 'hola' }, { id: 'p', type: 'photo', photo: ref, layout: 'wide' }] })
    await flush()
    expect(body.blocks.map((b: any) => b.type)).toEqual(['paragraph'])
    expect(await pendingCount(J)).toMatchObject({ failedPhotos: 1, posts: 0 })
  })

  it('FE-BLOG-SYNC-005: deleting a never-sent post is local only; deleting a synced one is sent (and a 404 is fine)', async () => {
    const deletes: string[] = []
    server.use(http.delete(`/api/journeys/${J}/blog/posts/:id`, ({ params }) => { deletes.push(String(params.id)); return HttpResponse.json({ error: 'nf' }, { status: 404 }) }))
    setOnline(false)
    const a = await saveLocal(emptyPost(J, { id: 'post-eeee-0001' }))
    await deleteLocal(a.id)
    expect(await getLocalPost(a.id)).toBeUndefined()
    await offlineDb.blogPosts.put({ ...emptyPost(J, { id: 'post-eeee-0002' }), baseVersion: 2, dirty: 0 })
    await deleteLocal('post-eeee-0002')
    setOnline(true)
    await flush()
    expect(deletes).toEqual(['post-eeee-0002'])
    expect(await getLocalPost('post-eeee-0002')).toBeUndefined()
  })

  it('FE-BLOG-SYNC-006: refresh caches new server posts for offline reading, never overwrites local edits, and drops ones deleted elsewhere', async () => {
    await offlineDb.blogPosts.put({ ...emptyPost(J, { id: 'mine-dirty-01', title: 'Local' }), baseVersion: 1, dirty: 1 })
    await offlineDb.blogPosts.put({ ...emptyPost(J, { id: 'gone-else-001' }), baseVersion: 1, dirty: 0 })
    server.use(
      http.get(`/api/journeys/${J}/blog`, () => HttpResponse.json({ access: 'edit', posts: [serverPost({ id: 'mine-dirty-01', version: 2 }), serverPost({ id: 'new-remote-01', version: 1 })] })),
      http.get(`/api/journeys/${J}/blog/posts/:id`, ({ params }) => HttpResponse.json({ post: serverPost({ id: String(params.id), title: 'Remoto', version: 2 }) })),
    )
    const r = await refreshJourney(J)
    expect(r?.access).toBe('edit')
    expect((await getLocalPost('mine-dirty-01'))?.title).toBe('Local')
    expect((await getLocalPost('new-remote-01'))?.title).toBe('Remoto')
    expect(await getLocalPost('gone-else-001')).toBeUndefined()
  })

  it('FE-BLOG-SYNC-007: edits made while a save was in flight stay pending on top of the new version', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    server.use(http.put(`/api/journeys/${J}/blog/posts/:id`, async () => {
      await gate
      return HttpResponse.json({ post: serverPost({ id: 'post-ffff-0001', title: 'v1', version: 1 }) })
    }))
    const p = await saveLocal(emptyPost(J, { id: 'post-ffff-0001', title: 'v1' }))
    const inFlight = flush()
    await new Promise(r => setTimeout(r, 20))
    await offlineDb.blogPosts.put({ ...p, title: 'v2', localUpdatedAt: p.localUpdatedAt + 1000 })
    release()
    await inFlight
    expect(await getLocalPost('post-ffff-0001')).toMatchObject({ title: 'v2', baseVersion: 1, dirty: 1 })
  })
})

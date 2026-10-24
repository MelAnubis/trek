/**
 * Blog — almacenamiento local y sincronización.
 *
 * El dispositivo es la fuente de verdad mientras se escribe: cada cambio se
 * guarda en IndexedDB (Dexie) al momento, con o sin red, y `flush()` lo
 * envía cuando se puede:
 *
 *   1. fotos pendientes → POST /blog/uploads con su client_id (idempotente:
 *      si la respuesta se pierde y se reenvía, no se duplica);
 *   2. posts con cambios → se sustituyen las fotos locales por las de la
 *      galería y PUT /blog/posts/:id (el id es del cliente, así que también
 *      es idempotente). Un post que aún espera alguna foto se queda para la
 *      siguiente vuelta;
 *   3. posts borrados → DELETE.
 *
 * Si el servidor tiene una versión más nueva (otro dispositivo), responde
 * 409: se guarda su copia en `conflict` y la interfaz deja elegir.
 */
import { offlineDb } from '../db/offlineDb'
import { apiClient } from '../api/client'
import { generateUUID } from '../sync/mutationQueue'
import type { BlogBlock, BlogUpload, LocalPost, PhotoRef, ServerPost, ServerPostSummary } from './types'

type Listener = () => void
const listeners = new Set<Listener>()
export function subscribeBlog(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function emit() { for (const fn of [...listeners]) { try { fn() } catch { /* listener roto */ } } }

const httpStatus = (err: unknown) => (err as { response?: { status?: number } })?.response?.status
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export function newId(): string { return generateUUID() }

// ── Posts locales ────────────────────────────────────────────────────────────

export function localFromServer(p: ServerPost): LocalPost {
  const { blocks, ...server } = p
  return {
    id: p.id, journeyId: p.journey_id, title: p.title, blocks, status: p.status, post_date: p.post_date,
    entry_ids: p.entry_ids ?? [], cover_photo_id: p.cover_photo_id, add_to_journey: !!p.add_to_journey,
    baseVersion: p.version, server, dirty: 0, deleted: 0, localUpdatedAt: Date.now(), syncError: null, conflict: null,
  }
}

export function emptyPost(journeyId: number, init: Partial<LocalPost> = {}): LocalPost {
  return {
    id: newId(), journeyId, title: '', blocks: [{ id: newId(), type: 'paragraph', text: '' }], status: 'draft',
    post_date: new Date().toISOString().slice(0, 10), entry_ids: [], cover_photo_id: null, add_to_journey: false,
    baseVersion: null, server: null, dirty: 1, deleted: 0, localUpdatedAt: Date.now(), syncError: null, conflict: null,
    ...init,
  }
}

export async function getLocalPost(id: string): Promise<LocalPost | undefined> {
  return offlineDb.blogPosts.get(id)
}

export async function listLocalPosts(journeyId: number): Promise<LocalPost[]> {
  return (await offlineDb.blogPosts.where('journeyId').equals(journeyId).toArray()).filter(p => !p.deleted)
}

/** Guarda en el dispositivo (siempre funciona) y programa el envío. */
export async function saveLocal(post: LocalPost): Promise<LocalPost> {
  const next: LocalPost = { ...post, dirty: 1, localUpdatedAt: Date.now(), syncError: null }
  await offlineDb.blogPosts.put(next)
  emit()
  scheduleFlush()
  return next
}

export async function deleteLocal(id: string): Promise<void> {
  const p = await offlineDb.blogPosts.get(id)
  if (!p) return
  if (p.baseVersion == null) await offlineDb.blogPosts.delete(id)      // nunca llegó al servidor
  else await offlineDb.blogPosts.put({ ...p, deleted: 1, dirty: 1, localUpdatedAt: Date.now() })
  emit()
  scheduleFlush()
}

/** Resolver un conflicto: quedarse con la copia del servidor, o forzar la propia. */
export async function resolveConflict(id: string, keep: 'mine' | 'theirs'): Promise<void> {
  const p = await offlineDb.blogPosts.get(id)
  if (!p?.conflict) return
  if (keep === 'theirs') await offlineDb.blogPosts.put(localFromServer(p.conflict))
  else await offlineDb.blogPosts.put({ ...p, baseVersion: p.conflict.version, conflict: null, dirty: 1, localUpdatedAt: Date.now() })
  emit()
  scheduleFlush()
}

// ── Fotos ────────────────────────────────────────────────────────────────────

function toArrayBuffer(b: Blob): Promise<ArrayBuffer> {
  if (typeof (b as Blob).arrayBuffer === 'function') return b.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(b)
  })
}

/** Guarda las fotos en el dispositivo y devuelve referencias locales para los bloques. */
export async function addPhotos(journeyId: number, postId: string | null, files: File[] | Blob[]): Promise<PhotoRef[]> {
  const refs: PhotoRef[] = []
  for (const f of files) {
    const id = newId()
    const name = (f as File).name || `foto-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
    await offlineDb.blogUploads.put({
      id, journeyId, postId, data: await toArrayBuffer(f), name, mime: f.type || 'image/jpeg', status: 'pending',
      galleryId: null, photoId: null, width: null, height: null, attempts: 0, error: null, createdAt: Date.now(),
    })
    refs.push({ localId: id })
  }
  emit()
  scheduleFlush()
  return refs
}

export async function getUpload(id: string): Promise<BlogUpload | undefined> {
  return offlineDb.blogUploads.get(id)
}

/** Sustituye las referencias locales ya subidas. `missing` = alguna aún pendiente. */
export async function resolveRefs(blocks: BlogBlock[]): Promise<{ blocks: BlogBlock[]; missing: number; failed: number }> {
  let missing = 0, failed = 0
  const cache = new Map<string, BlogUpload | undefined>()
  const fix = async (r: PhotoRef): Promise<PhotoRef> => {
    if (!r.localId) return r
    if (!cache.has(r.localId)) cache.set(r.localId, await offlineDb.blogUploads.get(r.localId))
    const u = cache.get(r.localId)
    if (u?.status === 'done' && u.galleryId && u.photoId) return { galleryId: u.galleryId, photoId: u.photoId }
    if (!u || u.status === 'failed') failed++
    else missing++
    return r
  }
  const out: BlogBlock[] = []
  for (const b of blocks) {
    if (b.type === 'photo') out.push({ ...b, photo: await fix(b.photo) })
    else if (b.type === 'gallery') out.push({ ...b, photos: await Promise.all(b.photos.map(fix)) })
    else out.push(b)
  }
  return { blocks: out, missing, failed }
}

/** Quita del post las fotos cuya subida falló definitivamente (el servidor no las aceptaría). */
function dropFailed(blocks: BlogBlock[], failedIds: Set<string>): BlogBlock[] {
  const bad = (r: PhotoRef) => !!r.localId && failedIds.has(r.localId)
  return blocks.flatMap((b): BlogBlock[] => {
    if (b.type === 'photo') return bad(b.photo) ? [] : [b]
    if (b.type === 'gallery') {
      const photos = b.photos.filter(r => !bad(r))
      return photos.length ? [{ ...b, photos }] : []
    }
    return [b]
  })
}

// ── Envío ────────────────────────────────────────────────────────────────────

let flushing: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Tests: olvida un envío en curso o programado. */
export function _resetBlogSync(): void {
  flushing = null
  if (timer) { clearTimeout(timer); timer = null }
}

export function scheduleFlush(delay = 1200): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; flush().catch(() => { /* se reintenta en el siguiente disparo */ }) }, delay)
}

export function flush(): Promise<void> {
  if (flushing) return flushing
  flushing = doFlush().finally(() => { flushing = null; emit() })
  return flushing
}

async function uploadOne(u: BlogUpload): Promise<'ok' | 'stop'> {
  const form = new FormData()
  form.append('client_id', u.id)
  form.append('photo', new Blob([u.data], { type: u.mime }), u.name)
  try {
    // multipart (el cliente manda JSON por defecto) y sin el corte de 8 s:
    // una foto del móvil con poca cobertura tarda bastante más.
    const { data } = await apiClient.post(`/journeys/${u.journeyId}/blog/uploads`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000,
    })
    const up = data.upload as { gallery_id: number; photo_id: number; width?: number | null; height?: number | null }
    await offlineDb.blogUploads.put({ ...u, status: 'done', galleryId: up.gallery_id, photoId: up.photo_id, width: up.width ?? null, height: up.height ?? null, error: null })
    return 'ok'
  } catch (err) {
    const s = httpStatus(err)
    const permanent = s !== undefined && s >= 400 && s < 500 && s !== 408 && s !== 429
    await offlineDb.blogUploads.put({ ...u, attempts: u.attempts + 1, status: permanent ? 'failed' : 'pending', error: (err as Error)?.message ?? String(err) })
    return permanent ? 'ok' : 'stop'
  }
}

async function pushPost(p: LocalPost): Promise<'ok' | 'stop'> {
  const startedAt = p.localUpdatedAt
  if (p.deleted) {
    try {
      await apiClient.delete(`/journeys/${p.journeyId}/blog/posts/${p.id}`)
      await offlineDb.blogPosts.delete(p.id)
      return 'ok'
    } catch (err) {
      const s = httpStatus(err)
      if (s === 404) { await offlineDb.blogPosts.delete(p.id); return 'ok' }
      if (s !== undefined && s >= 400 && s < 500) { await offlineDb.blogPosts.put({ ...p, syncError: String(s) }); return 'ok' }
      return 'stop'
    }
  }

  const failedIds = new Set((await offlineDb.blogUploads.where('status').equals('failed').toArray()).map(u => u.id))
  const resolved = await resolveRefs(dropFailed(p.blocks, failedIds))
  if (resolved.missing) return 'ok'                 // espera a que suban sus fotos
  const body = {
    title: p.title, blocks: resolved.blocks, status: p.status, post_date: p.post_date, entry_ids: p.entry_ids,
    cover_photo_id: p.cover_photo_id, add_to_journey: p.add_to_journey, base_version: p.baseVersion,
  }
  try {
    const { data } = await apiClient.put(`/journeys/${p.journeyId}/blog/posts/${p.id}`, body, { timeout: 60_000 })
    const server = data.post as ServerPost
    const current = await offlineDb.blogPosts.get(p.id)
    // Si se siguió escribiendo mientras viajaba la petición, lo nuevo se queda
    // pendiente (sobre la versión que acaba de devolver el servidor).
    if (current && current.localUpdatedAt !== startedAt) {
      const again = await resolveRefs(current.blocks)
      const { blocks: _b, ...meta } = server
      await offlineDb.blogPosts.put({ ...current, blocks: again.blocks, baseVersion: server.version, server: meta, conflict: null, syncError: null })
    } else {
      await offlineDb.blogPosts.put(localFromServer(server))
    }
    return 'ok'
  } catch (err) {
    const s = httpStatus(err)
    const data = (err as { response?: { data?: { post?: ServerPost; error?: string } } })?.response?.data
    if (s === 409 && data?.post) { await offlineDb.blogPosts.put({ ...p, conflict: data.post }); return 'ok' }
    if (s !== undefined && s >= 400 && s < 500) { await offlineDb.blogPosts.put({ ...p, syncError: data?.error || String(s) }); return 'ok' }
    return 'stop'
  }
}

/**
 * Las fotos ya subidas se guardan unos días en el dispositivo para verlas sin
 * red (el post ya apunta a la galería); después se liberan.
 */
const KEEP_DONE_MS = 14 * 24 * 3600 * 1000
async function pruneUploads(): Promise<void> {
  const old = await offlineDb.blogUploads.where('createdAt').below(Date.now() - KEEP_DONE_MS).toArray()
  const ids = old.filter(u => u.status === 'done').map(u => u.id)
  if (ids.length) await offlineDb.blogUploads.bulkDelete(ids)
}

async function doFlush(): Promise<void> {
  await pruneUploads().catch(() => {})
  if (isOffline()) return
  const uploads = (await offlineDb.blogUploads.where('status').equals('pending').toArray()).sort((a, b) => a.createdAt - b.createdAt)
  for (const u of uploads) {
    if ((await uploadOne(u)) === 'stop') return
    emit()
  }
  const dirty = await offlineDb.blogPosts.where('dirty').equals(1).toArray()
  for (const p of dirty.sort((a, b) => a.localUpdatedAt - b.localUpdatedAt)) {
    if (p.conflict) continue
    if ((await pushPost(p)) === 'stop') return
    emit()
  }
}

// ── Lectura desde el servidor ────────────────────────────────────────────────

export interface BlogListing { access: 'edit' | 'view'; posts: ServerPostSummary[] }

/**
 * Trae la lista del servidor y deja en el dispositivo la última versión de
 * cada post (para leerlo y editarlo sin red). Nunca pisa cambios locales.
 */
export async function refreshJourney(journeyId: number): Promise<BlogListing | null> {
  if (isOffline()) return null
  let listing: BlogListing
  try {
    listing = (await apiClient.get(`/journeys/${journeyId}/blog`)).data
  } catch {
    return null
  }
  const local = new Map((await offlineDb.blogPosts.where('journeyId').equals(journeyId).toArray()).map(p => [p.id, p]))
  const onServer = new Set(listing.posts.map(p => p.id))
  for (const s of listing.posts) {
    const l = local.get(s.id)
    if (l?.dirty) continue
    if (l && l.baseVersion === s.version && l.server) continue
    try {
      const { data } = await apiClient.get(`/journeys/${journeyId}/blog/posts/${s.id}`)
      const latest = await offlineDb.blogPosts.get(s.id)
      if (!latest?.dirty) await offlineDb.blogPosts.put(localFromServer(data.post))
    } catch { /* se intentará otra vez */ }
  }
  // Borrados en otro dispositivo (o que dejaron de ser visibles).
  for (const [id, l] of local) if (!onServer.has(id) && !l.dirty && l.baseVersion != null) await offlineDb.blogPosts.delete(id)
  emit()
  return listing
}

/** Recarga un post (p. ej. tras un aviso por WebSocket), sin pisar cambios locales. */
export async function refreshPost(journeyId: number, postId: string): Promise<void> {
  if (isOffline()) return
  try {
    const { data } = await apiClient.get(`/journeys/${journeyId}/blog/posts/${postId}`)
    const latest = await offlineDb.blogPosts.get(postId)
    if (!latest?.dirty) { await offlineDb.blogPosts.put(localFromServer(data.post)); emit() }
  } catch (err) {
    if (httpStatus(err) === 404) {
      const latest = await offlineDb.blogPosts.get(postId)
      if (latest && !latest.dirty) { await offlineDb.blogPosts.delete(postId); emit() }
    }
  }
}

/** Cuántas cosas quedan por enviar en esta travesía (para el indicador). */
export async function pendingCount(journeyId: number): Promise<{ posts: number; photos: number; failedPhotos: number; conflicts: number }> {
  const posts = await offlineDb.blogPosts.where('journeyId').equals(journeyId).toArray()
  const ups = await offlineDb.blogUploads.where('journeyId').equals(journeyId).toArray()
  return {
    posts: posts.filter(p => p.dirty && !p.conflict).length,
    photos: ups.filter(u => u.status === 'pending').length,
    failedPhotos: ups.filter(u => u.status === 'failed').length,
    conflicts: posts.filter(p => p.conflict).length,
  }
}

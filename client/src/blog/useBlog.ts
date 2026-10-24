import { useCallback, useEffect, useRef, useState } from 'react'
import {
  subscribeBlog, listLocalPosts, getLocalPost, refreshJourney, pendingCount, getUpload, flush,
} from './blogSync'
import type { LocalPost, PhotoRef } from './types'

/** Posts de una travesía en este dispositivo, refrescados desde el servidor cuando hay red. */
export function useBlogPosts(journeyId: number | null) {
  const [posts, setPosts] = useState<LocalPost[]>([])
  const [access, setAccess] = useState<'edit' | 'view' | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  const reload = useCallback(async () => {
    if (journeyId == null) return
    setPosts(await listLocalPosts(journeyId))
  }, [journeyId])

  useEffect(() => {
    if (journeyId == null) return
    let alive = true
    const unsub = subscribeBlog(() => { if (alive) reload() })
    reload().then(async () => {
      const listing = await refreshJourney(journeyId)
      if (!alive) return
      if (listing) setAccess(listing.access)
      setLoading(false)
      flush().catch(() => {})
    })
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { alive = false; unsub(); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [journeyId, reload])

  return { posts, access, loading, online, reload }
}

export function useLocalPost(postId: string | null) {
  const [post, setPost] = useState<LocalPost | null | undefined>(undefined)
  useEffect(() => {
    if (!postId) { setPost(null); return }
    let alive = true
    const load = () => getLocalPost(postId).then(p => { if (alive) setPost(p ?? null) })
    load()
    const unsub = subscribeBlog(load)
    return () => { alive = false; unsub() }
  }, [postId])
  return post
}

export function usePendingBlog(journeyId: number | null) {
  const [state, setState] = useState({ posts: 0, photos: 0, failedPhotos: 0, conflicts: 0 })
  useEffect(() => {
    if (journeyId == null) return
    let alive = true
    const load = () => pendingCount(journeyId).then(s => { if (alive) setState(s) })
    load()
    const unsub = subscribeBlog(load)
    return () => { alive = false; unsub() }
  }, [journeyId])
  return state
}

/**
 * URL de una foto de un bloque: la del servidor (o la pública), o la copia
 * que guarda el dispositivo si aún no se ha subido o no hay red.
 */
export function usePhotoSrc(ref: PhotoRef | null | undefined, size: 'thumbnail' | 'original', publicToken?: string | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  const localId = ref?.localId
  useEffect(() => {
    let alive = true
    if (localId) {
      getUpload(localId).then(u => {
        if (!alive || !u) return
        const url = URL.createObjectURL(new Blob([u.data], { type: u.mime }))
        urlRef.current = url
        setBlobUrl(url)
      })
    } else setBlobUrl(null)
    return () => {
      alive = false
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    }
  }, [localId])
  if (localId) return blobUrl
  if (!ref?.photoId) return null
  return publicToken ? `/api/public/journey/${publicToken}/photos/${ref.photoId}/${size}` : `/api/photos/${ref.photoId}/${size}`
}

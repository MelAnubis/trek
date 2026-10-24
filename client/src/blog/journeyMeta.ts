import { useEffect, useState } from 'react'
import { journeyApi } from '../api/client'

/**
 * Lo que el editor del blog necesita de la travesía: sus entradas (para
 * enlazarlas) y su galería (para elegir fotos). Se guarda una copia mínima en
 * el dispositivo para poder escribir sin red.
 */
export interface JourneyMeta {
  id: number
  title: string
  subtitle: string | null
  cover_image: string | null
  my_role: 'owner' | 'editor' | 'viewer' | null
  entries: { id: number; title: string | null; entry_date: string; location_name: string | null; type: string; photo_id: number | null; story: string | null; photo_ids: { galleryId: number; photoId: number }[] }[]
  gallery: { galleryId: number; photoId: number; taken_at: string | null }[]
}

const key = (id: number) => `trek_blog_journey_${id}`

function fromServer(j: any): JourneyMeta {
  return {
    id: j.id, title: j.title, subtitle: j.subtitle ?? null, cover_image: j.cover_image ?? null, my_role: j.my_role ?? null,
    entries: (j.entries || []).filter((e: any) => e.type !== 'skeleton' || e.title).map((e: any) => ({
      id: e.id, title: e.title ?? null, entry_date: e.entry_date, location_name: e.location_name ?? null, type: e.type,
      story: e.story ? String(e.story).slice(0, 2000) : null,
      photo_id: e.photos?.[0]?.photo_id ?? null,
      photo_ids: (e.photos || []).map((p: any) => ({ galleryId: p.id, photoId: p.photo_id })),
    })),
    gallery: (j.gallery || []).map((g: any) => ({ galleryId: g.id, photoId: g.photo_id, taken_at: g.taken_at ?? null })),
  }
}

export function readCachedMeta(id: number): JourneyMeta | null {
  try { return JSON.parse(localStorage.getItem(key(id)) || 'null') } catch { return null }
}

export function useJourneyMeta(journeyId: number | null) {
  const [meta, setMeta] = useState<JourneyMeta | null>(() => (journeyId != null ? readCachedMeta(journeyId) : null))
  const [error, setError] = useState(false)
  const reload = async () => {
    if (journeyId == null) return
    try {
      const m = fromServer(await journeyApi.get(journeyId))
      setMeta(m)
      setError(false)
      try { localStorage.setItem(key(journeyId), JSON.stringify(m)) } catch { /* lleno */ }
    } catch {
      setError(true)
    }
  }
  useEffect(() => {
    if (journeyId == null) return
    setMeta(readCachedMeta(journeyId))
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId])
  return { meta, error, reload }
}

import { useEffect, useState } from 'react'
import type { BookPhotoElement } from '../../types/book'
import { fetchImageAsBlob } from '../../api/authUrl'
import { useJourneyStore } from '../../store/journeyStore'

/**
 * How sharp a photo will print. Ported from liketrek/TREK's photoDpi
 * (shared/src/book/book-findings.ts) and usePhotoPixels
 * (client/src/components/Studio/photo/usePhotoPixels.ts), same AGPLv3
 * license.
 *
 * Under about 200 dots per inch a print shop's own preflight flags a picture
 * as soft; the inspector says so beside the photo, before the book is ordered
 * rather than after it arrives.
 */

/** Below this many dots per inch a photo prints visibly soft. */
export const MIN_PRINT_DPI = 200

export interface PhotoPixels {
  width: number
  height: number
}

/**
 * The dots per inch a photo prints at in its frame, or null when either size
 * is unknown. `cover` fills the frame, so the axis that has to stretch more
 * decides; `contain` fits the whole picture, so the one that stretches less.
 * (A zoom, from 5.6, will divide this further — each pixel spread over more paper.)
 */
export function photoDpi(el: Pick<BookPhotoElement, 'frame' | 'fit'>, pixels: PhotoPixels | null | undefined, zoom = 1): number | null {
  if (!pixels?.width || !pixels.height || el.frame.w <= 0 || el.frame.h <= 0) return null
  const mmPerPx = el.fit === 'contain'
    ? Math.min(el.frame.w / pixels.width, el.frame.h / pixels.height)
    : Math.max(el.frame.w / pixels.width, el.frame.h / pixels.height)
  return Math.round(25.4 / (mmPerPx * Math.max(1, zoom)))
}

/** The size the journey already knows for a photo (trek_photos' width/height), when it does. */
function knownPixels(photoId: number): PhotoPixels | null {
  const current = useJourneyStore.getState().current
  if (!current) return null
  const all = [...(current.gallery ?? []), ...(current.entries ?? []).flatMap(e => e.photos ?? [])]
  const hit = all.find(p => p.photo_id === photoId && p.width && p.height)
  return hit ? { width: hit.width as number, height: hit.height as number } : null
}

/**
 * The pixel size of the photo the book prints (its original), measured by
 * loading it — the canvas loads that same original from a zoom of a third up,
 * so most of the time the browser already has it. The journey's stored size
 * stands in while it loads. Null for an empty frame, and for a picture whose
 * size is unknown and will not load: better nothing than a guess.
 */
export function usePhotoPixels(photoId: number | null): PhotoPixels | null {
  const [seen, setSeen] = useState<{ photoId: number; pixels: PhotoPixels } | null>(null)

  useEffect(() => {
    if (photoId == null) return undefined
    let cancelled = false
    let blob = ''
    const img = new Image()
    img.onload = () => {
      if (cancelled || !img.naturalWidth || !img.naturalHeight) return
      setSeen({ photoId, pixels: { width: img.naturalWidth, height: img.naturalHeight } })
    }
    fetchImageAsBlob(`/api/photos/${photoId}/original`).then(url => {
      if (cancelled) { if (url) URL.revokeObjectURL(url); return }
      blob = url
      if (url) img.src = url
    }).catch(() => { /* the stored size, if any, stays */ })
    return () => {
      cancelled = true
      img.onload = null
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [photoId])

  if (photoId == null) return null
  return seen && seen.photoId === photoId ? seen.pixels : knownPixels(photoId)
}

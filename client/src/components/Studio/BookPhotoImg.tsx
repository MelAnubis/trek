import { useEffect, useState } from 'react'
import { fetchImageAsBlob } from '../../api/authUrl'

/**
 * Renders a trek_photos.id as an <img>, the same blob-fetch way
 * MemoriesPanel.tsx's ProviderImg does — a plain `<img src="/api/photos/…">`
 * doesn't reliably carry the auth cookie in every browser context, so photos
 * are always fetched as an authenticated blob and handed to the <img> as an
 * object URL.
 */
export function BookPhotoImg({ photoId, big, style }: { photoId: number; big: boolean; style?: React.CSSProperties }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let revoke = ''
    fetchImageAsBlob(`/api/photos/${photoId}/${big ? 'original' : 'thumbnail'}`).then(blobUrl => {
      revoke = blobUrl
      setSrc(blobUrl)
    })
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [photoId, big])
  return src ? <img src={src} alt="" draggable={false} loading="lazy" style={style} /> : null
}

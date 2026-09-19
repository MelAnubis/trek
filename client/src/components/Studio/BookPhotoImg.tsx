import { useEffect, useState } from 'react'
import { fetchImageAsBlob } from '../../api/authUrl'

/**
 * Renders a trek_photos.id as an <img>.
 *
 * Editing (`print` false, the default): the same blob-fetch MemoriesPanel.tsx's
 * ProviderImg does — a plain `<img src="/api/photos/…">` doesn't reliably
 * carry the auth cookie in every browser context, so the photo is fetched as
 * an authenticated blob and handed to the <img> as an object URL.
 *
 * Export (`print` true): a plain `<img src>`, same as JourneyBookPDF.tsx's
 * `pSrc()` — proven in the same sandboxed print iframe already. This is not
 * a style choice: StudioExport.tsx reads `innerHTML` out of an off-screen
 * render synchronously, before a blob fetch could possibly resolve, so a
 * blob <img> simply isn't in the DOM yet when it's captured — every export
 * came out with the photo frames empty. Worse, the same effect then unmounts
 * that render right after, which revokes any blob URL that *did* make it in
 * time — so even a lucky race handed the print iframe a dead URL. A plain
 * `src` exists the instant React renders the element and is never revoked.
 */
export function BookPhotoImg({ photoId, big, print, style }: { photoId: number; big: boolean; print?: boolean; style?: React.CSSProperties }) {
  const url = `/api/photos/${photoId}/${big ? 'original' : 'thumbnail'}`
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (print) return
    let revoke = ''
    fetchImageAsBlob(url).then(blobUrl => {
      revoke = blobUrl
      setSrc(blobUrl)
    })
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [url, print])

  if (print) return <img src={url} alt="" draggable={false} style={style} />
  return src ? <img src={src} alt="" draggable={false} loading="lazy" style={style} /> : null
}

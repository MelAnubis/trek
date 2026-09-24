import { useEffect, useState } from 'react'
import { fetchImageAsBlob } from '../../api/authUrl'

/**
 * Renders a trek_photos.id as an <img>.
 *
 * Editing (`print` false, no `publicToken`, the default): the same
 * blob-fetch MemoriesPanel.tsx's ProviderImg does — a plain
 * `<img src="/api/photos/…">` doesn't reliably carry the auth cookie in
 * every browser context, so the photo is fetched as an authenticated blob
 * and handed to the <img> as an object URL.
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
 *
 * Public share (`publicToken` set): also a plain `<img src>`, against the
 * token-gated proxy (journeyPublic.ts) instead of the authenticated
 * `/api/photos/…` route — there's no session cookie for an anonymous
 * visitor to carry, and the proxy needs none.
 */
export function BookPhotoImg({ photoId, big, print, publicToken, style }: { photoId: number; big: boolean; print?: boolean; publicToken?: string; style?: React.CSSProperties }) {
  const kind = big ? 'original' : 'thumbnail'
  const url = publicToken
    ? `/api/public/journey/${publicToken}/photos/${photoId}/${kind}`
    : `/api/photos/${photoId}/${kind}`
  const plain = print || !!publicToken
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (plain) return
    let revoke = ''
    fetchImageAsBlob(url).then(blobUrl => {
      revoke = blobUrl
      setSrc(blobUrl)
    })
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [url, plain])

  if (plain) return <img src={url} alt="" draggable={false} loading={publicToken ? 'lazy' : undefined} style={style} />
  return src ? <img src={src} alt="" draggable={false} loading="lazy" style={style} /> : null
}

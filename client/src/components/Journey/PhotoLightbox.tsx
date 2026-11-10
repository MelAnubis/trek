import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchImageAsBlob } from '../../api/authUrl'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface LightboxPhoto {
  id: string
  src: string
  caption?: string | null
  provider?: string
  asset_id?: string | null
  owner_id?: number | null
}

interface Props {
  photos: LightboxPhoto[]
  startIndex?: number
  onClose: () => void
}
function PhotoImg({ src, caption }: { src: string; caption?: string | null }) {
  const [blobUrl, setBlobUrl] = useState('')
  useEffect(() => {
    let revoke = ''
    fetchImageAsBlob(src).then(url => { revoke = url; setBlobUrl(url) })
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [src])
  return blobUrl ? (
    <img className="!max-w-[92vw] !max-h-[92vh] !object-contain !rounded-[4px]" src={blobUrl} alt={caption || ''} style={{ animation: 'fadeIn 0.15s ease' }} />
  ) : (
    <div className="!w-[60px] !h-[60px] !rounded-[50%] ![border:3px_solid_rgba(255,255,255,0.2)] ![border-top-color:#fff]" style={{ animation: 'spin 0.8s linear infinite' }} />
  )
}
export default function PhotoLightbox({ photos, startIndex = 0, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const photo = photos[idx]
  const hasPrev = idx > 0
  const hasNext = idx < photos.length - 1

  const prev = useCallback(() => { if (hasPrev) setIdx(i => i - 1) }, [hasPrev])
  const next = useCallback(() => { if (hasNext) setIdx(i => i + 1) }, [hasNext])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onClose])

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y

    // swipe down to close
    if (dy > 80 && Math.abs(dx) < 60) {
      onClose()
      return
    }
    // horizontal swipe
    if (Math.abs(dx) > 50 && Math.abs(dy) < 80) {
      if (dx < 0) next()
      else prev()
    }
    touchStart.current = null
  }

  if (!photo) return null

  return (
    <div className="!fixed !inset-[0] !z-[500] ![background:rgba(0,0,0,0.92)] ![backdrop-filter:blur(20px)] !flex !flex-col !pb-[var(--bottom-nav-h)]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Photo area — centered with nav overlays */}
      <div
        className="group/lightbox !flex-[1] !flex !items-center !justify-center !relative !overflow-hidden"
      >
        {/* Top bar */}
        <div className="!absolute !top-[0] !left-[0] !right-[0] !z-[10] !flex !justify-between !items-center !p-[16px_20px]">
          <span className="![color:rgba(255,255,255,0.5)] !text-[length:13px] !font-[500]">
            {idx + 1} / {photos.length}
          </span>
          <button className="![background:rgba(255,255,255,0.1)] ![border:none] !rounded-[50%] !w-[36px] !h-[36px] !flex !items-center !justify-center ![color:#fff] !cursor-pointer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Prev button — visible on hover (desktop), always visible (mobile) */}
        {hasPrev && (
          <button onClick={prev} className="flex sm:opacity-0 sm:group-hover/lightbox:opacity-100 transition-opacity !absolute !left-[16px] !z-[5] !w-[44px] !h-[44px] !rounded-[50%] ![background:rgba(0,0,0,0.4)] ![backdrop-filter:blur(8px)] ![border:1px_solid_rgba(255,255,255,0.1)] !items-center !justify-center ![color:#fff] !cursor-pointer">
            <ChevronLeft size={22} />
          </button>
        )}
        <PhotoImg src={photo.src} caption={photo.caption} />

        {/* Next button */}
        {hasNext && (
          <button onClick={next} className="flex sm:opacity-0 sm:group-hover/lightbox:opacity-100 transition-opacity !absolute !right-[16px] !z-[5] !w-[44px] !h-[44px] !rounded-[50%] ![background:rgba(0,0,0,0.4)] ![backdrop-filter:blur(8px)] ![border:1px_solid_rgba(255,255,255,0.1)] !items-center !justify-center ![color:#fff] !cursor-pointer">
            <ChevronRight size={22} />
          </button>
        )}

        {/* Caption — bottom center overlay */}
        {photo.caption && (
          <div className="!absolute !bottom-[20px] !left-[50%] !z-[5] !max-w-[70%] !text-center" style={{ transform: 'translateX(-50%)' }}>
            <p className="!text-[length:14px] !italic ![color:rgba(255,255,255,0.75)] !m-[0] !leading-[1.5] ![background:rgba(0,0,0,0.3)] ![backdrop-filter:blur(8px)] !p-[6px_14px] !rounded-[10px]">{photo.caption}</p>
          </div>
        )}
      </div>
    </div>
  )
}

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Images, Check, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { PhotoRef } from '../../blog/types'
import type { JourneyMeta } from '../../blog/journeyMeta'

/**
 * Elegir fotos para un bloque: hacer una con la cámara, traerlas de la
 * galería del dispositivo (se guardan en el móvil y se suben solas) o
 * escoger entre las que ya tiene la travesía.
 */
export default function PhotoPicker({ meta, multiple, onPickFiles, onPickExisting, onClose }: {
  meta: JourneyMeta | null
  multiple: boolean
  onPickFiles: (files: File[]) => void
  onPickExisting: (refs: PhotoRef[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const camRef = useRef<HTMLInputElement>(null)
  const libRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<number[]>([])
  const gallery = useMemo(() => [...(meta?.gallery || [])].reverse(), [meta])

  const files = (list: FileList | null) => {
    const arr = list ? Array.from(list).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) : []
    if (arr.length) onPickFiles(multiple ? arr : arr.slice(0, 1))
  }
  const toggle = (gid: number) => setSelected(s => (s.includes(gid) ? s.filter(x => x !== gid) : multiple ? [...s, gid] : [gid]))

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-[640px] max-h-[88vh] flex flex-col bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('blog.photos.pick')}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-[15px] font-semibold">{t('blog.photos.pick')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          <button type="button" onClick={() => camRef.current?.click()} className="h-20 rounded-xl border border-zinc-200 dark:border-zinc-700 flex flex-col items-center justify-center gap-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <Camera size={22} />{t('blog.photos.camera')}
          </button>
          <button type="button" onClick={() => libRef.current?.click()} className="h-20 rounded-xl border border-zinc-200 dark:border-zinc-700 flex flex-col items-center justify-center gap-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <Images size={22} />{t('blog.photos.device')}
          </button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="photo-camera" onChange={e => { files(e.target.files); e.target.value = '' }} />
          <input ref={libRef} type="file" accept="image/*" multiple={multiple} className="hidden" data-testid="photo-device" onChange={e => { files(e.target.files); e.target.value = '' }} />
        </div>
        <div className="px-4 pb-1 text-[12px] uppercase tracking-[0.08em] text-zinc-500">{t('blog.photos.fromJourney')}</div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {gallery.length ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {gallery.map(g => {
                const on = selected.includes(g.galleryId)
                return (
                  <button key={g.galleryId} type="button" onClick={() => toggle(g.galleryId)} aria-pressed={on}
                    className={`relative aspect-square rounded-lg overflow-hidden ${on ? 'ring-[3px] ring-indigo-500' : ''}`}>
                    <img src={`/api/photos/${g.photoId}/thumbnail`} alt="" loading="lazy" className="w-full h-full object-cover" />
                    {on && <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center"><Check size={14} /></span>}
                  </button>
                )
              })}
            </div>
          ) : <p className="text-sm text-zinc-500 py-6 text-center">{t('blog.photos.noneYet')}</p>}
        </div>
        {selected.length > 0 && (
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
            <button type="button" className="w-full h-11 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium"
              onClick={() => onPickExisting(selected.map(gid => ({ galleryId: gid, photoId: gallery.find(g => g.galleryId === gid)!.photoId })))}>
              {t('blog.photos.add', { count: selected.length })}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

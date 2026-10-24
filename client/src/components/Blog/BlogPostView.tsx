import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react'
import type { BlogBlock, EntryCard, MapContext, PhotoRef } from '../../blog/types'
import { usePhotoSrc } from '../../blog/useBlog'
import { useTranslation } from '../../i18n'
import { SketchView } from './SketchCanvas'
import JourneyMapAuto from '../Journey/JourneyMapAuto'
import JourneyMap from '../Journey/JourneyMap'
import { DAY_COLORS } from '../Journey/dayColors'

export interface BlogViewContext {
  /** Token del enlace público: las fotos se piden por la ruta pública. */
  publicToken?: string | null
  maps?: Record<string, MapContext>
  entries?: EntryCard[]
  dark?: boolean
}

/** Tipografía de lectura: serif para el texto largo, como un cuaderno de viaje. */
export const READING_FONT = "'Iowan Old Style', 'Charter', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif"

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 text-[var(--blog-accent)]">{children}</a>,
        p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
        h1: ({ children }) => <h3 className="text-xl font-semibold mt-6 mb-2 font-sans">{children}</h3>,
        h2: ({ children }) => <h3 className="text-xl font-semibold mt-6 mb-2 font-sans">{children}</h3>,
        h3: ({ children }) => <h4 className="text-lg font-semibold mt-5 mb-2 font-sans">{children}</h4>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--blog-accent)] pl-4 italic opacity-90 my-4">{children}</blockquote>,
        hr: () => <hr className="my-8 border-zinc-200 dark:border-zinc-800" />,
        img: () => null,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function Photo({ refp, ctx, className, onOpen, size = 'original', alt }: { refp: PhotoRef; ctx: BlogViewContext; className?: string; onOpen?: () => void; size?: 'thumbnail' | 'original'; alt?: string }) {
  const src = usePhotoSrc(refp, size, ctx.publicToken)
  if (!src) return <div className={`bg-zinc-100 dark:bg-zinc-800 animate-pulse ${className || ''}`} />
  return <img src={src} alt={alt || ''} loading="lazy" decoding="async" className={`${className || ''} ${onOpen ? 'cursor-zoom-in' : ''}`} onClick={onOpen} draggable={false} />
}

interface LightboxState { photos: PhotoRef[]; index: number; caption?: string }

function Lightbox({ state, ctx, onClose }: { state: LightboxState; ctx: BlogViewContext; onClose: () => void }) {
  const [i, setI] = useState(state.index)
  const n = state.photos.length
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI(v => (v + 1) % n)
      if (e.key === 'ArrowLeft') setI(v => (v - 1 + n) % n)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [n, onClose])
  // Deslizar con el dedo para pasar de foto.
  const [x0, setX0] = useState<number | null>(null)
  return createPortal(
    <div className="fixed inset-0 z-[400] bg-black/95 flex items-center justify-center" onClick={onClose}
      onTouchStart={e => setX0(e.touches[0].clientX)}
      onTouchEnd={e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) setI(v => (v + (dx < 0 ? 1 : -1) + n) % n); setX0(null) }}>
      <button className="absolute top-3 right-3 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center" style={{ top: 'max(12px, env(safe-area-inset-top))' }} aria-label="Cerrar" onClick={onClose}><X size={20} /></button>
      {n > 1 && <button className="absolute left-2 w-11 h-11 rounded-full bg-white/10 text-white hidden sm:flex items-center justify-center" onClick={e => { e.stopPropagation(); setI((i - 1 + n) % n) }} aria-label="‹"><ChevronLeft /></button>}
      <div className="max-w-[96vw] max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <Photo refp={state.photos[i]} ctx={ctx} className="max-w-[96vw] max-h-[86vh] object-contain mx-auto" />
        {(state.caption || n > 1) && <p className="text-white/80 text-sm text-center mt-3">{state.caption}{n > 1 ? `  ·  ${i + 1}/${n}` : ''}</p>}
      </div>
      {n > 1 && <button className="absolute right-2 w-11 h-11 rounded-full bg-white/10 text-white hidden sm:flex items-center justify-center" onClick={e => { e.stopPropagation(); setI((i + 1) % n) }} aria-label="›"><ChevronRight /></button>}
    </div>,
    document.body,
  )
}

function Caption({ text }: { text?: string }) {
  if (!text?.trim()) return null
  return <figcaption className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-2 text-center font-sans px-4">{text}</figcaption>
}

/** Ancho de cada maquetación: la columna de texto, más ancho, o a sangre. */
const WIDTH = {
  inline: 'max-w-[460px] mx-auto',
  wide: '',
  full: 'w-screen max-w-[1200px] relative left-1/2 -translate-x-1/2',
}

export function MapBlockView({ ctx, map, height = 320, isPublic }: { ctx: MapContext | undefined; map: Extract<BlogBlock, { type: 'map' }>; height?: number; isPublic?: boolean }) {
  const { t } = useTranslation()
  const data = useMemo(() => {
    if (!ctx) return null
    const dates = [...new Set(ctx.entries.map(e => e.date))].sort()
    const entries = ctx.entries.map(e => {
      const d = dates.indexOf(e.date)
      return { id: String(e.id), lat: e.lat, lng: e.lng, title: e.title, entry_date: e.date, dayColor: DAY_COLORS[d % DAY_COLORS.length], dayLabel: d + 1 }
    })
    const trail = ctx.tracks.map((tr, i) => ({ points: tr.points.map(([lat, lng]) => ({ lat, lng })), color: DAY_COLORS[i % DAY_COLORS.length] }))
    return { entries, trail, empty: !entries.length && !trail.length && !ctx.photos.length }
  }, [ctx])
  if (!data) return <div className="rounded-xl bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 text-sm font-sans flex items-center justify-center gap-2" style={{ height: 140 }}><MapPin size={16} />{t('blog.map.pending')}</div>
  if (data.empty) return <div className="rounded-xl bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 text-sm font-sans flex items-center justify-center gap-2" style={{ height: 120 }}><MapPin size={16} />{t('blog.map.empty')}</div>
  const Map = isPublic ? JourneyMap : JourneyMapAuto
  return (
    <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 isolate">
      <Map entries={data.entries} trail={data.trail} height={height} />
    </div>
  )
}

function EntryCardView({ e, ctx }: { e: EntryCard; ctx: BlogViewContext }) {
  const { locale } = useTranslation()
  const date = new Date(`${e.entry_date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  return (
    <div className="flex gap-4 items-stretch rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 overflow-hidden font-sans">
      {e.photo_id ? <Photo refp={{ photoId: e.photo_id }} ctx={ctx} size="thumbnail" className="w-28 sm:w-36 object-cover shrink-0" /> : <div className="w-2 shrink-0 bg-[var(--blog-accent)]" />}
      <div className="py-3 pr-4 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">{date}{e.location_name ? ` · ${e.location_name}` : ''}</div>
        <div className="font-semibold text-[15px] mt-0.5">{e.title || '—'}</div>
        {e.story && <p className="text-[13px] text-zinc-600 dark:text-zinc-400 mt-1 line-clamp-3">{e.story}</p>}
      </div>
    </div>
  )
}

export function BlockView({ block, ctx, openLightbox, isPublic }: { block: BlogBlock; ctx: BlogViewContext; openLightbox: (s: LightboxState) => void; isPublic?: boolean }) {
  switch (block.type) {
    case 'paragraph':
      return block.text.trim() ? <div className="text-[18px] leading-[1.75]"><Markdown text={block.text} /></div> : null
    case 'heading':
      return block.level === 2
        ? <h2 className="font-sans text-[26px] sm:text-[28px] font-bold tracking-[-0.015em] leading-tight mt-4">{block.text}</h2>
        : <h3 className="font-sans text-[20px] font-semibold tracking-[-0.01em] mt-2">{block.text}</h3>
    case 'quote':
      return (
        <blockquote className="my-2 pl-5 border-l-[3px] border-[var(--blog-accent)]">
          <p className="text-[22px] leading-snug italic">{block.text}</p>
          {block.cite && <footer className="text-[13px] font-sans text-zinc-500 mt-2">— {block.cite}</footer>}
        </blockquote>
      )
    case 'photo':
      return (
        <figure className={WIDTH[block.layout]}>
          <Photo refp={block.photo} ctx={ctx} alt={block.caption} className={`w-full h-auto ${block.layout === 'full' ? '' : 'rounded-xl'}`}
            onOpen={() => openLightbox({ photos: [block.photo], index: 0, caption: block.caption })} />
          <Caption text={block.caption} />
        </figure>
      )
    case 'gallery': {
      const ps = block.photos
      if (!ps.length) return null
      const open = (i: number) => openLightbox({ photos: ps, index: i, caption: block.caption })
      if (block.layout === 'carousel') {
        return (
          <figure className="w-screen max-w-[1200px] relative left-1/2 -translate-x-1/2">
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pb-2" style={{ scrollbarWidth: 'thin' }}>
              {ps.map((p, i) => <Photo key={i} refp={p} ctx={ctx} size="original" onOpen={() => open(i)} className="h-[260px] sm:h-[380px] w-auto snap-center rounded-xl object-cover shrink-0" />)}
            </div>
            <Caption text={block.caption} />
          </figure>
        )
      }
      if (block.layout === 'mosaic') {
        return (
          <figure>
            <div className="columns-2 sm:columns-3 gap-2 [&>*]:mb-2">
              {ps.map((p, i) => <Photo key={i} refp={p} ctx={ctx} size="thumbnail" onOpen={() => open(i)} className="w-full rounded-lg break-inside-avoid" />)}
            </div>
            <Caption text={block.caption} />
          </figure>
        )
      }
      const cols = ps.length === 1 ? 'grid-cols-1' : ps.length === 2 || ps.length === 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'
      return (
        <figure>
          <div className={`grid ${cols} gap-2`}>
            {ps.map((p, i) => <Photo key={i} refp={p} ctx={ctx} size="thumbnail" onOpen={() => open(i)} className="w-full aspect-square object-cover rounded-lg" />)}
          </div>
          <Caption text={block.caption} />
        </figure>
      )
    }
    case 'map':
      return (
        <figure>
          <MapBlockView ctx={ctx.maps?.[block.id]} map={block} isPublic={isPublic} />
          <Caption text={block.caption} />
        </figure>
      )
    case 'sketch':
      return (
        <figure className="max-w-[640px] mx-auto">
          <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
            <SketchView strokes={block.strokes} aspect={block.aspect} background={block.background} label={block.caption} />
          </div>
          <Caption text={block.caption} />
        </figure>
      )
    case 'divider':
      return <div className="flex justify-center gap-3 py-2 text-zinc-300 dark:text-zinc-700 select-none" aria-hidden>●  ●  ●</div>
    case 'entry': {
      const e = ctx.entries?.find(x => x.id === block.entryId)
      return e ? <EntryCardView e={e} ctx={ctx} /> : null
    }
    default:
      return null
  }
}

/** El cuerpo de un post (bloques), con su visor de fotos. */
export default function BlogPostView({ blocks, ctx, isPublic }: { blocks: BlogBlock[]; ctx: BlogViewContext; isPublic?: boolean }) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  return (
    <div className="blog-body flex flex-col gap-7" style={{ fontFamily: READING_FONT }}>
      {blocks.map(b => <BlockView key={b.id} block={b} ctx={ctx} openLightbox={setLightbox} isPublic={isPublic} />)}
      {lightbox && <Lightbox state={lightbox} ctx={ctx} onClose={() => setLightbox(null)} />}
    </div>
  )
}

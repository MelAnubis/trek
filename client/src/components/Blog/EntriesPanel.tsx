import { useMemo, useState } from 'react'
import { BookMarked, Check, ChevronDown, ChevronUp, FileText, Link2, MapPin, PenSquare, Search } from 'lucide-react'
import type { BlogBlock } from '../../blog/types'
import type { JourneyMeta } from '../../blog/journeyMeta'
import { blocksFromEntry, newBlock } from '../../blog/blockOps'
import { usePhotoSrc } from '../../blog/useBlog'
import { useTranslation } from '../../i18n'
import { READING_FONT, Markdown } from './BlogPostView'

type Entry = JourneyMeta['entries'][number]

function Thumb({ photoId, onClick, title }: { photoId: number; onClick?: () => void; title?: string }) {
  const src = usePhotoSrc({ photoId }, 'thumbnail')
  const img = src ? <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" draggable={false} /> : null
  return onClick
    ? <button type="button" onClick={onClick} title={title} aria-label={title} className="w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0 hover:ring-2 hover:ring-indigo-400">{img}</button>
    : <div className="w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">{img}</div>
}

function EntryCard({ e, linked, mode, onInsert, onToggleLink, onWrite }: {
  e: Entry
  linked: boolean
  mode: 'editor' | 'list' | 'read'
  onInsert?: (blocks: BlogBlock[]) => void
  onToggleLink?: () => void
  onWrite?: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const long = (e.story?.length || 0) > 220
  const empty = !e.story?.trim() && !e.photo_ids.length
  return (
    <div className={`rounded-xl border p-3 ${linked ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-500/5' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'} ${empty ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14px] leading-snug">{e.title || t('blog.post.untitled')}</div>
          {e.location_name && <div className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5"><MapPin size={10} />{e.location_name}</div>}
        </div>
        {linked && <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-300"><Link2 size={11} />{t('blog.entries.linked')}</span>}
      </div>

      {e.story?.trim() ? (
        <div className={`text-[14px] leading-relaxed text-zinc-700 dark:text-zinc-300 mt-2 ${open || !long ? '' : 'line-clamp-4'}`} style={{ fontFamily: READING_FONT }}>
          <Markdown text={e.story} />
        </div>
      ) : <p className="text-[12px] text-zinc-400 italic mt-2">{t('blog.entries.noText')}</p>}
      {long && (
        <button type="button" onClick={() => setOpen(v => !v)} className="text-[12px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 mt-1 inline-flex items-center gap-0.5">
          {open ? <><ChevronUp size={13} />{t('blog.entries.less')}</> : <><ChevronDown size={13} />{t('blog.entries.more')}</>}
        </button>
      )}

      {e.photo_ids.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1">
          {e.photo_ids.slice(0, 24).map(p => (
            <Thumb key={p.galleryId} photoId={p.photoId} title={mode === 'editor' ? t('blog.entries.insertPhoto') : undefined}
              onClick={mode === 'editor' && onInsert ? () => onInsert([newBlock('photo', { photos: [p] })]) : undefined} />
          ))}
        </div>
      )}

      {mode === 'editor' && onInsert && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <button type="button" onClick={() => onInsert(blocksFromEntry(e))} disabled={empty && !e.title}
            className="h-8 px-2.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40">
            <FileText size={13} />{t('blog.entries.use')}
          </button>
          <button type="button" onClick={() => onInsert([newBlock('entry', { entryId: e.id })])}
            className="h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[12px] font-medium inline-flex items-center gap-1.5">
            <BookMarked size={13} />{t('blog.entries.asCard')}
          </button>
          {onToggleLink && (
            <button type="button" onClick={onToggleLink} aria-pressed={linked}
              className={`h-8 px-2.5 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 ${linked ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}>
              {linked ? <Check size={13} /> : <Link2 size={13} />}{linked ? t('blog.entries.unlink') : t('blog.entries.link')}
            </button>
          )}
        </div>
      )}
      {mode === 'list' && onWrite && (
        <button type="button" onClick={onWrite} className="mt-2.5 h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[12px] font-medium inline-flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          <PenSquare size={13} />{t('blog.entries.writePost')}
        </button>
      )}
    </div>
  )
}

/**
 * Las entradas de la travesía, como referencia al escribir: por días, con su
 * texto y sus fotos. En el editor se puede traer su texto y fotos al post,
 * una foto suelta, insertarla como tarjeta o enlazarla; en la lista del
 * blog, empezar un post a partir de una entrada.
 */
export default function EntriesPanel({ meta, mode, linkedIds = [], onInsert, onToggleLink, onWrite }: {
  meta: JourneyMeta | null
  mode: 'editor' | 'list' | 'read'
  linkedIds?: number[]
  onInsert?: (blocks: BlogBlock[]) => void
  onToggleLink?: (entryId: number) => void
  onWrite?: (entryId: number) => void
}) {
  const { t, locale } = useTranslation()
  const [q, setQ] = useState('')
  const [onlyLinked, setOnlyLinked] = useState(false)

  const days = useMemo(() => {
    const s = q.trim().toLowerCase()
    const all = [...(meta?.entries || [])]
      .filter(e => !onlyLinked || linkedIds.includes(e.id))
      .filter(e => !s || `${e.title || ''} ${e.location_name || ''} ${e.story || ''}`.toLowerCase().includes(s))
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    const dates = [...new Set((meta?.entries || []).map(e => e.entry_date))].sort()
    const groups = new Map<string, Entry[]>()
    for (const e of all) groups.set(e.entry_date, [...(groups.get(e.entry_date) || []), e])
    return [...groups].map(([date, entries]) => ({ date, n: dates.indexOf(date) + 1, entries }))
  }, [meta, q, onlyLinked, linkedIds])

  if (!meta) return <p className="text-[13px] text-zinc-500 p-2">{t('blog.list.loading')}</p>
  if (!meta.entries.length) return <p className="text-[13px] text-zinc-500 p-2">{t('blog.entries.none')}</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('blog.entries.search')} aria-label={t('blog.entries.search')}
            className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-8 pr-3 text-sm" />
        </div>
        {mode === 'editor' && linkedIds.length > 0 && (
          <button type="button" onClick={() => setOnlyLinked(v => !v)} aria-pressed={onlyLinked}
            className={`h-9 px-2.5 rounded-lg text-[12px] font-medium whitespace-nowrap ${onlyLinked ? 'bg-indigo-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}>
            {t('blog.entries.onlyLinked')}
          </button>
        )}
      </div>
      {mode === 'editor' && <p className="text-[11px] text-zinc-500 -mt-1">{t('blog.entries.panelHint')}</p>}
      {days.map(d => (
        <section key={d.date}>
          <h3 className={`py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 ${mode === 'editor' ? 'sticky top-0 z-[1] bg-white dark:bg-zinc-950' : ''}`}>
            {t('blog.entries.day', { n: d.n })} · {new Date(`${d.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
          </h3>
          <div className="flex flex-col gap-2 mt-1">
            {d.entries.map(e => (
              <EntryCard key={e.id} e={e} mode={mode} linked={linkedIds.includes(e.id)}
                onInsert={onInsert} onToggleLink={onToggleLink ? () => onToggleLink(e.id) : undefined}
                onWrite={onWrite ? () => onWrite(e.id) : undefined} />
            ))}
          </div>
        </section>
      ))}
      {!days.length && <p className="text-[13px] text-zinc-500">{t('blog.entries.noMatch')}</p>}
    </div>
  )
}

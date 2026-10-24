import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Globe, Lock, PencilLine, Trash2, Link2, ArrowDownToLine, Search } from 'lucide-react'
import type { BlogBlock, BlogStatus, LocalPost } from '../../blog/types'
import type { JourneyMeta } from '../../blog/journeyMeta'
import { photosOf } from '../../blog/blockOps'
import { usePhotoSrc } from '../../blog/useBlog'
import { journeyApi } from '../../api/client'
import { useTranslation } from '../../i18n'

const label = 'text-[10px] font-semibold tracking-[0.12em] uppercase text-zinc-500 block mb-2'

function CoverThumb({ photoId, on, onClick }: { photoId: number; on: boolean; onClick: () => void }) {
  const src = usePhotoSrc({ photoId }, 'thumbnail')
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`relative w-16 h-16 rounded-lg overflow-hidden shrink-0 ${on ? 'ring-[3px] ring-indigo-500' : 'opacity-80 hover:opacity-100'}`}>
      {src && <img src={src} alt="" className="w-full h-full object-cover" />}
      {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center"><Check size={12} /></span>}
    </button>
  )
}

/** Compartir el blog: usa el enlace público de la travesía, con «blog» activado. */
function PublicBlogLink({ journeyId }: { journeyId: number }) {
  const { t } = useTranslation()
  const [link, setLink] = useState<{ token: string; share_timeline: boolean; share_gallery: boolean; share_map: boolean; share_book: boolean; share_blog?: boolean } | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  useEffect(() => { journeyApi.getShareLink(journeyId).then(d => setLink(d.link || null)).catch(() => setLink(undefined)) }, [journeyId])
  if (link === undefined) return null
  const url = link ? `${window.location.origin}/public/journey/${link.token}/blog` : ''
  const set = async (on: boolean) => {
    const perms = link
      ? { share_timeline: link.share_timeline, share_gallery: link.share_gallery, share_map: link.share_map, share_book: link.share_book, share_blog: on }
      // Sin enlace todavía: uno que comparte solo el blog.
      : { share_timeline: false, share_gallery: false, share_map: false, share_book: false, share_blog: on }
    try {
      const res = await journeyApi.createShareLink(journeyId, perms)
      setLink({ ...(link || perms), token: res.token, ...perms } as typeof link)
    } catch { /* sin red: el botón se queda como estaba */ }
  }
  return (
    <div>
      <span className={label}>{t('blog.share.title')}</span>
      <button type="button" onClick={() => set(!link?.share_blog)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-[13px] font-medium ${link?.share_blog ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
        <Globe size={15} />{t('blog.share.toggle')}{link?.share_blog && <Check size={14} className="ml-auto" />}
      </button>
      {link?.share_blog && (
        <div className="mt-2 flex items-center gap-2 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <Link2 size={13} className="text-zinc-400 shrink-0" />
          <span className="flex-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">{url}</span>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
            className="shrink-0 px-2 py-1 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[11px] font-medium flex items-center gap-1">
            <Copy size={11} />{copied ? t('journey.share.copied') : t('journey.share.copy')}
          </button>
        </div>
      )}
      <p className="text-[11px] text-zinc-500 mt-1.5">{t('blog.share.hint')}</p>
    </div>
  )
}

export default function PostSettings({ post, meta, onChange, onInsertBlocks, onDelete, canShare, entryBlocks }: {
  post: LocalPost
  meta: JourneyMeta | null
  onChange: (patch: Partial<LocalPost>) => void
  onInsertBlocks: (blocks: BlogBlock[]) => void
  onDelete: () => void
  canShare: boolean
  entryBlocks: (entryId: number) => BlogBlock[]
}) {
  const { t, locale } = useTranslation()
  const [q, setQ] = useState('')
  const statuses: { id: BlogStatus; icon: typeof Lock; key: string }[] = [
    { id: 'draft', icon: PencilLine, key: 'blog.status.draft' },
    { id: 'private', icon: Lock, key: 'blog.status.private' },
    { id: 'published', icon: Globe, key: 'blog.status.published' },
  ]
  const entries = useMemo(() => {
    const all = [...(meta?.entries || [])].sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    const s = q.trim().toLowerCase()
    return s ? all.filter(e => `${e.title || ''} ${e.location_name || ''} ${e.entry_date}`.toLowerCase().includes(s)) : all
  }, [meta, q])
  const photoIds = useMemo(() => [...new Set(photosOf(post.blocks).map(p => p.photoId).filter((x): x is number => !!x))], [post.blocks])
  const ownEntry = post.server?.own_entry_id ?? null
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className={label}>{t('blog.settings.status')}</span>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
          {statuses.map(s => (
            <button key={s.id} type="button" onClick={() => onChange({ status: s.id })} aria-pressed={post.status === s.id}
              className={`h-9 rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 ${post.status === s.id ? 'bg-white dark:bg-zinc-950 shadow-sm text-zinc-900 dark:text-white' : 'text-zinc-500'}`}>
              <s.icon size={13} />{t(s.key)}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1.5">{t(`blog.status.${post.status}Hint`)}</p>
      </div>

      <div>
        <label className={label} htmlFor="blog-date">{t('blog.settings.date')}</label>
        <input id="blog-date" type="date" value={post.post_date || ''} onChange={e => onChange({ post_date: e.target.value || null })}
          className="w-full h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm" />
      </div>

      <div>
        <span className={label}>{t('blog.settings.journey')}</span>
        <button type="button" onClick={() => onChange({ add_to_journey: !post.add_to_journey })} aria-pressed={post.add_to_journey}
          className="w-full flex items-start gap-3 text-left p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <span className={`mt-0.5 w-9 h-5 rounded-full shrink-0 relative transition-colors ${post.add_to_journey ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${post.add_to_journey ? 'left-[18px]' : 'left-0.5'}`} />
          </span>
          <span>
            <span className="block text-[13px] font-medium">{t('blog.settings.addToJourney')}</span>
            <span className="block text-[11px] text-zinc-500 mt-0.5">{t('blog.settings.addToJourneyHint')}</span>
          </span>
        </button>
      </div>

      <div>
        <span className={label}>{t('blog.settings.entries')}</span>
        {(meta?.entries.length || 0) > 6 && (
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('blog.entries.search')}
              className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-8 pr-3 text-sm" />
          </div>
        )}
        <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto -mx-1 px-1">
          {entries.map(e => {
            const on = post.entry_ids.includes(e.id) || e.id === ownEntry
            return (
              <div key={e.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${on ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'}`}>
                <button type="button" disabled={e.id === ownEntry} onClick={() => onChange({ entry_ids: on ? post.entry_ids.filter(x => x !== e.id) : [...post.entry_ids, e.id] })}
                  aria-pressed={on} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                  <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${on ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>{on && <Check size={11} />}</span>
                  <span className="text-[11px] text-zinc-500 w-12 shrink-0">{fmt(e.entry_date)}</span>
                  <span className="text-[13px] truncate">{e.title || e.location_name || '—'}</span>
                </button>
                <button type="button" onClick={() => onInsertBlocks(entryBlocks(e.id))} title={t('blog.entries.import')} aria-label={t('blog.entries.import')}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"><ArrowDownToLine size={14} /></button>
              </div>
            )
          })}
          {!entries.length && <p className="text-[12px] text-zinc-500 py-2">{t('blog.entries.none')}</p>}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1.5">{t('blog.entries.hint')}</p>
      </div>

      {photoIds.length > 0 && (
        <div>
          <span className={label}>{t('blog.settings.cover')}</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photoIds.map(id => <CoverThumb key={id} photoId={id} on={(post.cover_photo_id ?? photoIds[0]) === id} onClick={() => onChange({ cover_photo_id: id })} />)}
          </div>
        </div>
      )}

      {canShare && <PublicBlogLink journeyId={post.journeyId} />}

      <button type="button" onClick={onDelete} className="self-start flex items-center gap-1.5 text-[12px] font-medium text-red-500 hover:text-red-600">
        <Trash2 size={13} />{t('blog.post.delete')}
      </button>
    </div>
  )
}

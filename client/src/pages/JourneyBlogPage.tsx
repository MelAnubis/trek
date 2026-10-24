import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Plus, Eye, PencilLine, SlidersHorizontal, CloudOff, UploadCloud, Check, AlertTriangle, X,
  Pilcrow, Image as ImageIcon, PenLine, Map as MapIcon, MoreHorizontal, Images, Newspaper, Globe, Lock, BookMarked,
} from 'lucide-react'
import Navbar from '../components/Layout/Navbar'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import { useTranslation } from '../i18n'
import { useBlogPosts, useLocalPost, usePendingBlog, usePhotoSrc } from '../blog/useBlog'
import { useJourneyMeta } from '../blog/journeyMeta'
import {
  emptyPost, saveLocal, deleteLocal, resolveConflict, addPhotos, refreshPost, getLocalPost, newId, flush,
} from '../blog/blogSync'
import { blocksFromEntry, hasContent, insertAfter, photosOf } from '../blog/blockOps'
import { ensureSketchImages } from '../blog/sketchImage'
import type { BlogBlock, BlockType, LocalPost, PhotoRef } from '../blog/types'
import BlockEditor, { InsertMenu, useBlockInserter, type PhotoRequest } from '../components/Blog/BlockEditor'
import BlogPostView, { READING_FONT } from '../components/Blog/BlogPostView'
import PostSettings from '../components/Blog/PostSettings'
import PhotoPicker from '../components/Blog/PhotoPicker'
import EntriesPanel from '../components/Blog/EntriesPanel'

/** Interfaz táctil: pantalla estrecha o puntero «grueso» (iPad en horizontal incluido). */
export function useTouchUI(): boolean {
  const q = '(max-width: 1023px), (hover: none) and (pointer: coarse)'
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const h = () => setTouch(mq.matches)
    h()
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return touch
}

function useWide(min: number): boolean {
  const [w, setW] = useState(() => typeof window !== 'undefined' && window.innerWidth >= min)
  useEffect(() => {
    const h = () => setW(window.innerWidth >= min)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [min])
  return w
}

// ── Estado de sincronización ─────────────────────────────────────────────────

function SyncBadge({ journeyId, online, compact }: { journeyId: number; online: boolean; compact?: boolean }) {
  const { t } = useTranslation()
  const p = usePendingBlog(journeyId)
  const waiting = p.posts + p.photos
  let icon = <Check size={13} />, text = t('blog.sync.saved'), tone = 'text-emerald-600 dark:text-emerald-400'
  if (!online) { icon = <CloudOff size={13} />; text = waiting ? t('blog.sync.offlinePending', { count: waiting }) : t('blog.sync.offline'); tone = 'text-amber-600 dark:text-amber-400' }
  else if (p.conflicts) { icon = <AlertTriangle size={13} />; text = t('blog.sync.conflict'); tone = 'text-red-600' }
  else if (waiting) { icon = <UploadCloud size={13} className="animate-pulse" />; text = p.photos ? t('blog.sync.uploadingPhotos', { count: p.photos }) : t('blog.sync.saving'); tone = 'text-zinc-500' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${tone}`} title={text} role="status">
      {icon}{!compact && <span className="truncate max-w-[220px]">{text}</span>}
    </span>
  )
}

// ── Lista ───────────────────────────────────────────────────────────────────

function PostCover({ post }: { post: LocalPost }) {
  const first = photosOf(post.blocks)[0]
  const ref: PhotoRef | null = post.cover_photo_id ? { photoId: post.cover_photo_id } : first ?? null
  const src = usePhotoSrc(ref, 'thumbnail')
  return src
    ? <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
    : <div className="w-full h-full bg-gradient-to-br from-indigo-100 to-amber-50 dark:from-indigo-950 dark:to-zinc-900 flex items-center justify-center text-indigo-300 dark:text-indigo-800"><Newspaper size={28} /></div>
}

const STATUS_ICON = { draft: PencilLine, private: Lock, published: Globe }

function PostCard({ post, onOpen }: { post: LocalPost; onOpen: () => void }) {
  const { t, locale } = useTranslation()
  const Icon = STATUS_ICON[post.status]
  const excerpt = post.server?.excerpt ?? (post.blocks.find(b => b.type === 'paragraph' && b.text.trim()) as { text: string } | undefined)?.text.slice(0, 180)
  return (
    <button type="button" onClick={onOpen} className="group text-left flex sm:flex-col gap-3 sm:gap-0 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:shadow-lg hover:-translate-y-0.5 transition-all">
      <div className="w-28 h-28 sm:w-full sm:h-auto sm:aspect-[16/10] shrink-0 overflow-hidden"><PostCover post={post} /></div>
      <div className="py-3 pr-3 sm:p-4 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1"><Icon size={11} />{t(`blog.status.${post.status}`)}</span>
          {post.post_date && <span>· {new Date(`${post.post_date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          {post.dirty === 1 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title={t('blog.sync.notSent')} />}
        </div>
        <h3 className="font-semibold text-[16px] leading-snug line-clamp-2">{post.title || t('blog.post.untitled')}</h3>
        {excerpt && <p className="text-[13px] text-zinc-500 line-clamp-2 sm:line-clamp-3" style={{ fontFamily: READING_FONT }}>{excerpt}</p>}
      </div>
    </button>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function JourneyBlogPage() {
  const { id, postId } = useParams()
  const journeyId = Number(id)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [search] = useSearchParams()
  const { posts, access, loading, online } = useBlogPosts(journeyId)
  const { meta } = useJourneyMeta(journeyId)
  // null = aún no se sabe (ni el servidor ni la copia local lo han dicho).
  const canEdit: boolean | null = access ? access === 'edit' : meta ? meta.my_role === 'owner' || meta.my_role === 'editor' : null
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all')
  const [tab, setTab] = useState<'posts' | 'entries'>(() => (search.get('tab') === 'entries' ? 'entries' : 'posts'))

  const sorted = useMemo(() => [...posts].sort((a, b) => (b.post_date || '').localeCompare(a.post_date || '') || b.localUpdatedAt - a.localUpdatedAt), [posts])
  const shown = sorted.filter(p => filter === 'all' || (filter === 'draft' ? p.status !== 'published' : p.status === 'published'))

  const newPost = () => navigate(`/journey/${journeyId}/blog/${newId()}?new=1`)

  if (postId) {
    const from = Number(search.get('from')) || null
    return <PostScreen key={postId} journeyId={journeyId} postId={postId} isNew={search.get('new') === '1'} fromEntry={from} canEditKnown={canEdit} online={online} posts={sorted} />
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Navbar />
      <div style={{ paddingTop: 'var(--nav-h, 56px)', paddingBottom: 'calc(var(--bottom-nav-h, 0px) + 24px)' }}>
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 pt-5 pb-2">
            <button type="button" onClick={() => navigate(`/journey/${journeyId}`)} aria-label={t('blog.backToJourney')}
              className="w-10 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center shrink-0"><ArrowLeft size={16} /></button>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-[0.1em] text-zinc-500 truncate">{meta?.title || ''}</div>
              <h1 className="text-[24px] sm:text-[30px] font-bold tracking-[-0.02em] leading-tight">{t('blog.title')}</h1>
            </div>
            {canEdit && (
              <button type="button" onClick={newPost} className="h-10 px-4 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm font-medium flex items-center gap-1.5 shrink-0">
                <Plus size={16} /><span className="hidden sm:inline">{t('blog.post.new')}</span>
              </button>
            )}
          </div>
          {/* Posts del blog, o las entradas de la travesía como referencia */}
          <div className="flex gap-5 border-b border-zinc-200 dark:border-zinc-800 mt-1">
            {(['posts', 'entries'] as const).map(k => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                className={`-mb-px py-2.5 text-[14px] font-medium border-b-2 inline-flex items-center gap-1.5 ${tab === k ? 'border-zinc-900 dark:border-white text-zinc-900 dark:text-white' : 'border-transparent text-zinc-500'}`}>
                {k === 'posts' ? <Newspaper size={15} /> : <BookMarked size={15} />}
                {k === 'posts' ? t('blog.tabs.posts') : t('blog.tabs.entries')}
                {k === 'entries' && meta ? <span className="text-[11px] text-zinc-400">{meta.entries.length}</span> : null}
              </button>
            ))}
          </div>
          {tab === 'entries' ? (
            <div className="max-w-[760px] py-5">
              <EntriesPanel meta={meta} mode={canEdit ? 'list' : 'read'}
                onWrite={canEdit ? entryId => navigate(`/journey/${journeyId}/blog/${newId()}?new=1&from=${entryId}`) : undefined} />
            </div>
          ) : (<>
          <div className="flex items-center justify-between gap-3 py-3">
            {canEdit ? (
              <div className="flex gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900">
                {(['all', 'draft', 'published'] as const).map(f => (
                  <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                    className={`h-8 px-3 rounded-lg text-[12px] font-medium ${filter === f ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'}`}>{t(`blog.filter.${f}`)}</button>
                ))}
              </div>
            ) : <span />}
            <SyncBadge journeyId={journeyId} online={online} />
          </div>

          {shown.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {shown.map(p => <PostCard key={p.id} post={p} onOpen={() => navigate(`/journey/${journeyId}/blog/${p.id}`)} />)}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 flex items-center justify-center mx-auto mb-4"><Newspaper size={28} /></div>
              <h2 className="text-lg font-semibold">{loading && online ? t('blog.list.loading') : t('blog.list.empty')}</h2>
              {!loading && <p className="text-sm text-zinc-500 mt-1 max-w-[380px] mx-auto">{canEdit ? t('blog.list.emptyHint') : t('blog.list.emptyViewer')}</p>}
              {canEdit && !loading && (
                <button type="button" onClick={newPost} className="mt-5 h-11 px-5 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm font-medium inline-flex items-center gap-1.5"><Plus size={16} />{t('blog.post.first')}</button>
              )}
            </div>
          )}
          </>)}
        </div>
      </div>
    </div>
  )
}

// ── Post: editar o leer ─────────────────────────────────────────────────────

const CONTENT_KEYS = ['title', 'blocks', 'status', 'post_date', 'entry_ids', 'cover_photo_id', 'add_to_journey'] as const

function PostScreen({ journeyId, postId, isNew, fromEntry, canEditKnown, online, posts }: { journeyId: number; postId: string; isNew: boolean; fromEntry: number | null; canEditKnown: boolean | null; online: boolean; posts: LocalPost[] }) {
  const canEdit = !!canEditKnown
  const navigate = useNavigate()
  const { t, locale } = useTranslation()
  const stored = useLocalPost(postId)
  const { meta } = useJourneyMeta(journeyId)
  const touch = useTouchUI()
  const wide = useWide(1280)
  const [draft, setDraft] = useState<LocalPost | null>(null)
  // El modo se decide cuando se sabe si se puede editar (no antes: abriría en lectura).
  const [mode, setMode] = useState<'edit' | 'read' | null>(canEditKnown == null ? null : canEditKnown ? 'edit' : 'read')
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picker, setPicker] = useState<{ multiple: boolean; done: (r: PhotoRef[]) => void } | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [openSketch, setOpenSketch] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'posts' | 'entries'>(fromEntry ? 'entries' : 'posts')
  const [entriesOpen, setEntriesOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<LocalPost | null>(null)

  useEffect(() => {
    if (canEditKnown === false) setMode('read')
    else if (canEditKnown === true) setMode(m => m ?? 'edit')
  }, [canEditKnown])

  // Carga: lo del dispositivo; si no está, el servidor; si es nuevo, en blanco.
  useEffect(() => {
    if (stored === undefined || draft) return
    if (stored) { setDraft(stored); return }
    if (isNew) {
      // «Escribir post» desde una entrada: arranca con su título, fecha, texto y fotos, ya enlazada.
      if (fromEntry) {
        if (!meta) return                                       // espera a tener las entradas
        const e = meta.entries.find(x => x.id === fromEntry)
        if (e) {
          // Ya está en la travesía (es esa entrada): no se crea otra.
          const init = emptyPost(journeyId, { id: postId, title: e.title || '', post_date: e.entry_date, entry_ids: [e.id], add_to_journey: false })
          const body = blocksFromEntry({ ...e, title: null })
          const next = { ...init, blocks: body.length ? body : init.blocks }
          setDraft(next)
          pending.current = next
          persist()
          return
        }
      }
      setDraft(emptyPost(journeyId, { id: postId }))
      return
    }
    refreshPost(journeyId, postId).then(() => getLocalPost(postId)).then(p => { if (!p) setDraft(null) }).catch(() => setDraft(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, draft, isNew, journeyId, postId, fromEntry, meta])

  // Lo que llega de la sincronización (versión, mapas, conflicto) sin pisar lo que se escribe.
  const server = stored?.server ?? null
  const conflict = stored?.conflict ?? null
  const syncError = stored?.syncError ?? null

  const persist = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const p = pending.current
    if (!p) return
    pending.current = null
    const latest = await getLocalPost(p.id)
    if (!latest && !hasContent(p.title, p.blocks)) return            // un post nuevo vacío no se guarda
    const base = latest ?? p
    const merged = { ...base } as LocalPost
    for (const k of CONTENT_KEYS) (merged as unknown as Record<string, unknown>)[k] = p[k]
    // Dibujos cambiados → imagen, para que lleguen a la entrada de la travesía.
    const sk = await ensureSketchImages(journeyId, p.id, merged.blocks)
    merged.blocks = sk.blocks
    if (sk.changed.size) {
      setDraft(d => d && ({ ...d, blocks: d.blocks.map(b => (b.type === 'sketch' && sk.changed.has(b.id) ? { ...b, ...sk.changed.get(b.id) } : b)) }))
    }
    await saveLocal(merged)
    if (isNew && !latest) navigate(`/journey/${journeyId}/blog/${p.id}`, { replace: true })
  }, [isNew, journeyId, navigate])

  const update = (patch: Partial<LocalPost>) => {
    setDraft(d => {
      if (!d) return d
      const next = { ...d, ...patch }
      pending.current = next
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { persist().catch(() => {}) }, 500)
      return next
    })
  }

  // Al salir de la app o de la página, lo pendiente se guarda ya.
  useEffect(() => {
    const now = () => { persist().catch(() => {}) }
    const vis = () => { if (document.hidden) now() }
    window.addEventListener('pagehide', now)
    document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('pagehide', now); document.removeEventListener('visibilitychange', vis); now() }
  }, [persist])

  const requestPhotos: PhotoRequest = (multiple, done) => setPicker({ multiple, done })
  const setBlocks = (blocks: BlogBlock[]) => update({ blocks })
  const insertMobile = useBlockInserter(draft?.blocks || [], setBlocks, selected, setSelected, requestPhotos, draft?.post_date ?? null, meta?.entries[0]?.id)
  const insertFromBar = (type: BlockType) => {
    const id = insertMobile(type)
    if (type === 'sketch' && id) setOpenSketch(id)
  }

  const entryBlocks = (entryId: number) => {
    const e = meta?.entries.find(x => x.id === entryId)
    return e ? blocksFromEntry(e) : []
  }
  // Desde el panel de entradas: detrás del bloque seleccionado (o al final), y queda seleccionado lo último.
  const insertFromEntries = (bs: BlogBlock[]) => {
    if (!draft || !bs.length) return
    update({ blocks: insertAfter(draft.blocks, selected, bs) })
    setSelected(bs[bs.length - 1].id)
    setEntriesOpen(false)
  }
  const toggleEntryLink = (entryId: number) => {
    if (!draft) return
    update({ entry_ids: draft.entry_ids.includes(entryId) ? draft.entry_ids.filter(x => x !== entryId) : [...draft.entry_ids, entryId] })
  }

  if (draft === undefined || (draft === null && stored === undefined)) {
    return <div className="min-h-screen bg-white dark:bg-zinc-950"><Navbar /></div>
  }
  if (!draft) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <Navbar />
        <div className="pt-[calc(var(--nav-h,56px)+80px)] text-center px-6">
          <p className="text-zinc-500">{online ? t('blog.post.notFound') : t('blog.post.notOffline')}</p>
          <button type="button" onClick={() => navigate(`/journey/${journeyId}/blog`)} className="mt-4 text-sm font-medium underline">{t('blog.title')}</button>
        </div>
      </div>
    )
  }

  const ctx = { maps: server?.maps, entries: server?.entries }
  const settings = (
    <PostSettings
      post={draft} meta={meta} onChange={update} canShare={meta?.my_role === 'owner'}
      onInsertBlocks={bs => { if (bs.length) update({ blocks: insertAfter(draft.blocks, selected, bs) }) }}
      onDelete={() => setConfirmDelete(true)} entryBlocks={entryBlocks}
    />
  )
  const reading = mode !== 'edit'
  // Portada arriba solo si esa foto no está ya en el texto (si no, sale dos veces).
  const coverId = draft.cover_photo_id ?? photosOf(draft.blocks)[0]?.photoId
  const cover = coverId && !draft.blocks.some(b => b.type === 'photo' && b.photo.photoId === coverId) ? { photoId: coverId } : null
  const dateText = draft.post_date ? new Date(`${draft.post_date}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const showSidebar = !touch && wide

  const publish = () => update({ status: draft.status === 'published' ? 'private' : 'published' })

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100" style={{ ['--blog-accent' as string]: '#6366f1' }}>
      <Navbar />
      {/* Barra superior del post */}
      <div className="sticky z-40 bg-white/90 dark:bg-zinc-950/90 backdrop-blur border-b border-zinc-100 dark:border-zinc-900" style={{ top: 'var(--nav-h, 56px)', marginTop: 'var(--nav-h, 56px)' }}>
        <div className="flex items-center gap-2 px-3 sm:px-4 h-14">
          <button type="button" onClick={async () => { await persist(); navigate(`/journey/${journeyId}/blog`) }} aria-label={t('blog.title')}
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"><ArrowLeft size={17} /></button>
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <span className="hidden sm:block text-[13px] text-zinc-500 truncate">{meta?.title} · {t('blog.title')}</span>
            {canEdit && <SyncBadge journeyId={journeyId} online={online} compact={touch && !wide} />}
          </div>
          {canEdit && (
            <>
              <button type="button" onClick={() => { persist(); setMode(reading ? 'edit' : 'read'); setSelected(null) }}
                className="h-9 px-3 rounded-lg text-[13px] font-medium flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                {reading ? <><PencilLine size={15} /><span className="hidden sm:inline">{t('blog.post.edit')}</span></> : <><Eye size={15} /><span className="hidden sm:inline">{t('blog.post.preview')}</span></>}
              </button>
              {(!wide || touch) && !reading && (
                <button type="button" onClick={() => setEntriesOpen(true)} aria-label={t('blog.tabs.entries')} title={t('blog.tabs.entries')}
                  className="h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <BookMarked size={16} /><span className="hidden md:inline">{t('blog.tabs.entries')}</span>
                </button>
              )}
              {!wide || touch ? (
                <button type="button" onClick={() => setSettingsOpen(true)} aria-label={t('blog.settings.title')} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900"><SlidersHorizontal size={16} /></button>
              ) : null}
              <button type="button" onClick={publish}
                className={`h-9 px-3.5 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 ${draft.status === 'published' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'}`}>
                {draft.status === 'published' ? <><Globe size={14} />{t('blog.status.published')}</> : t('blog.post.publish')}
              </button>
            </>
          )}
        </div>
      </div>

      {conflict && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 px-4 py-3 text-[13px] flex flex-wrap items-center gap-3">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[200px]">{t('blog.conflict.text')}</span>
          <button type="button" className="h-8 px-3 rounded-lg bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-500/30 font-medium" onClick={() => resolveConflict(draft.id, 'mine')}>{t('blog.conflict.mine')}</button>
          <button type="button" className="h-8 px-3 rounded-lg bg-amber-600 text-white font-medium" onClick={async () => { await resolveConflict(draft.id, 'theirs'); const p = await getLocalPost(draft.id); if (p) setDraft(p) }}>{t('blog.conflict.theirs')}</button>
        </div>
      )}
      {canEdit && mode === 'edit' && !draft.add_to_journey && draft.entry_ids.length === 0 && (
        <div className="bg-indigo-50 dark:bg-indigo-500/10 border-b border-indigo-100 dark:border-indigo-500/20 px-4 py-2.5 text-[13px] flex flex-wrap items-center gap-3">
          <BookMarked size={15} className="text-indigo-500 shrink-0" />
          <span className="flex-1 min-w-[200px]">{t('blog.notInJourney.text')}</span>
          <button type="button" className="h-8 px-3 rounded-lg bg-indigo-600 text-white font-medium" onClick={() => update({ add_to_journey: true })}>{t('blog.notInJourney.add')}</button>
        </div>
      )}
      {syncError && !conflict && (
        <div className="bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20 px-4 py-2.5 text-[13px] flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertTriangle size={15} />{t('blog.sync.error')}: {syncError}
          <button type="button" className="ml-auto underline" onClick={() => { update({}); flush() }}>{t('blog.sync.retry')}</button>
        </div>
      )}

      <div className="flex">
        {/* Escritorio: los posts a mano para saltar de uno a otro */}
        {showSidebar && canEdit && (
          <aside className={`${sideTab === 'entries' && !reading ? 'w-[340px]' : 'w-[250px]'} shrink-0 border-r border-zinc-100 dark:border-zinc-900 h-[calc(100dvh-var(--nav-h,56px)-56px)] sticky overflow-y-auto p-3 bg-white dark:bg-zinc-950`} style={{ top: 'calc(var(--nav-h, 56px) + 56px)' }}>
            {!reading && (
              <div className="grid grid-cols-2 gap-1 p-1 mb-3 rounded-xl bg-zinc-100 dark:bg-zinc-900">
                {(['posts', 'entries'] as const).map(k => (
                  <button key={k} type="button" onClick={() => setSideTab(k)} aria-pressed={sideTab === k}
                    className={`h-8 rounded-lg text-[12px] font-medium ${sideTab === k ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'}`}>
                    {k === 'posts' ? t('blog.tabs.posts') : t('blog.tabs.entries')}
                  </button>
                ))}
              </div>
            )}
            {sideTab === 'entries' && !reading ? (
              <EntriesPanel meta={meta} mode="editor" linkedIds={draft.entry_ids} onInsert={insertFromEntries} onToggleLink={toggleEntryLink} />
            ) : (<>
            <button type="button" onClick={() => navigate(`/journey/${journeyId}/blog/${newId()}?new=1`)} className="w-full h-9 mb-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-[13px] text-zinc-500 flex items-center justify-center gap-1.5 hover:text-zinc-800 dark:hover:text-zinc-200"><Plus size={14} />{t('blog.post.new')}</button>
            {posts.map(p => {
              const Icon = STATUS_ICON[p.status]
              return (
                <button key={p.id} type="button" onClick={async () => { await persist(); navigate(`/journey/${journeyId}/blog/${p.id}`) }}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 ${p.id === draft.id ? 'bg-zinc-100 dark:bg-zinc-900' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'}`}>
                  <div className="text-[13px] font-medium truncate">{(p.id === draft.id ? draft.title : p.title) || t('blog.post.untitled')}</div>
                  <div className="text-[11px] text-zinc-500 flex items-center gap-1"><Icon size={10} />{p.post_date ? new Date(`${p.post_date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''}</div>
                </button>
              )
            })}
            </>)}
          </aside>
        )}

        <main className="flex-1 min-w-0" onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}>
          <article className="max-w-[720px] mx-auto px-5 sm:px-8 pt-8" style={{ paddingBottom: touch && !reading ? 'calc(var(--bottom-nav-h, 0px) + 96px)' : '96px' }}>
            {reading ? (
              <>
                {cover && <ReadCover refp={cover} />}
                <div className="text-[12px] uppercase tracking-[0.1em] text-zinc-500 mb-2">{dateText}</div>
                <h1 className="text-[32px] sm:text-[42px] font-bold tracking-[-0.025em] leading-[1.08] mb-8">{draft.title || t('blog.post.untitled')}</h1>
                <BlogPostView blocks={draft.blocks} ctx={ctx} />
              </>
            ) : (
              <>
                <input type="date" value={draft.post_date || ''} onChange={e => update({ post_date: e.target.value || null })} aria-label={t('blog.settings.date')}
                  className="text-[12px] uppercase tracking-[0.1em] text-zinc-500 bg-transparent outline-none mb-2" />
                <textarea value={draft.title} onChange={e => update({ title: e.target.value.replace(/\n/g, ' ') })} rows={1} placeholder={t('blog.post.titlePlaceholder')} aria-label={t('blog.post.title')}
                  onFocus={() => setSelected(null)}
                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }}
                  className="w-full resize-none bg-transparent outline-none text-[32px] sm:text-[42px] font-bold tracking-[-0.025em] leading-[1.08] mb-6 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 overflow-hidden" />
                <BlockEditor
                  blocks={draft.blocks} onChange={setBlocks} meta={meta} maps={server?.maps} postDate={draft.post_date}
                  selectedId={selected} onSelect={setSelected} requestPhotos={requestPhotos} touch={touch}
                  openSketch={openSketch} onSketchClosed={() => setOpenSketch(null)}
                />
              </>
            )}
          </article>
        </main>

        {showSidebar && canEdit && !reading && (
          <aside className="w-[320px] shrink-0 border-l border-zinc-100 dark:border-zinc-900 h-[calc(100dvh-var(--nav-h,56px)-56px)] sticky overflow-y-auto p-5" style={{ top: 'calc(var(--nav-h, 56px) + 56px)' }}>
            {settings}
          </aside>
        )}
      </div>

      {/* Táctil: barra para añadir bloques, siempre a mano encima del teclado/la barra de la app */}
      {touch && canEdit && !reading && (
        <div className="fixed left-0 right-0 z-40 px-3" style={{ bottom: 'calc(var(--bottom-nav-h, 0px) + 10px)' }}>
          <div className="relative mx-auto max-w-[560px] flex items-center justify-between gap-1 px-2 py-1.5 rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur border border-zinc-200 dark:border-zinc-800 shadow-xl">
            {([
              ['paragraph', Pilcrow, 'blog.block.paragraph'],
              ['photo', ImageIcon, 'blog.block.photo'],
              ['gallery', Images, 'blog.block.gallery'],
              ['sketch', PenLine, 'blog.block.sketch'],
              ['map', MapIcon, 'blog.block.map'],
            ] as [BlockType, typeof Pilcrow, string][]).map(([type, Icon, key]) => (
              <button key={type} type="button" onClick={() => insertFromBar(type)} className="flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-zinc-600 dark:text-zinc-300 active:bg-zinc-100 dark:active:bg-zinc-800">
                <Icon size={19} /><span className="text-[10px]">{t(key)}</span>
              </button>
            ))}
            <div className="relative flex-1">
              <button type="button" onClick={() => setMoreOpen(v => !v)} className="w-full h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-zinc-600 dark:text-zinc-300 active:bg-zinc-100 dark:active:bg-zinc-800" aria-label={t('blog.editor.more')}>
                <MoreHorizontal size={19} /><span className="text-[10px]">{t('blog.editor.more')}</span>
              </button>
              {moreOpen && <div className="absolute bottom-14 right-0 [&>div:last-child]:bottom-0 [&>div:last-child]:right-0 [&>div:last-child]:left-auto"><InsertMenu onPick={insertFromBar} onClose={() => setMoreOpen(false)} /></div>}
            </div>
          </div>
        </div>
      )}

      {/* Táctil / pantallas medianas: las entradas de la travesía en una hoja lateral */}
      {entriesOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => setEntriesOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-full sm:w-[440px] bg-white dark:bg-zinc-950 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={t('blog.tabs.entries')}
            style={{ paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between px-4 pb-3">
              <h2 className="text-[16px] font-semibold">{t('blog.tabs.entries')}</h2>
              <button type="button" onClick={() => setEntriesOpen(false)} aria-label={t('common.cancel')} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900"><X size={18} /></button>
            </div>
            <div className="px-4">
              <EntriesPanel meta={meta} mode="editor" linkedIds={draft.entry_ids} onInsert={insertFromEntries} onToggleLink={toggleEntryLink} />
            </div>
          </div>
        </div>
      )}

      {/* Táctil / pantallas medianas: ajustes en una hoja lateral */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => setSettingsOpen(false)}>
          <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[400px] bg-white dark:bg-zinc-950 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}
            style={{ paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between px-5 pb-3">
              <h2 className="text-[16px] font-semibold">{t('blog.settings.title')}</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label={t('common.cancel')} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900"><X size={18} /></button>
            </div>
            <div className="px-5">{settings}</div>
          </div>
        </div>
      )}

      {picker && (
        <PhotoPicker
          meta={meta} multiple={picker.multiple} onClose={() => setPicker(null)}
          onPickExisting={refs => { picker.done(refs); setPicker(null) }}
          onPickFiles={async files => { const refs = await addPhotos(journeyId, draft.id, files); picker.done(refs); setPicker(null) }}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} danger
        title={t('blog.post.deleteTitle')} message={t('blog.post.deleteMessage')} confirmLabel={t('common.delete')}
        onConfirm={async () => { pending.current = null; await deleteLocal(draft.id); setConfirmDelete(false); navigate(`/journey/${journeyId}/blog`) }}
      />
    </div>
  )
}

function ReadCover({ refp }: { refp: PhotoRef }) {
  const src = usePhotoSrc(refp, 'original')
  if (!src) return null
  return <img src={src} alt="" className="w-full aspect-[16/9] object-cover rounded-2xl mb-8" />
}

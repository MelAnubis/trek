// El editor del blog con BlockNote: «/» para insertar, bloques que se arrastran, barra flotante al
// seleccionar, listas de verdad y pegar desde la web o Word con su formato. Lo que se guarda no
// cambia (BlogBlocks con Markdown): see blog/blockNoteConvert.ts.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core'
import { es as bnEs, en as bnEn } from '@blocknote/core/locales'
import {
  useCreateBlockNote, createReactBlockSpec, SuggestionMenuController, getDefaultReactSlashMenuItems,
  FormattingToolbarController, FormattingToolbar, BlockTypeSelect, BasicTextStyleButton, CreateLinkButton,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
// @ts-ignore — resolved through the package's exports map (Vite), which tsc's resolution doesn't read
import '@blocknote/mantine/style.css'
import { Image as ImageIcon, Images, Map as MapIcon, PenLine, BookMarked, Plus, Trash2, ArrowUp, RefreshCw } from 'lucide-react'
import type { BlogBlock, BlockType, MapContext, PhotoRef } from '../../blog/types'
import type { JourneyMeta } from '../../blog/journeyMeta'
import { newBlock } from '../../blog/blockOps'
import { toBlockNote, fromBlockNote, blogIdAt, type CiteMap, type MarkdownEditor, type BNBlock } from '../../blog/blockNoteConvert'
import { useTranslation } from '../../i18n'
import { SketchView } from './SketchCanvas'
import SketchEditor, { type SketchValue } from './SketchEditor'
import { MapBlockView, READING_FONT } from './BlogPostView'
import { Thumb, BigPhoto, type PhotoRequest } from './BlockEditor'

type Media = Exclude<BlogBlock, { type: 'paragraph' | 'heading' | 'quote' | 'divider' }>

interface TrekCtx {
  meta: JourneyMeta | null
  maps: Record<string, MapContext> | undefined
  postDate: string | null
  requestPhotos: PhotoRequest
  openSketch: (id: string) => void
}
const Ctx = createContext<TrekCtx | null>(null)

const chip = (on: boolean) => `h-7 px-2 rounded-lg text-[12px] font-medium whitespace-nowrap ${on ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`
const sel = 'h-7 max-w-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[12px] px-1.5'
const caption = 'w-full bg-transparent outline-none text-[13px] text-zinc-500 mt-2 text-center'

/** A photo, gallery, map, sketch or journal entry inside the text, with its own options on hover. */
function TrekMedia({ data, onPatch }: { data: Media; onPatch: (p: Partial<BlogBlock>) => void }) {
  const ctx = useContext(Ctx)
  const { t } = useTranslation()
  const entries = [...(ctx?.meta?.entries || [])].sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  const bar = (children: React.ReactNode) => (
    <div className="trek-bn-bar flex flex-wrap items-center gap-1 mb-2 px-1 py-1 rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200/70 dark:border-zinc-700/60 font-sans" contentEditable={false}>{children}</div>
  )
  const cap = (b: { caption?: string }) => (
    <input value={b.caption || ''} onChange={e => onPatch({ caption: e.target.value } as Partial<BlogBlock>)} placeholder={t('blog.photos.caption')} className={caption} />
  )
  switch (data.type) {
    case 'photo':
      return (
        <div className="w-full">
          {bar(<>
            {(['inline', 'wide', 'full'] as const).map(l => <button key={l} type="button" className={chip(data.layout === l)} onClick={() => onPatch({ layout: l } as Partial<BlogBlock>)}>{t(`blog.layout.${l}`)}</button>)}
            <button type="button" className={chip(false)} aria-label={t('blog.photos.replace')} onClick={() => ctx?.requestPhotos(false, ([p]) => p && onPatch({ photo: p } as Partial<BlogBlock>))}><RefreshCw size={13} /></button>
            {entries.length > 0 && (
              <select className={sel} value={data.entryId ?? ''} aria-label={t('blog.photos.linkEntry')} onChange={e => onPatch({ entryId: e.target.value ? Number(e.target.value) : null } as Partial<BlogBlock>)}>
                <option value="">{t('blog.photos.noEntry')}</option>
                {entries.map(e => <option key={e.id} value={e.id}>{e.entry_date} · {e.title || '—'}</option>)}
              </select>
            )}
          </>)}
          <figure className={data.layout === 'inline' ? 'max-w-[460px] mx-auto' : ''}>
            <BigPhoto refp={data.photo} className="w-full h-auto rounded-xl" />
            {cap(data)}
          </figure>
        </div>
      )
    case 'gallery':
      return (
        <div className="w-full">
          {bar(<>
            {(['grid', 'mosaic', 'carousel'] as const).map(l => <button key={l} type="button" className={chip(data.layout === l)} onClick={() => onPatch({ layout: l } as Partial<BlogBlock>)}>{t(`blog.layout.${l}`)}</button>)}
            <button type="button" className={chip(false)} onClick={() => ctx?.requestPhotos(true, ps => onPatch({ photos: [...data.photos, ...ps] } as Partial<BlogBlock>))}><Plus size={13} className="inline -mt-0.5" /> {t('blog.photos.more')}</button>
          </>)}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {data.photos.map((p, k) => (
              <div key={k} className="relative aspect-square group/ph">
                <Thumb refp={p} className="w-full h-full object-cover rounded-lg" />
                <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 group-hover/ph:opacity-100">
                  <button type="button" className="w-7 h-7 rounded-md bg-black/55 text-white flex items-center justify-center disabled:opacity-30" disabled={k === 0}
                    onClick={() => { const ps = data.photos.slice(); [ps[k - 1], ps[k]] = [ps[k], ps[k - 1]]; onPatch({ photos: ps } as Partial<BlogBlock>) }} aria-label={t('blog.block.up')}><ArrowUp size={13} className="-rotate-90" /></button>
                  <button type="button" className="w-7 h-7 rounded-md bg-black/55 text-white flex items-center justify-center"
                    onClick={() => onPatch({ photos: data.photos.filter((_, x) => x !== k) } as Partial<BlogBlock>)} aria-label={t('blog.block.delete')}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {!data.photos.length && <button type="button" onClick={() => ctx?.requestPhotos(true, ps => onPatch({ photos: ps } as Partial<BlogBlock>))} className="col-span-3 sm:col-span-4 h-28 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500">{t('blog.photos.pick')}</button>}
          </div>
          {cap(data)}
        </div>
      )
    case 'map':
      return (
        <div className="w-full">
          {bar(<>
            <select className={sel} value={data.source} aria-label={t('blog.map.source')} onChange={e => onPatch({ source: e.target.value as 'post' | 'day' | 'journey' } as Partial<BlogBlock>)}>
              <option value="post">{t('blog.map.sourcePost')}</option>
              <option value="day">{t('blog.map.sourceDay')}</option>
              <option value="journey">{t('blog.map.sourceJourney')}</option>
            </select>
            {data.source === 'day' && <input type="date" className={sel} value={data.date || ctx?.postDate || ''} onChange={e => onPatch({ date: e.target.value || null } as Partial<BlogBlock>)} />}
            <button type="button" className={chip(data.showTrack)} onClick={() => onPatch({ showTrack: !data.showTrack } as Partial<BlogBlock>)}>{t('blog.map.track')}</button>
            <button type="button" className={chip(data.showPhotos)} onClick={() => onPatch({ showPhotos: !data.showPhotos } as Partial<BlogBlock>)}>{t('blog.map.photos')}</button>
          </>)}
          <div className="pointer-events-none"><MapBlockView ctx={ctx?.maps?.[data.id]} map={data} height={240} /></div>
          {cap(data)}
        </div>
      )
    case 'sketch':
      return (
        <div className="w-full max-w-[640px] mx-auto">
          <button type="button" onClick={() => ctx?.openSketch(data.id)} className="block w-full rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 relative" aria-label={t('blog.sketch.edit')}>
            <SketchView strokes={data.strokes} aspect={data.aspect} background={data.background} />
            {!data.strokes.length && <span className="absolute inset-0 flex items-center justify-center gap-2 text-zinc-400 text-sm font-sans"><PenLine size={18} />{t('blog.sketch.tapToDraw')}</span>}
          </button>
          {cap(data)}
        </div>
      )
    case 'entry': {
      const e = ctx?.meta?.entries.find(x => x.id === data.entryId)
      return (
        <div className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 font-sans">
          <select className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2" value={data.entryId || ''} aria-label={t('blog.block.entry')} onChange={ev => onPatch({ entryId: Number(ev.target.value) } as Partial<BlogBlock>)}>
            {!e && <option value="">{t('blog.entries.choose')}</option>}
            {entries.map(x => <option key={x.id} value={x.id}>{x.entry_date} · {x.title || '—'}</option>)}
          </select>
          {e?.story && <p className="text-[13px] text-zinc-500 mt-2 line-clamp-2">{e.story}</p>}
        </div>
      )
    }
  }
}

const TrekBlock = createReactBlockSpec(
  { type: 'trek', propSchema: { data: { default: '' } }, content: 'none' },
  {
    render: ({ block, editor }) => {
      let data: Media | null = null
      try { data = JSON.parse(block.props.data) as Media } catch { data = null }
      if (!data) return <div />
      const onPatch = (p: Partial<BlogBlock>) => {
        const cur = JSON.parse((editor.getBlock(block.id)?.props as { data: string } | undefined)?.data || block.props.data)
        editor.updateBlock(block.id, { props: { data: JSON.stringify({ ...cur, ...p }) } } as never)
      }
      return <div className="trek-bn-media w-full py-1" data-block-type={data.type}><TrekMedia data={{ ...data, id: block.id } as Media} onPatch={onPatch} /></div>
    },
  },
)

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    quote: defaultBlockSpecs.quote,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    divider: defaultBlockSpecs.divider,
    trek: TrekBlock(),
  },
})

const TEXT_ITEMS = new Set(['paragraph', 'heading_2', 'heading_3', 'quote', 'bullet_list', 'numbered_list', 'divider'])

interface EditorProps {
  blocks: BlogBlock[]
  onChange: (blocks: BlogBlock[]) => void
  meta: JourneyMeta | null
  maps: Record<string, MapContext> | undefined
  postDate: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  requestPhotos: PhotoRequest
  touch: boolean
  openSketch?: string | null
  onSketchClosed?: () => void
}

export default function BlockNoteEditor({ blocks, onChange, meta, maps, postDate, onSelect, requestPhotos, openSketch, onSketchClosed }: EditorProps) {
  const { t, language } = useTranslation()
  const editor = useCreateBlockNote({ schema, dictionary: language === 'es' ? bnEs : bnEn })
  const md = editor as unknown as MarkdownEditor
  const cites = useRef<CiteMap>(new Map())
  const lastEmitted = useRef<string>('')
  const applying = useRef(false)
  const [sketching, setSketching] = useState<string | null>(null)
  useEffect(() => { if (openSketch) setSketching(openSketch) }, [openSketch])

  // Load the post, and again whenever it changes from outside (bottom bar, journal entries panel).
  useEffect(() => {
    const json = JSON.stringify(blocks)
    if (json === lastEmitted.current) return
    applying.current = true
    try {
      editor.replaceBlocks(editor.document, toBlockNote(md, blocks, cites.current) as never)
    } finally {
      applying.current = false
    }
    lastEmitted.current = json
  }, [blocks, editor, md])

  useEffect(() => {
    const offChange = editor.onChange(() => {
      if (applying.current) return
      const next = fromBlockNote(md, editor.document as unknown as BNBlock[], cites.current)
      const json = JSON.stringify(next)
      if (json === lastEmitted.current) return
      lastEmitted.current = json
      onChange(next)
    })
    const offSel = editor.onSelectionChange(() => {
      try { onSelect(blogIdAt(editor.document as unknown as BNBlock[], editor.getTextCursorPosition().block.id)) } catch { /* no cursor */ }
    })
    return () => { offChange?.(); offSel?.() }
  }, [editor, md, onChange, onSelect])

  const insertMedia = (b: BlogBlock) => {
    const placed = insertOrUpdateBlockForSlashMenu(editor, { type: 'trek', props: { data: JSON.stringify(b) } } as never) as { id: string } | undefined
    if (b.type === 'sketch' && placed) setSketching(placed.id)
  }
  const mediaItem = (type: BlockType, icon: JSX.Element, aliases: string[]): DefaultReactSuggestionItem => ({
    title: t(`blog.block.${type}`),
    group: t('blog.editor.travelBlocks'),
    icon,
    aliases,
    onItemClick: () => {
      if (type === 'photo' || type === 'gallery') {
        requestPhotos(type === 'gallery', photos => { if (photos.length) insertMedia(newBlock(type, { photos })) })
        return
      }
      insertMedia(newBlock(type, { date: postDate, entryId: meta?.entries[0]?.id }))
    },
  })
  const slashItems = (query: string) => filterSuggestionItems([
    ...getDefaultReactSlashMenuItems(editor).filter(i => TEXT_ITEMS.has(String((i as { key?: string }).key))),
    mediaItem('photo', <ImageIcon size={18} />, ['foto', 'imagen', 'photo', 'image']),
    mediaItem('gallery', <Images size={18} />, ['galeria', 'galería', 'fotos', 'gallery']),
    mediaItem('map', <MapIcon size={18} />, ['mapa', 'map', 'ruta']),
    mediaItem('sketch', <PenLine size={18} />, ['dibujo', 'boceto', 'sketch', 'draw']),
    mediaItem('entry', <BookMarked size={18} />, ['entrada', 'diario', 'entry']),
  ], query)

  const ctx = useMemo<TrekCtx>(() => ({ meta, maps, postDate, requestPhotos, openSketch: setSketching }), [meta, maps, postDate, requestPhotos])
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  const sketchBlock = sketching ? (() => {
    const b = editor.getBlock(sketching)
    try { return b ? JSON.parse((b.props as { data: string }).data) as Extract<BlogBlock, { type: 'sketch' }> : undefined } catch { return undefined }
  })() : undefined

  return (
    <Ctx.Provider value={ctx}>
      <div className="trek-bn" style={{ ['--trek-reading-font' as string]: READING_FONT }}>
        <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} slashMenu={false} formattingToolbar={false}>
          <SuggestionMenuController triggerCharacter="/" getItems={async q => slashItems(q)} />
          <FormattingToolbarController formattingToolbar={() => (
            <FormattingToolbar>
              <BlockTypeSelect key="type" />
              <BasicTextStyleButton key="bold" basicTextStyle="bold" />
              <BasicTextStyleButton key="italic" basicTextStyle="italic" />
              <BasicTextStyleButton key="strike" basicTextStyle="strike" />
              <CreateLinkButton key="link" />
            </FormattingToolbar>
          )} />
        </BlockNoteView>
      </div>
      {sketchBlock && sketching && (
        <SketchEditor
          initial={{ strokes: sketchBlock.strokes, aspect: sketchBlock.aspect, background: sketchBlock.background }}
          onClose={() => { setSketching(null); onSketchClosed?.() }}
          onSave={(v: SketchValue) => {
            const b = editor.getBlock(sketching)
            if (b) editor.updateBlock(sketching, { props: { data: JSON.stringify({ ...sketchBlock, ...v }) } } as never)
            setSketching(null); onSketchClosed?.()
          }}
        />
      )}
    </Ctx.Provider>
  )
}

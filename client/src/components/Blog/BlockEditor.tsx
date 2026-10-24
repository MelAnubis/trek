import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUp, ArrowDown, Trash2, Plus, Type, Heading2, Quote, Image as ImageIcon, Images, Map as MapIcon, PenLine, Minus,
  BookMarked, RefreshCw, Pilcrow,
} from 'lucide-react'
import type { BlogBlock, BlockType, MapContext, PhotoRef } from '../../blog/types'
import type { JourneyMeta } from '../../blog/journeyMeta'
import { insertAfter, updateBlock, removeBlock, moveBlock, convertText, newBlock } from '../../blog/blockOps'
import { usePhotoSrc } from '../../blog/useBlog'
import { useTranslation } from '../../i18n'
import MarkdownToolbar from '../Journey/MarkdownToolbar'
import { SketchView } from './SketchCanvas'
import SketchEditor, { type SketchValue } from './SketchEditor'
import { MapBlockView, READING_FONT } from './BlogPostView'

export type PhotoRequest = (multiple: boolean, done: (refs: PhotoRef[]) => void) => void

export const BLOCK_MENU: { type: BlockType; icon: typeof Type; key: string }[] = [
  { type: 'paragraph', icon: Pilcrow, key: 'blog.block.paragraph' },
  { type: 'heading', icon: Heading2, key: 'blog.block.heading' },
  { type: 'photo', icon: ImageIcon, key: 'blog.block.photo' },
  { type: 'gallery', icon: Images, key: 'blog.block.gallery' },
  { type: 'sketch', icon: PenLine, key: 'blog.block.sketch' },
  { type: 'map', icon: MapIcon, key: 'blog.block.map' },
  { type: 'quote', icon: Quote, key: 'blog.block.quote' },
  { type: 'entry', icon: BookMarked, key: 'blog.block.entry' },
  { type: 'divider', icon: Minus, key: 'blog.block.divider' },
]

/** Textarea que crece con el texto (y funciona con Scribble del iPad: es un campo normal). */
function AutoText({ value, onChange, className, placeholder, inputRef, onKeyDown, onFocus, style, ariaLabel }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string
  inputRef?: React.RefObject<HTMLTextAreaElement | null>; onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus?: () => void; style?: React.CSSProperties; ariaLabel?: string
}) {
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? own
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, ref])
  return (
    <textarea
      ref={ref} value={value} rows={1} placeholder={placeholder} aria-label={ariaLabel}
      onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} onFocus={onFocus}
      className={`w-full resize-none bg-transparent outline-none overflow-hidden placeholder:text-zinc-300 dark:placeholder:text-zinc-600 ${className || ''}`}
      style={style}
    />
  )
}

function Thumb({ refp, className }: { refp: PhotoRef; className?: string }) {
  const src = usePhotoSrc(refp, 'thumbnail')
  return src ? <img src={src} alt="" className={className} draggable={false} /> : <div className={`bg-zinc-200 dark:bg-zinc-800 animate-pulse ${className || ''}`} />
}

function BigPhoto({ refp, className }: { refp: PhotoRef; className?: string }) {
  const src = usePhotoSrc(refp, 'original')
  return src ? <img src={src} alt="" className={className} draggable={false} /> : <div className={`bg-zinc-200 dark:bg-zinc-800 animate-pulse aspect-[4/3] ${className || ''}`} />
}

/** Menú de tipos de bloque (escritorio: entre bloques; móvil: «Más»). */
export function InsertMenu({ onPick, onClose, align = 'left' }: { onPick: (t: BlockType) => void; onClose: () => void; align?: 'left' | 'center' }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className={`absolute z-[61] mt-1 w-56 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-1 ${align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'}`} role="menu">
        {BLOCK_MENU.map(m => (
          <button key={m.type} type="button" role="menuitem" onClick={() => { onPick(m.type); onClose() }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <m.icon size={16} className="text-zinc-500" />{t(m.key)}
          </button>
        ))}
      </div>
    </>
  )
}

const chip = (on: boolean) => `h-8 px-2.5 rounded-lg text-[12px] font-medium whitespace-nowrap ${on ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`
const iconBtn = 'w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30'

interface EditorProps {
  blocks: BlogBlock[]
  onChange: (blocks: BlogBlock[]) => void
  meta: JourneyMeta | null
  maps: Record<string, MapContext> | undefined
  postDate: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  requestPhotos: PhotoRequest
  /** Móvil/tablet: sin botones «+» entre bloques (hay barra inferior). */
  touch: boolean
  /** Abrir el dibujo de este bloque (recién insertado desde la barra inferior). */
  openSketch?: string | null
  onSketchClosed?: () => void
}

export default function BlockEditor({ blocks, onChange, meta, maps, postDate, selectedId, onSelect, requestPhotos, touch, openSketch, onSketchClosed }: EditorProps) {
  const { t } = useTranslation()
  const [menuAt, setMenuAt] = useState<string | null>(null)
  const [sketching, setSketching] = useState<string | null>(null)
  const refs = useRef(new Map<string, HTMLTextAreaElement | null>())
  const focusLater = (id: string) => setTimeout(() => refs.current.get(id)?.focus(), 30)
  // Una ref por bloque de texto, viva (el textarea puede no existir aún).
  const refFor = (id: string) => ({
    get current() { return refs.current.get(id) ?? null },
    set current(el: HTMLTextAreaElement | null) { refs.current.set(id, el) },
  }) as React.MutableRefObject<HTMLTextAreaElement | null>
  useEffect(() => { if (openSketch) setSketching(openSketch) }, [openSketch])

  const set = (next: BlogBlock[]) => onChange(next)
  const patch = (id: string, p: Partial<BlogBlock>) => set(updateBlock(blocks, id, p))

  const insert = (afterId: string | null, type: BlockType) => {
    if (type === 'photo' || type === 'gallery') {
      requestPhotos(type === 'gallery', photos => {
        const b = newBlock(type, { photos })
        set(insertAfter(blocks, afterId, [b]))
        onSelect(b.id)
      })
      return
    }
    const b = newBlock(type, { date: postDate, entryId: meta?.entries[0]?.id })
    set(insertAfter(blocks, afterId, [b]))
    onSelect(b.id)
    if (type === 'sketch') setSketching(b.id)
    if (type === 'paragraph' || type === 'heading' || type === 'quote') focusLater(b.id)
  }

  const onParagraphKey = (b: BlogBlock, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    // Intro en una línea vacía al final: nuevo párrafo (como en cualquier editor).
    if (e.key === 'Enter' && !e.shiftKey && el.selectionStart === el.value.length && el.value.endsWith('\n')) {
      e.preventDefault()
      const trimmed = { ...b, text: (b as { text: string }).text.replace(/\n+$/, '') } as BlogBlock
      const nb = newBlock('paragraph')
      set(insertAfter(blocks.map(x => (x.id === b.id ? trimmed : x)), b.id, [nb]))
      onSelect(nb.id)
      focusLater(nb.id)
    }
    // Borrar en un párrafo vacío: se va el párrafo y vuelves al anterior.
    if (e.key === 'Backspace' && el.value === '' && blocks.length > 1) {
      e.preventDefault()
      const i = blocks.findIndex(x => x.id === b.id)
      const prev = blocks[i - 1]
      set(removeBlock(blocks, b.id))
      if (prev) { onSelect(prev.id); focusLater(prev.id) }
    }
  }

  const entriesSorted = [...(meta?.entries || [])].sort((a, b) => a.entry_date.localeCompare(b.entry_date))

  const toolbar = (b: BlogBlock, i: number, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-1 mb-2 px-1 py-1 rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200/70 dark:border-zinc-700/60 font-sans" onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
      <button type="button" className={iconBtn} disabled={i === 0} onClick={() => set(moveBlock(blocks, b.id, -1))} aria-label={t('blog.block.up')}><ArrowUp size={15} /></button>
      <button type="button" className={iconBtn} disabled={i === blocks.length - 1} onClick={() => set(moveBlock(blocks, b.id, 1))} aria-label={t('blog.block.down')}><ArrowDown size={15} /></button>
      <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
      {extra}
      <div className="flex-1" />
      <button type="button" className={`${iconBtn} hover:text-red-600`} onClick={() => { set(removeBlock(blocks, b.id)); onSelect(null) }} aria-label={t('blog.block.delete')}><Trash2 size={15} /></button>
    </div>
  )

  const textKinds = (b: BlogBlock) => (
    <>
      <button type="button" className={chip(b.type === 'paragraph')} onClick={() => set(blocks.map(x => (x.id === b.id ? convertText(b, 'paragraph') : x)))}>{t('blog.block.paragraph')}</button>
      <button type="button" className={chip(b.type === 'heading')} onClick={() => set(blocks.map(x => (x.id === b.id ? convertText(b, 'heading') : x)))}>{t('blog.block.heading')}</button>
      <button type="button" className={chip(b.type === 'quote')} onClick={() => set(blocks.map(x => (x.id === b.id ? convertText(b, 'quote') : x)))}>{t('blog.block.quote')}</button>
    </>
  )

  const renderBlock = (b: BlogBlock, i: number) => {
    const sel = selectedId === b.id
    switch (b.type) {
      case 'paragraph': {
        const ref = refFor(b.id)
        return (
          <>
            {sel && toolbar(b, i, <>{textKinds(b)}<div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" /><MarkdownToolbar textareaRef={ref} onUpdate={v => patch(b.id, { text: v })} /></>)}
            <AutoText
              inputRef={refFor(b.id)}
              value={b.text} onChange={v => patch(b.id, { text: v })} onKeyDown={e => onParagraphKey(b, e)} onFocus={() => onSelect(b.id)}
              placeholder={i === 0 ? t('blog.editor.startWriting') : t('blog.editor.writeMore')} ariaLabel={t('blog.block.paragraph')}
              className="text-[18px] leading-[1.75]" style={{ fontFamily: READING_FONT }}
            />
          </>
        )
      }
      case 'heading':
        return (
          <>
            {sel && toolbar(b, i, <>{textKinds(b)}<div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
              <button type="button" className={chip(b.level === 2)} onClick={() => patch(b.id, { level: 2 })}>H2</button>
              <button type="button" className={chip(b.level === 3)} onClick={() => patch(b.id, { level: 3 })}>H3</button></>)}
            <AutoText
              inputRef={refFor(b.id)}
              value={b.text} onChange={v => patch(b.id, { text: v.replace(/\n/g, ' ') })} onFocus={() => onSelect(b.id)} placeholder={t('blog.block.heading')} ariaLabel={t('blog.block.heading')}
              className={b.level === 2 ? 'text-[26px] font-bold tracking-[-0.015em] leading-tight' : 'text-[20px] font-semibold'}
            />
          </>
        )
      case 'quote':
        return (
          <>
            {sel && toolbar(b, i, textKinds(b))}
            <div className="pl-5 border-l-[3px] border-indigo-400">
              <AutoText
                inputRef={refFor(b.id)}
                value={b.text} onChange={v => patch(b.id, { text: v })} onFocus={() => onSelect(b.id)} placeholder={t('blog.block.quotePlaceholder')} ariaLabel={t('blog.block.quote')}
                className="text-[22px] italic leading-snug" style={{ fontFamily: READING_FONT }}
              />
              <input value={b.cite || ''} onChange={e => patch(b.id, { cite: e.target.value })} onFocus={() => onSelect(b.id)} placeholder={t('blog.block.cite')}
                className="w-full bg-transparent outline-none text-[13px] text-zinc-500 mt-1" />
            </div>
          </>
        )
      case 'photo':
        return (
          <>
            {sel && toolbar(b, i, <>
              {(['inline', 'wide', 'full'] as const).map(l => <button key={l} type="button" className={chip(b.layout === l)} onClick={() => patch(b.id, { layout: l })}>{t(`blog.layout.${l}`)}</button>)}
              <button type="button" className={iconBtn} aria-label={t('blog.photos.replace')} onClick={() => requestPhotos(false, ([p]) => p && patch(b.id, { photo: p }))}><RefreshCw size={15} /></button>
              {entriesSorted.length > 0 && (
                <select value={b.entryId ?? ''} onChange={e => patch(b.id, { entryId: e.target.value ? Number(e.target.value) : null })} aria-label={t('blog.photos.linkEntry')}
                  className="h-8 max-w-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[12px] px-1.5">
                  <option value="">{t('blog.photos.noEntry')}</option>
                  {entriesSorted.map(e => <option key={e.id} value={e.id}>{e.entry_date} · {e.title || '—'}</option>)}
                </select>
              )}
            </>)}
            <figure onClick={() => onSelect(b.id)} className={b.layout === 'inline' ? 'max-w-[460px] mx-auto' : ''}>
              <BigPhoto refp={b.photo} className="w-full h-auto rounded-xl" />
              <input value={b.caption || ''} onChange={e => patch(b.id, { caption: e.target.value })} onFocus={() => onSelect(b.id)} placeholder={t('blog.photos.caption')}
                className="w-full bg-transparent outline-none text-[13px] text-zinc-500 mt-2 text-center" />
            </figure>
          </>
        )
      case 'gallery':
        return (
          <>
            {sel && toolbar(b, i, <>
              {(['grid', 'mosaic', 'carousel'] as const).map(l => <button key={l} type="button" className={chip(b.layout === l)} onClick={() => patch(b.id, { layout: l })}>{t(`blog.layout.${l}`)}</button>)}
              <button type="button" className={chip(false)} onClick={() => requestPhotos(true, ps => patch(b.id, { photos: [...b.photos, ...ps] }))}><Plus size={13} className="inline -mt-0.5" /> {t('blog.photos.more')}</button>
            </>)}
            <figure onClick={() => onSelect(b.id)}>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {b.photos.map((p, k) => (
                  <div key={k} className="relative aspect-square group/ph">
                    <Thumb refp={p} className="w-full h-full object-cover rounded-lg" />
                    {sel && (
                      <div className="absolute inset-x-1 bottom-1 flex justify-between">
                        <button type="button" className="w-7 h-7 rounded-md bg-black/55 text-white flex items-center justify-center disabled:opacity-30" disabled={k === 0}
                          onClick={e => { e.stopPropagation(); const ps = b.photos.slice(); [ps[k - 1], ps[k]] = [ps[k], ps[k - 1]]; patch(b.id, { photos: ps }) }} aria-label={t('blog.block.up')}><ArrowUp size={13} className="-rotate-90" /></button>
                        <button type="button" className="w-7 h-7 rounded-md bg-black/55 text-white flex items-center justify-center"
                          onClick={e => { e.stopPropagation(); patch(b.id, { photos: b.photos.filter((_, x) => x !== k) }) }} aria-label={t('blog.block.delete')}><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                ))}
                {!b.photos.length && <button type="button" onClick={() => requestPhotos(true, ps => patch(b.id, { photos: ps }))} className="col-span-3 sm:col-span-4 h-28 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500">{t('blog.photos.pick')}</button>}
              </div>
              <input value={b.caption || ''} onChange={e => patch(b.id, { caption: e.target.value })} onFocus={() => onSelect(b.id)} placeholder={t('blog.photos.caption')}
                className="w-full bg-transparent outline-none text-[13px] text-zinc-500 mt-2 text-center" />
            </figure>
          </>
        )
      case 'map':
        return (
          <>
            {sel && toolbar(b, i, <>
              <select value={b.source} onChange={e => patch(b.id, { source: e.target.value as 'post' | 'day' | 'journey' })} aria-label={t('blog.map.source')}
                className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[12px] px-1.5">
                <option value="post">{t('blog.map.sourcePost')}</option>
                <option value="day">{t('blog.map.sourceDay')}</option>
                <option value="journey">{t('blog.map.sourceJourney')}</option>
              </select>
              {b.source === 'day' && <input type="date" value={b.date || postDate || ''} onChange={e => patch(b.id, { date: e.target.value || null })} className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[12px] px-1.5" />}
              <button type="button" className={chip(b.showTrack)} onClick={() => patch(b.id, { showTrack: !b.showTrack })}>{t('blog.map.track')}</button>
              <button type="button" className={chip(b.showPhotos)} onClick={() => patch(b.id, { showPhotos: !b.showPhotos })}>{t('blog.map.photos')}</button>
            </>)}
            <figure onClick={() => onSelect(b.id)}>
              <div className="pointer-events-none"><MapBlockView ctx={maps?.[b.id]} map={b} height={240} /></div>
              <input value={b.caption || ''} onChange={e => patch(b.id, { caption: e.target.value })} onFocus={() => onSelect(b.id)} placeholder={t('blog.photos.caption')}
                className="w-full bg-transparent outline-none text-[13px] text-zinc-500 mt-2 text-center" />
            </figure>
          </>
        )
      case 'sketch':
        return (
          <>
            {sel && toolbar(b, i, <button type="button" className={chip(true)} onClick={() => setSketching(b.id)}><PenLine size={13} className="inline -mt-0.5" /> {t('blog.sketch.edit')}</button>)}
            <figure className="w-full max-w-[640px] mx-auto">
              <button type="button" onClick={() => { onSelect(b.id); setSketching(b.id) }} className="block w-full rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 relative" aria-label={t('blog.sketch.edit')}>
                <SketchView strokes={b.strokes} aspect={b.aspect} background={b.background} />
                {!b.strokes.length && <span className="absolute inset-0 flex items-center justify-center gap-2 text-zinc-400 text-sm font-sans"><PenLine size={18} />{t('blog.sketch.tapToDraw')}</span>}
              </button>
              <input value={b.caption || ''} onChange={e => patch(b.id, { caption: e.target.value })} onFocus={() => onSelect(b.id)} placeholder={t('blog.photos.caption')}
                className="w-full bg-transparent outline-none text-[13px] text-zinc-500 mt-2 text-center" />
            </figure>
          </>
        )
      case 'entry': {
        const e = meta?.entries.find(x => x.id === b.entryId)
        return (
          <>
            {sel && toolbar(b, i)}
            <div onClick={() => onSelect(b.id)} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 font-sans">
              <select value={b.entryId || ''} onChange={ev => patch(b.id, { entryId: Number(ev.target.value) })} aria-label={t('blog.block.entry')}
                className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2">
                {!e && <option value="">{t('blog.entries.choose')}</option>}
                {entriesSorted.map(x => <option key={x.id} value={x.id}>{x.entry_date} · {x.title || '—'}</option>)}
              </select>
              {e?.story && <p className="text-[13px] text-zinc-500 mt-2 line-clamp-2">{e.story}</p>}
            </div>
          </>
        )
      }
      case 'divider':
        return (
          <>
            {sel && toolbar(b, i)}
            <button type="button" onClick={() => onSelect(b.id)} className="w-full flex justify-center gap-3 py-2 text-zinc-300 dark:text-zinc-600" aria-label={t('blog.block.divider')}>●  ●  ●</button>
          </>
        )
    }
  }

  const sketchBlock = sketching ? blocks.find(b => b.id === sketching && b.type === 'sketch') as Extract<BlogBlock, { type: 'sketch' }> | undefined : undefined

  return (
    <div className="flex flex-col">
      {blocks.map((b, i) => (
        <div key={b.id} className="group relative" data-block-id={b.id} data-block-type={b.type}>
          <div className={`relative rounded-xl transition-colors py-2.5 ${selectedId === b.id ? '' : ''}`}>
            {renderBlock(b, i)}
          </div>
          {!touch && (
            <div className="relative h-0 flex justify-center">
              <button type="button" onClick={() => setMenuAt(menuAt === b.id ? null : b.id)} aria-label={t('blog.editor.addBlock')}
                className={`absolute -top-3 z-10 w-6 h-6 rounded-full border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-500 flex items-center justify-center shadow-sm transition-opacity ${menuAt === b.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
                <Plus size={13} />
              </button>
              {menuAt === b.id && <div className="absolute top-3"><InsertMenu align="center" onPick={type => insert(b.id, type)} onClose={() => setMenuAt(null)} /></div>}
            </div>
          )}
        </div>
      ))}
      {!touch && (
        <div className="relative mt-4 font-sans">
          <button type="button" onClick={() => setMenuAt(menuAt === '__end' ? null : '__end')} className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 px-1 py-2">
            <Plus size={16} />{t('blog.editor.addBlock')}
          </button>
          {menuAt === '__end' && <InsertMenu onPick={type => insert(null, type)} onClose={() => setMenuAt(null)} />}
        </div>
      )}
      {sketchBlock && (
        <SketchEditor
          initial={{ strokes: sketchBlock.strokes, aspect: sketchBlock.aspect, background: sketchBlock.background }}
          onClose={() => { setSketching(null); onSketchClosed?.() }}
          onSave={(v: SketchValue) => { patch(sketchBlock.id, v); setSketching(null); onSketchClosed?.() }}
        />
      )}
    </div>
  )
}

/** Para la barra inferior del móvil: inserta un bloque detrás del seleccionado. */
export function useBlockInserter(blocks: BlogBlock[], onChange: (b: BlogBlock[]) => void, selectedId: string | null, onSelect: (id: string | null) => void, requestPhotos: PhotoRequest, postDate: string | null, firstEntryId?: number) {
  return (type: BlockType): string | null => {
    if (type === 'photo' || type === 'gallery') {
      requestPhotos(type === 'gallery', photos => {
        const b = newBlock(type, { photos })
        onChange(insertAfter(blocks, selectedId, [b]))
        onSelect(b.id)
      })
      return null
    }
    const b = newBlock(type, { date: postDate, entryId: firstEntryId })
    onChange(insertAfter(blocks, selectedId, [b]))
    onSelect(b.id)
    return b.id
  }
}

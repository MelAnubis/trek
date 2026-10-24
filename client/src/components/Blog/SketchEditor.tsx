import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pen, Highlighter, Brush, Eraser, Undo2, Redo2, Trash2, Check, X, PenLine } from 'lucide-react'
import type { SketchStroke } from '../../blog/types'
import { useTranslation } from '../../i18n'
import { SketchCanvas } from './SketchCanvas'
import { SKETCH_COLORS, SKETCH_SIZES, type SketchTool } from './sketch'

type Background = 'paper' | 'grid' | 'lines' | 'transparent'
export interface SketchValue { strokes: SketchStroke[]; aspect: number; background: Background }

const ASPECTS: { value: number; key: string }[] = [
  { value: 0.62, key: 'blog.sketch.wide' },
  { value: 1, key: 'blog.sketch.square' },
  { value: 1.33, key: 'blog.sketch.tall' },
]

/**
 * Dibujo a pantalla completa. En iPad, en cuanto se usa el Apple Pencil se
 * activa «solo lápiz»: la palma apoyada y los dedos ya no pintan.
 */
export default function SketchEditor({ initial, onSave, onClose }: { initial: SketchValue; onSave: (v: SketchValue) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [strokes, setStrokes] = useState<SketchStroke[]>(initial.strokes)
  const [undo, setUndo] = useState<SketchStroke[][]>([])
  const [redo, setRedo] = useState<SketchStroke[][]>([])
  const [tool, setTool] = useState<SketchTool>('pen')
  const [color, setColor] = useState(SKETCH_COLORS[0])
  const [sizeIdx, setSizeIdx] = useState(1)
  const [aspect, setAspect] = useState(initial.aspect)
  const [background, setBackground] = useState<Background>(initial.background)
  const [penOnly, setPenOnly] = useState(false)
  const [penSeen, setPenSeen] = useState(false)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    const r = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', r)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('resize', r); document.body.style.overflow = prev }
  }, [])

  const change = (next: SketchStroke[]) => {
    setUndo(u => [...u.slice(-80), strokes])
    setRedo([])
    setStrokes(next)
  }
  const doUndo = () => { if (!undo.length) return; setRedo(r => [...r, strokes]); setStrokes(undo[undo.length - 1]); setUndo(u => u.slice(0, -1)) }
  const doRedo = () => { if (!redo.length) return; setUndo(u => [...u, strokes]); setStrokes(redo[redo.length - 1]); setRedo(r => r.slice(0, -1)) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo() }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sizes = tool === 'eraser' ? SKETCH_SIZES.pen : SKETCH_SIZES[tool]
  // El lienzo cabe entero en pantalla, sea cual sea la proporción.
  const chrome = viewport.w < 640 ? 132 : 84
  const width = Math.max(240, Math.min(viewport.w - 24, (viewport.h - chrome - 24) / aspect, 1400))

  const toolBtn = (id: SketchTool, Icon: typeof Pen, label: string) => (
    <button
      type="button" aria-label={label} title={label} aria-pressed={tool === id}
      onClick={() => setTool(id)}
      className={`w-10 h-10 rounded-xl flex items-center justify-center ${tool === id ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
    ><Icon size={18} /></button>
  )

  return createPortal(
    <div className="fixed inset-0 z-[300] flex flex-col bg-zinc-100 dark:bg-zinc-950" role="dialog" aria-modal="true" aria-label={t('blog.sketch.title')}>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
        <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button>
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        {toolBtn('pen', Pen, t('blog.sketch.pen'))}
        {toolBtn('marker', Brush, t('blog.sketch.marker'))}
        {toolBtn('highlighter', Highlighter, t('blog.sketch.highlighter'))}
        {toolBtn('eraser', Eraser, t('blog.sketch.eraser'))}
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        <div className="flex items-center gap-1">
          {SKETCH_COLORS.map(c => (
            <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen') }}
              className={`w-7 h-7 rounded-full border ${color === c ? 'ring-2 ring-offset-2 ring-zinc-900 dark:ring-white dark:ring-offset-zinc-900' : ''}`}
              style={{ background: c, borderColor: c === '#ffffff' ? '#d4d4d8' : c }} />
          ))}
        </div>
        <div className="flex items-center gap-1 ml-1">
          {sizes.map((s, i) => (
            <button key={i} type="button" aria-label={`${t('blog.sketch.size')} ${i + 1}`} aria-pressed={sizeIdx === i} onClick={() => setSizeIdx(i)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${sizeIdx === i ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              <span className="rounded-full bg-zinc-800 dark:bg-zinc-200" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        <button type="button" onClick={doUndo} disabled={!undo.length} aria-label={t('blog.sketch.undo')} className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Undo2 size={18} /></button>
        <button type="button" onClick={doRedo} disabled={!redo.length} aria-label={t('blog.sketch.redo')} className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Redo2 size={18} /></button>
        <button type="button" onClick={() => strokes.length && change([])} disabled={!strokes.length} aria-label={t('blog.sketch.clear')} className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-300 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Trash2 size={18} /></button>
        <div className="flex-1" />
        <select value={background} onChange={e => setBackground(e.target.value as Background)} aria-label={t('blog.sketch.background')}
          className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm px-2">
          <option value="paper">{t('blog.sketch.paper')}</option>
          <option value="grid">{t('blog.sketch.grid')}</option>
          <option value="lines">{t('blog.sketch.lines')}</option>
          <option value="transparent">{t('blog.sketch.plain')}</option>
        </select>
        <select value={String(aspect)} onChange={e => setAspect(Number(e.target.value))} aria-label={t('blog.sketch.shape')}
          className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm px-2">
          {ASPECTS.map(a => <option key={a.value} value={a.value}>{t(a.key)}</option>)}
          {!ASPECTS.some(a => a.value === aspect) && <option value={aspect}>{aspect}</option>}
        </select>
        {penSeen && (
          <button type="button" onClick={() => setPenOnly(v => !v)} aria-pressed={penOnly}
            className={`h-9 px-3 rounded-lg text-sm flex items-center gap-1.5 ${penOnly ? 'bg-indigo-600 text-white' : 'border border-zinc-200 dark:border-zinc-700'}`}>
            <PenLine size={15} />{t('blog.sketch.penOnly')}
          </button>
        )}
        <button type="button" onClick={() => onSave({ strokes, aspect, background })}
          className="h-9 px-4 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm font-medium flex items-center gap-1.5">
          <Check size={16} />{t('blog.sketch.done')}
        </button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-3">
        <div className="shadow-lg rounded-md overflow-hidden" style={{ width }}>
          <SketchCanvas
            strokes={strokes} aspect={aspect} background={background}
            tool={tool} color={color} size={sizes[Math.min(sizeIdx, sizes.length - 1)]}
            penOnly={penOnly}
            onPenDetected={() => { if (!penSeen) { setPenSeen(true); setPenOnly(true) } }}
            onChange={change}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

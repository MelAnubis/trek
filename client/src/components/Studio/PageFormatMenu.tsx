import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { BookPageSetup } from '../../types/book'
import { BLEED_MAX, PAGE_PRESETS, PAGE_SIZE_MAX, PAGE_SIZE_MIN, SAFE_MAX } from './pagePresets'

/**
 * The toolbar's page-format picker: the named presets, a free trim size,
 * and the two print edges (bleed and safe margin) — the same three things a
 * print vendor states in one breath, so they live in one menu, as in
 * upstream's StudioShell.
 *
 * Typing into the size fields *is* choosing custom: there is no separate
 * "custom" row to click first. And unlike upstream, a size change can carry
 * the layout with it ("Fit content to the new size", on by default) — see
 * reflowDocument in pagePresets.ts. Both paths are a single undo step.
 */

const REFLOW_KEY = 'trek.studio.reflowOnResize'

function readReflow(): boolean {
  try { return localStorage.getItem(REFLOW_KEY) !== '0' } catch { return true }
}
function writeReflow(on: boolean) {
  try { localStorage.setItem(REFLOW_KEY, on ? '1' : '0') } catch { /* private window etc. — the default still works */ }
}

interface Props {
  page: BookPageSetup
  t: (key: string, params?: Record<string, string | number>) => string
  onPreset: (preset: BookPageSetup['preset'], reflow: boolean) => void
  onSize: (axis: 'w' | 'h', value: number, reflow: boolean) => void
  onEdge: (which: 'bleed' | 'safe', value: number, reflow: boolean) => void
}

/** A number field that only commits on blur or Enter, so typing "2", "21", "210" isn't three reflows. */
function MmField({ label, value, min, max, step, onCommit, testId }: {
  label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; testId: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    const n = Number(draft.replace(',', '.'))
    if (draft.trim() === '' || !Number.isFinite(n)) { setDraft(String(value)); return }
    onCommit(n)
  }
  return (
    <label className="!flex !flex-col !gap-[3px] !text-[length:10px] ![color:var(--text-faint)] !flex-[1] !min-w-[0]">
      {label}
      <input className="!w-[100%] !p-[6px_8px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] ![font-family:inherit] !text-[length:12px]"
        data-testid={testId}
        type="number" inputMode="decimal" min={min} max={max} step={step} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setDraft(String(value))
        }}
      />
    </label>
  )
}

function ShapeTile({ w, h }: { w: number; h: number }) {
  const box = 22
  const sw = w >= h ? box : Math.round(box * w / h)
  const sh = h >= w ? box : Math.round(box * h / w)
  return (
    <span className="!flex !items-center !justify-center !shrink-[0]" style={{ width: box, height: box }}>
      <span className="!rounded-[2px] ![border:1.5px_solid_var(--text-muted)]" style={{ width: sw, height: sh }} />
    </span>
  )
}

export function PageFormatMenu({ page, t, onPreset, onSize, onEdge }: Props) {
  const [open, setOpen] = useState(false)
  const [reflow, setReflow] = useState(readReflow)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
  const label = page.preset === 'custom'
    ? `${fmt(page.pageWidth)} × ${fmt(page.pageHeight)} mm`
    : t(PAGE_PRESETS[page.preset].labelKey)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="!flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-primary)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={() => setOpen(v => !v)} title={t('journey.studio.format')} aria-haspopup="listbox" aria-expanded={open}>
        {label}
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div className="!absolute !top-[100%] !right-[0] !mt-[4px] !w-[260px] !max-w-[calc(100vw_-_32px)] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![box-shadow:0_8px_24px_rgba(0,0,0,0.15)] !p-[4px] !z-[20]">
          <div role="listbox" aria-label={t('journey.studio.format')}>
            {(Object.keys(PAGE_PRESETS) as (keyof typeof PAGE_PRESETS)[]).map(key => {
              const p = PAGE_PRESETS[key]
              const on = page.preset === key
              return (
                <button className="!flex !items-center !gap-[10px] !w-[100%] !text-left !p-[7px_8px] !rounded-[6px] ![border:none] !text-[length:12px] !cursor-pointer ![color:var(--text-primary)] ![font-family:inherit]" key={key} role="option" aria-selected={on} onClick={() => { onPreset(key, reflow); setOpen(false) }} style={{ background: on ? 'var(--bg-tertiary)' : 'none' }}>
                  <ShapeTile w={p.pageWidth} h={p.pageHeight} />
                  <span className="!flex-[1] !flex !flex-col">
                    <span>{t(p.labelKey)}</span>
                    <span className="!text-[length:10px] ![color:var(--text-faint)]">{p.pageWidth} × {p.pageHeight} mm</span>
                  </span>
                  {on && <Check size={13} />}
                </button>
              )
            })}
          </div>

          <div className="!h-[1px] ![background:var(--border-secondary)] !m-[4px_2px]" />

          <div className="!p-[4px_6px_2px]">
            <div className="!text-[length:10px] !font-[700] !uppercase !tracking-[0.05em] ![color:var(--text-faint)] !mb-[6px] !flex !justify-between">
              <span>{t('journey.studio.pagePreset.custom')}</span>
              {page.preset === 'custom' && <Check size={12} />}
            </div>
            <div className="!flex !gap-[6px] !items-end !mb-[8px]">
              <MmField testId="page-width" label={t('journey.studio.pageField.pageWidth')} value={page.pageWidth} min={PAGE_SIZE_MIN} max={PAGE_SIZE_MAX} step={1} onCommit={v => onSize('w', v, reflow)} />
              <span className="!pb-[7px] ![color:var(--text-faint)] !text-[length:12px]">×</span>
              <MmField testId="page-height" label={t('journey.studio.pageField.pageHeight')} value={page.pageHeight} min={PAGE_SIZE_MIN} max={PAGE_SIZE_MAX} step={1} onCommit={v => onSize('h', v, reflow)} />
            </div>
            <div className="!flex !gap-[6px] !mb-[8px]">
              <MmField testId="page-bleed" label={t('journey.studio.pageField.bleed')} value={page.bleed} min={0} max={BLEED_MAX} step={0.5} onCommit={v => onEdge('bleed', v, reflow)} />
              <span className="!w-[9px]" />
              <MmField testId="page-safe" label={t('journey.studio.pageField.safe')} value={page.safe} min={0} max={SAFE_MAX} step={0.5} onCommit={v => onEdge('safe', v, reflow)} />
            </div>
            <label className="!flex !items-start !gap-[6px] !text-[length:11px] ![color:var(--text-muted)] !cursor-pointer !leading-[1.4] !p-[2px_0_4px]">
              <input className="!mt-[2px]" type="checkbox" checked={reflow} onChange={e => { setReflow(e.target.checked); writeReflow(e.target.checked) }} />
              <span>
                {t('journey.studio.reflowOnResize')}
                <span className="!block !text-[length:10px] ![color:var(--text-faint)]">{t('journey.studio.reflowOnResizeHint')}</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

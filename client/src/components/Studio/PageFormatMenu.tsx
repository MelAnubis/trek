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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--text-faint)', flex: 1, minWidth: 0 }}>
      {label}
      <input
        data-testid={testId}
        type="number" inputMode="decimal" min={min} max={max} step={step} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setDraft(String(value))
        }}
        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12 }}
      />
    </label>
  )
}

function ShapeTile({ w, h }: { w: number; h: number }) {
  const box = 22
  const sw = w >= h ? box : Math.round(box * w / h)
  const sh = h >= w ? box : Math.round(box * h / w)
  return (
    <span style={{ width: box, height: box, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ width: sw, height: sh, borderRadius: 2, border: '1.5px solid var(--text-muted)' }} />
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
      <button onClick={() => setOpen(v => !v)} title={t('journey.studio.format')} aria-haspopup="listbox" aria-expanded={open} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10,
        border: '1px solid var(--border-primary)', background: 'none', color: 'var(--text-primary)',
        fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
      }}>
        {label}
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 260, maxWidth: 'calc(100vw - 32px)', borderRadius: 10,
          border: '1px solid var(--border-primary)', background: 'var(--bg-card)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          padding: 4, zIndex: 20,
        }}>
          <div role="listbox" aria-label={t('journey.studio.format')}>
            {(Object.keys(PAGE_PRESETS) as (keyof typeof PAGE_PRESETS)[]).map(key => {
              const p = PAGE_PRESETS[key]
              const on = page.preset === key
              return (
                <button key={key} role="option" aria-selected={on} onClick={() => { onPreset(key, reflow); setOpen(false) }} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  textAlign: 'left', padding: '7px 8px', borderRadius: 6, border: 'none',
                  background: on ? 'var(--bg-tertiary)' : 'none',
                  fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit',
                }}>
                  <ShapeTile w={p.pageWidth} h={p.pageHeight} />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <span>{t(p.labelKey)}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.pageWidth} × {p.pageHeight} mm</span>
                  </span>
                  {on && <Check size={13} />}
                </button>
              )
            })}
          </div>

          <div style={{ height: 1, background: 'var(--border-secondary)', margin: '4px 2px' }} />

          <div style={{ padding: '4px 6px 2px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('journey.studio.pagePreset.custom')}</span>
              {page.preset === 'custom' && <Check size={12} />}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 8 }}>
              <MmField testId="page-width" label={t('journey.studio.pageField.pageWidth')} value={page.pageWidth} min={PAGE_SIZE_MIN} max={PAGE_SIZE_MAX} step={1} onCommit={v => onSize('w', v, reflow)} />
              <span style={{ paddingBottom: 7, color: 'var(--text-faint)', fontSize: 12 }}>×</span>
              <MmField testId="page-height" label={t('journey.studio.pageField.pageHeight')} value={page.pageHeight} min={PAGE_SIZE_MIN} max={PAGE_SIZE_MAX} step={1} onCommit={v => onSize('h', v, reflow)} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <MmField testId="page-bleed" label={t('journey.studio.pageField.bleed')} value={page.bleed} min={0} max={BLEED_MAX} step={0.5} onCommit={v => onEdge('bleed', v, reflow)} />
              <span style={{ width: 9 }} />
              <MmField testId="page-safe" label={t('journey.studio.pageField.safe')} value={page.safe} min={0} max={SAFE_MAX} step={0.5} onCommit={v => onEdge('safe', v, reflow)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1.4, padding: '2px 0 4px' }}>
              <input type="checkbox" checked={reflow} onChange={e => { setReflow(e.target.checked); writeReflow(e.target.checked) }} style={{ marginTop: 2 }} />
              <span>
                {t('journey.studio.reflowOnResize')}
                <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)' }}>{t('journey.studio.reflowOnResizeHint')}</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

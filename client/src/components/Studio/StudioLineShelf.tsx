import type { BookElement, BookPageSetup } from '../../types/book'
import { bookNewLine } from './bookLine'
import { elementId } from './bookIds'
import { LinePaths } from './LineView'
import { DIVIDER_PRESETS, LINE_PRESETS, type LinePreset, presetPoints } from './linePresets'
import { lineGeometry } from './lineRender'

/**
 * The drawn lines and dividers of the Elements panel (5.7.6, port of
 * liketrek/TREK's StudioLineShelf.tsx). Each tile is drawn by the same
 * geometry the page uses, so the tile is the line you get. They arrive half a
 * page wide on the right-hand page and their ends are moved on the canvas.
 */

type T = (k: string) => string

function LineGlyph({ preset }: { preset: LinePreset }) {
  const W = 40
  const H = 24
  const pts = presetPoints(preset, 4, H / 2, W - 8).map(p => [p.x, p.y] as [number, number])
  const el = bookNewLine(preset.id, pts, { ...preset.look, strokeWidth: Math.max(1.2, (preset.look.strokeWidth ?? 0.5) * 2.4) })
  const g = lineGeometry(el, el.frame.w, el.frame.h, preset.id)
  return (
    <svg viewBox={`${-el.frame.x} ${-el.frame.y} ${W} ${H}`} width="100%" height="100%" aria-hidden>
      <LinePaths g={g} color="currentColor" width={el.strokeWidth} />
    </svg>
  )
}

export function StudioLineShelf({ page, single, onAdd, t }: {
  page: BookPageSetup
  /** A single page (cover, first, last, back) rather than a double spread. */
  single: boolean
  onAdd: (el: BookElement) => void
  t: T
}) {
  const add = (preset: LinePreset) => {
    const origin = single ? 0 : page.pageWidth
    const w = page.pageWidth * (preset.id.startsWith('divider') ? 0.4 : 0.5)
    const x = origin + (page.pageWidth - w) / 2
    const pts = presetPoints(preset, x, page.pageHeight / 2, w).map(p => [p.x, p.y] as [number, number])
    onAdd(bookNewLine(elementId('ln'), pts, preset.look))
  }
  const tiles = (list: readonly LinePreset[]) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
      {list.map(p => {
        const label = t(`journey.studio.line.preset.${p.id}`)
        return (
          <button key={p.id} type="button" data-testid={`line-preset-${p.id}`} onClick={() => add(p)} title={label} aria-label={label}
            style={{ aspectRatio: '5 / 3', padding: 3, borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex' }}>
            <LineGlyph preset={p} />
          </button>
        )
      })}
    </div>
  )
  const head = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '10px 0 4px' }
  return (
    <div data-testid="line-shelf">
      <div style={head}>{t('journey.studio.line.shelf')}</div>
      {tiles(LINE_PRESETS)}
      <div style={head}>{t('journey.studio.line.dividers')}</div>
      {tiles(DIVIDER_PRESETS)}
    </div>
  )
}

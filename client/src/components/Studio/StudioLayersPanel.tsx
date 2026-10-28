import {
  Award, BarChart3, ChevronRight, Eye, EyeOff, Globe2, GripVertical, Group, Hotel, ImageIcon, ListChecks,
  Lock, Luggage, Map as MapIcon, MapPin, Shapes, Sparkles, Square, Type, Ungroup, Unlock, type LucideIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { BookElement } from '../../types/book'
import { useStudioStore } from '../../store/studioStore'
import { isWholeGroup } from './bookGroups'
import { dropOn, layerKeyAction, layerLabel, layerRows, rowIds, type LayerDrop, type LayerKeyAction, type LayerRow } from './studioLayerRows'

/**
 * The layers of the open page, front to back. Ported from liketrek/TREK's
 * client/src/components/Studio/StudioLayersPanel.tsx (same AGPLv3 license),
 * restyled to this fork's inline-style rail.
 *
 * One row per element and one per group, its members indented under it. A row
 * selects what it stands for; a member's row selects the member alone, inside
 * its group. Rows drag to restack: the upper half of a row puts what is
 * dragged in front of it, the lower half behind it, and a member's row takes
 * it into that group. Lock and visibility sit at the end of every row; a
 * hidden layer is dimmed, not removed, since this panel is the way back to it.
 * Every change is one undo step.
 *
 * The tree is one stop in the Tab order and works without a mouse
 * (studioLayerRows.ts): arrows move along it and open or close a group, Enter
 * or Space selects (Shift adds), F2 renames, Alt+↑/↓ moves the layer, L locks
 * and H hides it.
 */

const KIND_ICONS: Record<string, LucideIcon> = {
  photo: ImageIcon, text: Type, shape: Square, image: ImageIcon, icon: Sparkles, map: MapIcon,
  stats: BarChart3, countries: Globe2, places: MapPin, badge: Award, list: ListChecks,
  packing: Luggage, accommodation: Hotel,
}

/** How far, in pixels, a press on a row travels before it is a drag rather than a click. */
const DRAG_PX = 4

interface Drag {
  ids: string[]
  startY: number
  active: boolean
  drop: LayerDrop | null
  overKey: string | null
  upper: boolean
}

type T = (k: string, params?: Record<string, string | number>) => string

const runsRtl = (node: HTMLElement) => getComputedStyle(node).direction === 'rtl'

export function StudioLayersPanel({ t }: { t: T }) {
  const spreadIndex = useStudioStore(s => s.activeSpread)
  const spread = useStudioStore(s => s.doc?.spreads[s.activeSpread])
  const selection = useStudioStore(s => s.selection)
  const enteredGroup = useStudioStore(s => s.enteredGroup)
  const readOnly = useStudioStore(s => s.readOnly)
  const pick = useStudioStore(s => s.pick)
  const selectGroup = useStudioStore(s => s.selectGroup)
  const enterGroup = useStudioStore(s => s.enterGroup)
  const restack = useStudioStore(s => s.restack)
  const raise = useStudioStore(s => s.raise)
  const setHidden = useStudioStore(s => s.setHidden)
  const setLocked = useStudioStore(s => s.setLocked)
  const renameLayer = useStudioStore(s => s.renameLayer)
  const group = useStudioStore(s => s.group)
  const ungroup = useStudioStore(s => s.ungroup)

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** The row the keyboard is on, so the tree keeps its place in the Tab order. */
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  /** A drag ends in a click on the row it started from; that click is not a choice. */
  const justDragged = useRef(false)

  if (!spread) return null
  const rows = layerRows(spread, collapsed)
  const selected = new Set(selection)
  const movable = spread.elements.filter(e => selected.has(e.id) && !e.locked)
  const canGroup = movable.length >= 2 && !isWholeGroup(spread, movable.map(e => e.id))
  const canUngroup = spread.elements.some(e => selected.has(e.id) && e.group)

  const toggleCollapsed = (groupId: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    return next
  })

  const selectRow = (row: LayerRow, additive: boolean) => {
    if (row.type === 'group') selectGroup(spreadIndex, row.groupId, additive)
    else if (row.inGroup && !additive) enterGroup(spreadIndex, row.el.id)
    else pick(spreadIndex, row.el.id, additive)
  }

  const choose = (row: LayerRow, additive: boolean) => {
    if (justDragged.current) { justDragged.current = false; return }
    selectRow(row, additive)
  }

  /** The one row in the Tab order: the one last focused, else the first selected, else the front one. */
  const tabKey = rows.find(r => r.key === focusKey)?.key
    ?? rows.find(r => rowIds(r).every(id => selected.has(id)))?.key
    ?? rows[0]?.key

  const focusRow = (key: string | undefined) => {
    if (!key) return
    setFocusKey(key)
    // After the render that may have moved the row.
    requestAnimationFrame(() => {
      const nodes = list.current?.querySelectorAll<HTMLElement>('[data-layer-key]') ?? []
      Array.from(nodes).find(n => n.dataset.layerKey === key)?.focus()
    })
  }

  const rowState = (row: LayerRow) => {
    const els: BookElement[] = row.type === 'group' ? row.members : [row.el]
    return { locked: els.every(e => e.locked), hidden: els.every(e => e.hidden) }
  }

  const runKey = (action: LayerKeyAction, row: LayerRow) => {
    if (action.type === 'focus') focusRow(rows[action.index]?.key)
    else if (action.type === 'expand' || action.type === 'collapse') toggleCollapsed(action.groupId)
    else if (action.type === 'rename') { if (!readOnly) setRenaming(row.key) }
    else if (action.type === 'lock') { if (!readOnly) setLocked(spreadIndex, rowIds(row), !rowState(row).locked) }
    else if (action.type === 'hide') { if (!readOnly) setHidden(spreadIndex, rowIds(row), !rowState(row).hidden) }
    else if (action.type === 'move') {
      if (readOnly) return
      // A member moves among its group's members; anything else past its neighbour, whole groups at once.
      if (row.type === 'element' && row.inGroup) enterGroup(spreadIndex, row.el.id)
      raise(spreadIndex, rowIds(row), action.dir === 'up' ? 'forward' : 'backward')
      focusRow(row.key)
    } else selectRow(row, action.additive)
  }

  const onTreeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const node = e.target as HTMLElement
    if (node.tagName === 'INPUT') return
    const index = rows.findIndex(r => r.key === node.dataset.layerKey)
    const row = rows[index]
    if (!row) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const action = layerKeyAction(e.key, index, rows, { collapsed, rtl: runsRtl(node), additive, alt: e.altKey })
    if (!action) return
    // Taken here, so the page does not also nudge or act on the selection (useStudioKeys.ts).
    e.preventDefault()
    runKey(action, row)
  }

  /** What a drag from this row carries: the selection when the row is in it, else what the row stands for. */
  const dragIds = (row: LayerRow) => {
    const own = rowIds(row)
    return own.every(id => selected.has(id)) ? spread.elements.filter(e => selected.has(e.id)).map(e => e.id) : own
  }

  const rowAt = (clientY: number): { row: LayerRow; upper: boolean } | null => {
    const nodes = list.current?.querySelectorAll<HTMLElement>('[data-layer-key]') ?? []
    for (const node of Array.from(nodes)) {
      const r = node.getBoundingClientRect()
      if (clientY < r.top || clientY > r.bottom) continue
      const row = rows.find(x => x.key === node.dataset.layerKey)
      if (row) return { row, upper: clientY < r.top + r.height / 2 }
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent, row: LayerRow) => {
    if (e.button !== 0 || readOnly) return
    if ((e.target as HTMLElement).closest('button, input')) return
    setDrag({ ids: dragIds(row), startY: e.clientY, active: false, drop: null, overKey: null, upper: true })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    if (!drag.active && Math.abs(e.clientY - drag.startY) < DRAG_PX) return
    if (!drag.active) {
      try { list.current?.setPointerCapture?.(e.pointerId) } catch { /* gone already; the drag still follows the list */ }
    }
    const at = rowAt(e.clientY)
    const over = at && !rowIds(at.row).some(id => drag.ids.includes(id)) ? at : null
    setDrag({ ...drag, active: true, drop: over ? dropOn(over.row, over.upper) : null, overKey: over?.row.key ?? null, upper: over?.upper ?? true })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return
    try { list.current?.releasePointerCapture?.(e.pointerId) } catch { /* a click that did not move */ }
    justDragged.current = drag.active
    if (drag.active && drag.drop) restack(spreadIndex, drag.ids, drag.drop.anchorId, drag.drop.where, drag.drop.join)
    setDrag(null)
  }

  const commitName = (row: LayerRow, value: string) => {
    setRenaming(null)
    focusRow(row.key)
    const current = row.type === 'group' ? (row.name ?? '') : (row.el.name ?? '')
    if (value.trim() === current) return
    renameLayer(spreadIndex, row.type === 'group' ? { groupId: row.groupId } : { elementId: row.el.id }, value)
  }

  return (
    <div data-testid="layers-panel">
      {rows.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>{t('journey.studio.layers.empty')}</p>
      ) : (
        <>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '0 0 6px', lineHeight: 1.4 }}>{t('journey.studio.layers.hint')}</p>
          <div
            ref={list}
            role="tree"
            aria-label={t('journey.studio.layers')}
            className={`st-layers ${drag?.active ? 'is-dragging' : ''}`}
            onKeyDown={onTreeKey}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {rows.map(row => {
              const { locked, hidden } = rowState(row)
              const isSel = rowIds(row).every(id => selected.has(id))
              const inside = row.type === 'element' && row.inGroup && row.el.group === enteredGroup
              const isCollapsed = row.type === 'group' && collapsed.has(row.groupId)
              const Icon = row.type === 'group' ? Group : (KIND_ICONS[row.el.kind] ?? Shapes)
              const label = row.type === 'group'
                ? (row.name || t('journey.studio.layers.group'))
                : layerLabel(row.el, t(`journey.studio.kind.${row.el.kind}`))
              const named = row.type === 'group' ? !!row.name : !!row.el.name
              const dragged = !!drag?.active && rowIds(row).every(id => drag.ids.includes(id))
              const dropAt = drag?.active && drag.overKey === row.key ? (drag.upper ? 'above' : 'below') : null
              const cls = ['st-layer', row.type === 'group' ? 'is-group' : '', row.type === 'element' && row.inGroup ? 'is-member' : '',
                isSel ? 'is-on' : '', inside ? 'is-inside' : '', hidden ? 'is-hidden' : '', dragged ? 'is-dragged' : '',
                dropAt ? `is-drop-${dropAt}` : ''].filter(Boolean).join(' ')
              const lockLabel = t(locked ? 'journey.studio.unlock' : 'journey.studio.lock')
              const hideLabel = t(hidden ? 'journey.studio.layers.show' : 'journey.studio.layers.hide')
              return (
                <div
                  key={row.key}
                  className={cls}
                  data-layer-key={row.key}
                  role="treeitem"
                  tabIndex={row.key === tabKey ? 0 : -1}
                  aria-level={row.type === 'element' && row.inGroup ? 2 : 1}
                  aria-selected={isSel}
                  aria-expanded={row.type === 'group' ? !isCollapsed : undefined}
                  onFocus={() => setFocusKey(row.key)}
                  onPointerDown={e => onPointerDown(e, row)}
                  onClick={e => choose(row, e.shiftKey || e.metaKey || e.ctrlKey)}
                >
                  {!readOnly && <GripVertical size={11} className="st-layer-grip" aria-hidden />}
                  {row.type === 'group' && (
                    <button type="button" className={`st-layer-caret ${isCollapsed ? '' : 'is-open'}`} tabIndex={-1}
                      onClick={e => { e.stopPropagation(); toggleCollapsed(row.groupId) }}
                      aria-label={t(isCollapsed ? 'journey.studio.layers.expand' : 'journey.studio.layers.collapse')}>
                      <ChevronRight size={11} />
                    </button>
                  )}
                  <Icon size={12} className="st-layer-icon" aria-hidden />
                  {renaming === row.key ? (
                    <RenameField label={label} named={named} t={t}
                      onCommit={v => commitName(row, v)}
                      onCancel={() => { setRenaming(null); focusRow(row.key) }} />
                  ) : (
                    <span className={`st-layer-name ${named ? '' : 'is-auto'}`} title={label}
                      onDoubleClick={e => { e.stopPropagation(); if (!readOnly) setRenaming(row.key) }}>
                      {label}
                    </span>
                  )}
                  {row.type === 'group' && <span className="st-layer-count">{row.members.length}</span>}
                  {!readOnly && (
                    <span className="st-layer-acts">
                      <button type="button" tabIndex={-1} className={`st-layer-act ${locked ? 'is-on' : ''}`} title={lockLabel} aria-label={lockLabel} aria-pressed={locked}
                        onClick={e => { e.stopPropagation(); setLocked(spreadIndex, rowIds(row), !locked) }}>
                        {locked ? <Lock size={11} /> : <Unlock size={11} />}
                      </button>
                      <button type="button" tabIndex={-1} className={`st-layer-act ${hidden ? 'is-on' : ''}`} title={hideLabel} aria-label={hideLabel} aria-pressed={hidden}
                        onClick={e => { e.stopPropagation(); setHidden(spreadIndex, rowIds(row), !hidden) }}>
                        {hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {!readOnly && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" className="st-layer-chip" disabled={!canGroup} onClick={() => group(spreadIndex)} title="Ctrl+G">
                <Group size={12} /> {t('journey.studio.layers.groupAction')}
              </button>
              <button type="button" className="st-layer-chip" disabled={!canUngroup} onClick={() => ungroup(spreadIndex)} title="Ctrl+Shift+G">
                <Ungroup size={12} /> {t('journey.studio.layers.ungroup')}
              </button>
            </div>
          )}
        </>
      )}
      <style>{`
        .st-layers { display: flex; flex-direction: column; gap: 1px; user-select: none; }
        .st-layer { position: relative; display: flex; align-items: center; gap: 5px; height: 26px; padding: 0 4px; border-radius: 6px; cursor: pointer; font-size: 11.5px; color: var(--text-secondary); border: 1px solid transparent; }
        .st-layer:hover { background: var(--bg-hover); }
        .st-layer:focus-visible { outline: 2px solid var(--text-primary); outline-offset: -2px; }
        .st-layer.is-on { background: var(--bg-tertiary); border-color: var(--border-primary); color: var(--text-primary); }
        .st-layer.is-inside { border-style: dashed; }
        .st-layer.is-member { padding-left: 22px; }
        .st-layer.is-group { font-weight: 600; }
        .st-layer.is-hidden .st-layer-name, .st-layer.is-hidden .st-layer-icon { opacity: 0.45; }
        .st-layer.is-dragged { opacity: 0.4; }
        .st-layer.is-drop-above::before, .st-layer.is-drop-below::after { content: ''; position: absolute; left: 4px; right: 4px; height: 2px; background: #2563eb; border-radius: 1px; }
        .st-layer.is-drop-above::before { top: -2px; }
        .st-layer.is-drop-below::after { bottom: -2px; }
        .st-layer-grip { color: var(--text-faint); flex-shrink: 0; cursor: grab; }
        .st-layer-icon { color: var(--text-muted); flex-shrink: 0; }
        .st-layer-caret { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; padding: 0; border: none; background: none; cursor: pointer; color: var(--text-faint); transition: transform 120ms; }
        .st-layer-caret.is-open { transform: rotate(90deg); }
        .st-layer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .st-layer-name.is-auto { color: var(--text-muted); }
        .st-layer-count { font-size: 10px; color: var(--text-faint); }
        .st-layer-acts { display: flex; gap: 1px; flex-shrink: 0; }
        .st-layer-act { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; border-radius: 4px; cursor: pointer; color: var(--text-faint); opacity: 0; }
        .st-layer:hover .st-layer-act, .st-layer:focus-within .st-layer-act, .st-layer-act.is-on { opacity: 1; }
        .st-layer-act.is-on { color: var(--text-primary); }
        .st-layer-act:hover { background: var(--bg-hover); color: var(--text-primary); }
        .st-layer-input { flex: 1; min-width: 0; height: 20px; padding: 0 4px; font-size: 11.5px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-card); color: var(--text-primary); font-family: inherit; }
        .st-layer-chip { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 5px 6px; font-size: 10.5px; border-radius: 6px; border: 1px solid var(--border-primary); background: none; cursor: pointer; color: var(--text-muted); font-family: inherit; }
        .st-layer-chip:hover:not(:disabled) { background: var(--bg-hover); }
        .st-layer-chip:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </div>
  )
}

function RenameField({ label, named, t, onCommit, onCancel }: {
  label: string
  named: boolean
  t: T
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  // Escape hands the focus back to the row, which blurs the field: that blur keeps nothing.
  const cancelled = useRef(false)
  return (
    <input
      className="st-layer-input"
      autoFocus
      defaultValue={named ? label : ''}
      placeholder={label}
      maxLength={60}
      aria-label={t('journey.studio.layers.rename')}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onBlur={e => { if (!cancelled.current) onCommit(e.target.value) }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); return }
        if (e.key !== 'Escape') return
        e.preventDefault()
        cancelled.current = true
        onCancel()
      }}
    />
  )
}

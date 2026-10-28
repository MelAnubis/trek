import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Group, Paintbrush, Pipette, Ungroup, type LucideIcon,
} from 'lucide-react'
import { useStudioStore } from '../../store/studioStore'
import { distributableCount, type BookAlignEdge, type BookAlignTo } from './bookArrange'
import { isWholeGroup } from './bookGroups'

/**
 * Arrange: where the selection sits among the other things on the page.
 * Ported from liketrek/TREK's StudioArrangeSection.tsx (same AGPLv3
 * license), restyled to this fork's inline-style inspector.
 *
 * Lining it up and spacing it out, what it lines up against, what lies in
 * front of what, grouping, and the style clipboard. The align row lines a
 * multi-selection up within its own box by default, and a single element (or
 * one whole group) against its page, since there is nothing else for it to
 * line up with. Groups move as one box throughout (bookArrange.ts). Every
 * press is one undo step.
 */

const ALIGN: { edge: BookAlignEdge; icon: LucideIcon; labelKey: string }[] = [
  { edge: 'left', icon: AlignStartVertical, labelKey: 'journey.studio.layers.alignLeft' },
  { edge: 'center', icon: AlignCenterVertical, labelKey: 'journey.studio.layers.alignCenter' },
  { edge: 'right', icon: AlignEndVertical, labelKey: 'journey.studio.layers.alignRight' },
  { edge: 'top', icon: AlignStartHorizontal, labelKey: 'journey.studio.layers.alignTop' },
  { edge: 'middle', icon: AlignCenterHorizontal, labelKey: 'journey.studio.layers.alignMiddle' },
  { edge: 'bottom', icon: AlignEndHorizontal, labelKey: 'journey.studio.layers.alignBottom' },
]

const STACK: { to: 'front' | 'up' | 'down' | 'back'; icon: LucideIcon; labelKey: string; keys: string }[] = [
  { to: 'front', icon: ChevronsUp, labelKey: 'journey.studio.toFront', keys: 'Ctrl+Shift+]' },
  { to: 'up', icon: ArrowUp, labelKey: 'journey.studio.forward', keys: 'Ctrl+]' },
  { to: 'down', icon: ArrowDown, labelKey: 'journey.studio.backward', keys: 'Ctrl+[' },
  { to: 'back', icon: ChevronsDown, labelKey: 'journey.studio.toBack', keys: 'Ctrl+Shift+[' },
]

const LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }

function IconButton({ label, icon: Icon, onClick, disabled, keys }: {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  keys?: string
}) {
  return (
    <button type="button" className="st-ar-btn" onClick={onClick} disabled={disabled} aria-label={label} title={keys ? `${label} (${keys})` : label}>
      <Icon size={14} />
    </button>
  )
}

export function StudioArrangeSection({ spreadIndex, t }: { spreadIndex: number; t: (k: string) => string }) {
  const spread = useStudioStore(s => s.doc?.spreads[spreadIndex])
  const selection = useStudioStore(s => s.selection)
  const hasStyle = useStudioStore(s => s.styleClip !== null)
  const align = useStudioStore(s => s.align)
  const distribute = useStudioStore(s => s.distribute)
  const raise = useStudioStore(s => s.raise)
  const group = useStudioStore(s => s.group)
  const ungroup = useStudioStore(s => s.ungroup)
  const copyStyle = useStudioStore(s => s.copyStyle)
  const pasteStyle = useStudioStore(s => s.pasteStyle)
  const chosenTo = useStudioStore(s => s.alignTo)
  const setChosenTo = useStudioStore(s => s.setAlignTo)

  if (!spread || !selection.length) return null
  const sel = spread.elements.filter(e => selection.includes(e.id))
  const movable = sel.filter(e => !e.locked)
  const units = distributableCount(spread, movable)
  // One thing has nothing to line up with but its page.
  const to: BookAlignTo = units < 2 ? (chosenTo === 'safe' ? 'safe' : 'page') : (chosenTo ?? 'selection')
  const grouped = sel.some(e => e.group)
  const canGroup = movable.length >= 2 && !isWholeGroup(spread, movable.map(e => e.id))
  const asGroup = selection.length > 1 && isWholeGroup(spread, selection)

  const seg = (on: boolean, disabled?: boolean): React.CSSProperties => ({
    flex: 1, padding: '4px 2px', fontSize: 10.5, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', borderRadius: 6,
    border: on ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
    background: on ? 'var(--bg-tertiary)' : 'none', color: 'var(--text-primary)', opacity: disabled ? 0.4 : 1,
  })

  return (
    <div data-testid="arrange-section" style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-secondary)' }}>
      <span style={{ ...LABEL, display: 'block', marginBottom: 6 }}>{t('journey.studio.layers.align')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 6 }}>
        {ALIGN.map(a => (
          <IconButton key={a.edge} label={t(a.labelKey)} icon={a.icon} disabled={!movable.length} onClick={() => align(spreadIndex, a.edge, to)} />
        ))}
        <span style={{ width: 1, background: 'var(--border-primary)', margin: '4px 2px' }} />
        <IconButton label={t('journey.studio.layers.distributeH')} icon={AlignHorizontalDistributeCenter} disabled={units < 3} onClick={() => distribute(spreadIndex, 'horizontal')} />
        <IconButton label={t('journey.studio.layers.distributeV')} icon={AlignVerticalDistributeCenter} disabled={units < 3} onClick={() => distribute(spreadIndex, 'vertical')} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }} role="radiogroup" aria-label={t('journey.studio.layers.alignTo')}>
        {([
          { value: 'selection' as const, label: t('journey.studio.layers.toSelection'), disabled: units < 2 },
          { value: 'page' as const, label: t('journey.studio.layers.toPage') },
          { value: 'safe' as const, label: t('journey.studio.layers.toSafe') },
        ]).map(o => (
          <button key={o.value} type="button" role="radio" aria-checked={to === o.value} disabled={o.disabled}
            onClick={() => setChosenTo(o.value)} style={seg(to === o.value, o.disabled)}>
            {o.label}
          </button>
        ))}
      </div>

      <span style={{ ...LABEL, display: 'block', marginBottom: 6 }}>{t('journey.studio.order')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 10 }}>
        {STACK.map(s => (
          <IconButton key={s.to} label={t(s.labelKey)} icon={s.icon} keys={s.keys} onClick={() => raise(spreadIndex, selection, s.to)} />
        ))}
        <span style={{ width: 1, background: 'var(--border-primary)', margin: '4px 2px' }} />
        {(canGroup || !grouped) && (
          <IconButton label={t('journey.studio.layers.groupAction')} icon={Group} disabled={!canGroup} keys="Ctrl+G" onClick={() => group(spreadIndex)} />
        )}
        {grouped && (
          <IconButton label={t('journey.studio.layers.ungroup')} icon={Ungroup} keys="Ctrl+Shift+G" onClick={() => ungroup(spreadIndex)} />
        )}
      </div>

      <span style={{ ...LABEL, display: 'block', marginBottom: 6 }}>{t('journey.studio.styleClip')}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" className="st-ar-chip" onClick={() => copyStyle(spreadIndex)} title="Ctrl+Alt+C">
          <Pipette size={12} /> {t('journey.studio.layers.copyStyle')}
        </button>
        <button type="button" className="st-ar-chip" disabled={!hasStyle || !movable.length} onClick={() => pasteStyle(spreadIndex)} title="Ctrl+Alt+V">
          <Paintbrush size={12} /> {t('journey.studio.layers.pasteStyle')}
        </button>
      </div>
      {asGroup && <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '8px 0 0', lineHeight: 1.4 }}>{t('journey.studio.layers.groupHint')}</p>}
      <style>{`
        .st-ar-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid transparent; background: none; border-radius: 6px; cursor: pointer; color: var(--text-muted); }
        .st-ar-btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-primary); }
        .st-ar-btn:disabled { opacity: 0.35; cursor: default; }
        .st-ar-chip { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 5px 6px; font-size: 10.5px; border-radius: 6px; border: 1px solid var(--border-primary); background: none; cursor: pointer; color: var(--text-muted); font-family: inherit; }
        .st-ar-chip:hover:not(:disabled) { background: var(--bg-hover); }
        .st-ar-chip:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </div>
  )
}

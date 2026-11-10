import { useState } from 'react'
import { GripVertical, ArrowUp, ArrowDown, Plus } from 'lucide-react'
import type { Day } from '../../types'

interface DayReorderPopupProps {
  days: Day[]
  t: (key: string, params?: Record<string, any>) => string
  locale: string
  onReorder: (orderedIds: number[]) => void
  onAddDay: () => void
  onClose: () => void
}

/**
 * Compact panel for moving whole days around: drag a row by its grip or use the
 * up/down arrows, and add a day at the end. Day headers stay untouched — this is
 * the single surface for ordering. Reorders are applied optimistically by the
 * store, so the list reflects each move immediately.
 */
export function DayReorderPopup({ days, t, locale, onReorder, onAddDay, onClose }: DayReorderPopupProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const ordered = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0))

  const label = (day: Day, index: number) => {
    if (day.title) return day.title
    if (day.date) {
      const d = new Date(day.date + 'T00:00:00')
      return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
    }
    return t('dayplan.dayN', { n: index + 1 })
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ordered.length || from === to) return
    const ids = ordered.map(d => d.id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    onReorder(ids)
  }

  const cellBtn = {
    display: 'grid', placeItems: 'center', width: 26, height: 26,
    border: '1px solid var(--border-faint)', borderRadius: 7,
    background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0,
  } as const

  return (
    <>
      {/* outside-click catcher */}
      <div className="!fixed !inset-[0] !z-[250]" onClick={onClose} />
      <div className="!absolute !top-[calc(100%_+_6px)] !right-[0] !z-[251] !w-[290px] !max-h-[360px] !flex !flex-col ![background:var(--bg-card,_white)] ![color:var(--text-primary)] ![border:1px_solid_var(--border-faint)] !rounded-[12px] ![box-shadow:0_12px_32px_rgba(0,0,0,0.18)] !overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="!flex !items-center !justify-between !gap-[8px] !p-[11px_12px_8px]">
          <span className="!text-[length:12.5px] !font-[600]">{t('dayplan.reorderTitle')}</span>
          <button
            onClick={onAddDay}
            className="bg-accent text-accent-text !flex !items-center !gap-[4px] !p-[4px_9px] !rounded-[7px] ![border:none] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit]"
          >
            <Plus size={13} strokeWidth={2} />
            {t('dayplan.addDay')}
          </button>
        </div>
        <div className="!p-[0_12px_8px] !text-[length:10.5px] ![color:var(--text-faint)] !leading-[1.35]">
          {t('dayplan.reorderHint')}
        </div>

        <div className="scroll-container !overflow-y-auto !p-[0_8px_8px] !min-h-[0]">
          {ordered.map((day, index) => (
            <div className="!flex !items-center !gap-[8px] !p-[6px_8px] !rounded-[8px] !mt-[2px]"
              key={day.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
              onDragOver={e => { e.preventDefault(); if (overIndex !== index) setOverIndex(index) }}
              onDrop={e => {
                e.preventDefault()
                if (dragIndex !== null && dragIndex !== index) move(dragIndex, index)
                setDragIndex(null); setOverIndex(null)
              }}
              style={{ background: overIndex === index && dragIndex !== null && dragIndex !== index ? 'var(--bg-hover)' : 'transparent', opacity: dragIndex === index ? 0.5 : 1, outline: overIndex === index && dragIndex !== null && dragIndex !== index ? '2px dashed var(--border-primary)' : 'none', outlineOffset: -2 }}
            >
              <GripVertical size={14} strokeWidth={1.8} style={{ cursor: 'grab', color: 'var(--text-faint)', flexShrink: 0 }} />
              <span className="!shrink-[0] !w-[22px] !h-[22px] !rounded-[50%] ![background:var(--bg-hover)] ![color:var(--text-muted)] !grid ![place-items:center] !text-[length:10.5px] !font-[700]">
                {index + 1}
              </span>
              <span className="!flex-[1] !min-w-[0] !text-[length:12.5px] !font-[500] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                {label(day, index)}
              </span>
              <button
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={t('dayplan.moveUp')}
                style={{ ...cellBtn, opacity: index === 0 ? 0.35 : 1, cursor: index === 0 ? 'default' : 'pointer' }}
              >
                <ArrowUp size={13} strokeWidth={2} />
              </button>
              <button
                onClick={() => move(index, index + 1)}
                disabled={index === ordered.length - 1}
                aria-label={t('dayplan.moveDown')}
                style={{ ...cellBtn, opacity: index === ordered.length - 1 ? 0.35 : 1, cursor: index === ordered.length - 1 ? 'default' : 'pointer' }}
              >
                <ArrowDown size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

import { FlipHorizontal2, RotateCcw, RotateCw } from 'lucide-react'
import type { BookElement, BookStickerElement } from '../../../types/book'
import { ColorSwatches } from '../StyleControls'
import { bookSticker, bookStickerSlotColor } from './catalogue'
import { stickerLabel, turned, withSlotColor } from './stickerLibrary'

/*
 * The inspector of a sticker (5.7.12, after liketrek/TREK's
 * StudioStickerInspector): its colours slot by slot, each offered with the
 * colour it shows now, back to its own colours in one click, and its mirror
 * and its turn.
 */

type T = (k: string, params?: Record<string, string | number>) => string
const LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 99, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

export function StickerInspector({ el, set, t }: { el: BookStickerElement; set: (p: Partial<BookElement>) => void; t: T }) {
  const def = bookSticker(el.stickerId)
  return (
    <div data-testid="sticker-inspector" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
      <span style={LABEL}>{t('journey.studio.stickerColours')}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{def ? stickerLabel(t, def.id) : t('journey.studio.stickerMissing')}</span>
      {def?.slots.map((slot, i) => (
        <div key={slot.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('journey.studio.stickerSlot', { index: i + 1 })}</span>
          <ColorSwatches value={bookStickerSlotColor(def.slots, el.colors, i)} onPick={color => set({ colors: withSlotColor(el, def.slots, i, color) } as Partial<BookElement>)}
            label={t('journey.studio.stickerSlot', { index: i + 1 })} t={t} />
        </div>
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {el.colors.length > 0 && <button type="button" style={BTN} onClick={() => set({ colors: [] } as Partial<BookElement>)}>{t('journey.studio.stickerResetColours')}</button>}
        <button type="button" style={BTN} aria-pressed={el.flipX} data-testid="sticker-flip" onClick={() => set({ flipX: !el.flipX } as Partial<BookElement>)}><FlipHorizontal2 size={13} />{t('journey.studio.stickerFlip')}</button>
        <button type="button" style={BTN} title={t('journey.studio.stickerTurnLeft')} aria-label={t('journey.studio.stickerTurnLeft')} onClick={() => set({ rotation: turned(el.rotation, -15) })}><RotateCcw size={13} /></button>
        <button type="button" style={BTN} title={t('journey.studio.stickerTurnRight')} aria-label={t('journey.studio.stickerTurnRight')} onClick={() => set({ rotation: turned(el.rotation, 15) })}><RotateCw size={13} /></button>
      </div>
    </div>
  )
}

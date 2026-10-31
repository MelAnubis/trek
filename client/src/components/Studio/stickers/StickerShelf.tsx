import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useStudioStore } from '../../../store/studioStore'
import { StickerArt } from '../StickerView'
import { bookStickersOf } from './catalogue'
import { BOOK_STICKER_THEMES, type BookStickerDef } from './sticker-types'
import { STICKER_DRAG_TYPE, matchStickers, newStickerElement, readRecentStickers, rememberSticker, stickerLabel, stickerThemeLabel } from './stickerLibrary'

/*
 * The sticker library, as the Pegatinas tab of Elementos (5.7.12, after
 * liketrek/TREK's StudioStickersPanel): illustrations grouped by theme,
 * searchable in the reader's language, the ones placed last on a shelf of
 * their own. A click places one in the middle of the page, a drag where it is
 * let go; either way it arrives selected, to be recoloured in the inspector.
 */

type T = (k: string, params?: Record<string, string | number>) => string

const LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '10px 0 6px' }

function Grid({ list, t, onPick }: { list: readonly BookStickerDef[]; t: T; onPick: (d: BookStickerDef) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
      {list.map(def => (
        <button key={def.id} type="button" draggable title={stickerLabel(t, def.id)} aria-label={stickerLabel(t, def.id)} data-sticker={def.id}
          onDragStart={e => { e.dataTransfer.setData(STICKER_DRAG_TYPE, def.id); e.dataTransfer.effectAllowed = 'copy' }}
          onClick={() => onPick(def)}
          style={{ aspectRatio: '1', padding: 5, borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'grab' }}>
          <StickerArt def={def} />
        </button>
      ))}
    </div>
  )
}

export function StickerShelf({ t }: { t: T }) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<BookStickerDef[]>(readRecentStickers)
  const addElement = useStudioStore(s => s.addElement)
  const select = useStudioStore(s => s.select)
  const active = useStudioStore(s => s.activeSpread)
  const page = useStudioStore(s => s.doc?.page)
  const role = useStudioStore(s => s.doc?.spreads[s.activeSpread]?.role)
  const matches = useMemo(() => matchStickers(query, t), [query, t])
  const browsing = !query.trim()
  if (!page) return null

  const place = (def: BookStickerDef) => {
    const el = newStickerElement(def, page, role !== undefined && role !== 'inner')
    addElement(active, el)
    select([el.id])
    setRecent(rememberSticker(def.id))
  }

  return (
    <div data-testid="sticker-shelf">
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)' }}>
        <Search size={13} color="var(--text-faint)" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('journey.studio.searchStickers')} aria-label={t('journey.studio.searchStickers')}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'none', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit' }} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="×" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}><X size={13} /></button>}
      </label>
      {browsing && recent.length > 0 && (<><div style={LABEL}>{t('journey.studio.stickersRecent')}</div><Grid list={recent} t={t} onPick={place} /></>)}
      {browsing
        ? BOOK_STICKER_THEMES.map(id => (
          <div key={id}><div style={LABEL}>{stickerThemeLabel(t, id)}</div><Grid list={bookStickersOf(id)} t={t} onPick={place} /></div>
        ))
        : (<div style={{ marginTop: 8 }}><Grid list={matches} t={t} onPick={place} />
          {!matches.length && <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.noMatches')}</p>}</div>)}
      <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: '10px 0 0', lineHeight: 1.4 }}>{t('journey.studio.stickersHint')}</p>
    </div>
  )
}

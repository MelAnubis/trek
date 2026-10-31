import { useMemo } from 'react'
import type { BookElement, BookPageSetup, BookSpread, BookTheme } from '../../../types/book'
import { useStudioStore } from '../../../store/studioStore'
import { useJourneyStore } from '../../../store/journeyStore'
import { elementId } from '../bookIds'
import { bookThemeColor } from '../bookTheme'
import { ElementView } from '../SpreadView'
import { firstFillPhoto } from '../text/textEffects'
import { BOOK_LOCKUPS } from './lockups.data'
import { addBookLockup, bookLockupBox, buildBookLockup, formatBookCoords, type BookLockup, type BookLockupPalette, type BookLockupWords } from './lockups'

/*
 * Composiciones de texto (5.7.12, after liketrek/TREK's StudioTextStyles):
 * the 24 lockups (a title with its date line, a postmark, a chapter mark, a
 * quote), each drawn with the book's own title the way it will print, placed
 * with one click as one group, selected, so the set moves as one.
 */

type T = (k: string, params?: Record<string, string | number>) => string

const MAX_SPREAD_ELEMENTS = 90
const MM = 96 / 25.4
const SAMPLE_POINT = { lat: 38.7139, lng: -9.1334 }

export const SHELF_GROUPS = [
  { id: 'titles', lockups: ['poster-stack', 'spaced-date', 'serif-sun', 'title-script-year', 'script-overlay', 'photo-word', 'fabric-band', 'arched-title', 'retro-shadow', 'outline-echo', 'minimal-caps'] },
  { id: 'badges', lockups: ['circle-badge', 'postmark', 'stamp', 'ticket'] },
  { id: 'chapters', lockups: ['chapter-outline', 'chapter-rules', 'day-opener'] },
  { id: 'quotes', lockups: ['quote-classic', 'quote-band', 'caption-rule', 'caption-number', 'coords-pin', 'coords-stack'] },
] as const

export const shelfLockups = (ids: readonly string[]): BookLockup[] => ids.flatMap(id => BOOK_LOCKUPS.filter(l => l.id === id))

export interface ShelfSource { entries: readonly { date: string | null; lat: number | null; lng: number | null }[] }

/** The words every lockup is filled with: the book's title, the year of its first dated stop, its first point, samples for the rest. */
export function shelfWords(title: string, source: ShelfSource, t: T, now: Date = new Date()): BookLockupWords {
  const dated = source.entries.find(e => e.date)?.date
  const point = source.entries.find(e => e.lat != null && e.lng != null)
  return {
    title: title.trim() || t('journey.studio.lockupWord.title'),
    subtitle: t('journey.studio.lockupWord.subtitle'),
    kicker: t('journey.studio.lockupWord.kicker'),
    overlay: t('journey.studio.lockupWord.overlay'),
    year: dated ? dated.slice(0, 4) : String(now.getFullYear()),
    place: t('journey.studio.lockupWord.place'),
    dates: t('journey.studio.lockupWord.dates'),
    quote: t('journey.studio.lockupWord.quote'),
    caption: t('journey.studio.lockupWord.caption'),
    number: '01',
    label: t('journey.studio.lockupWord.label'),
    coords: formatBookCoords(point?.lat ?? SAMPLE_POINT.lat, point?.lng ?? SAMPLE_POINT.lng),
  }
}

/** The book theme's ink, accent, paper and muted, when it has a theme. */
export function themePalette(theme: BookTheme | undefined): Partial<BookLockupPalette> {
  if (!theme) return {}
  return { ink: bookThemeColor(theme, 'ink'), accent: bookThemeColor(theme, 'accent'), paper: bookThemeColor(theme, 'paper'), muted: bookThemeColor(theme, 'muted') }
}

/** The elements one lockup becomes, centred on the page (the right-hand one of a spread), a photo word filled from that page. */
export function placeLockup(lockup: BookLockup, at: { page: BookPageSetup; spread: BookSpread | undefined; words: BookLockupWords; photos: readonly { photoId: number }[]; palette: Partial<BookLockupPalette>; newId: (p: string) => string }): BookElement[] {
  const single = !!at.spread && at.spread.role !== 'inner'
  const photoId = firstFillPhoto(at.spread, at.photos)
  return buildBookLockup(lockup, bookLockupBox(lockup, at.page, single), { words: at.words, palette: at.palette, photoId, newId: at.newId })
}

function Tile({ lockup, words, palette, photoId, label, onPick }: {
  lockup: BookLockup; words: BookLockupWords; palette: Partial<BookLockupPalette>; photoId: number | null; label: string; onPick: (l: BookLockup) => void
}) {
  const elements = useMemo(() => {
    let n = 0
    return buildBookLockup(lockup, { x: 0, y: 0, w: 100, h: lockup.height }, { words, palette, photoId, newId: p => `${p}-pv-${(n += 1)}` })
  }, [lockup, words, palette, photoId])
  const boxW = 98, boxH = 62
  const scale = Math.min((boxW * 0.86) / (100 * MM), (boxH * 0.8) / (lockup.height * MM))
  const dx = (boxW - 100 * MM * scale) / 2
  const dy = (boxH - lockup.height * MM * scale) / 2
  return (
    <button type="button" className="st-lockup" title={label} aria-label={label} data-lockup={lockup.id} onClick={() => onPick(lockup)}
      style={{ position: 'relative', width: '100%', height: boxH, overflow: 'hidden', padding: 0, borderRadius: 6, border: '1px solid var(--border-primary)', background: palette.paper ?? '#ffffff', cursor: 'pointer' }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, width: '100mm', height: `${lockup.height}mm`, transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin: 'top left' }}>
        {elements.map(el => <ElementView key={el.id} el={el} big={false} />)}
      </span>
    </button>
  )
}

export function LockupShelf({ t, photos }: { t: T; photos: readonly { photoId: number }[] }) {
  const title = useStudioStore(s => s.doc?.title ?? '')
  const page = useStudioStore(s => s.doc?.page)
  const theme = useStudioStore(s => s.doc?.theme)
  const active = useStudioStore(s => s.activeSpread)
  const spread = useStudioStore(s => s.doc?.spreads[s.activeSpread])
  const commit = useStudioStore(s => s.commit)
  const select = useStudioStore(s => s.select)
  const entries = useJourneyStore(s => s.current?.entries)
  const source = useMemo<ShelfSource>(() => ({
    entries: (entries ?? []).map(e => ({ date: e.entry_date ?? null, lat: e.location_lat ?? null, lng: e.location_lng ?? null })),
  }), [entries])
  const words = useMemo(() => shelfWords(title, source, t), [title, source, t])
  const palette = useMemo(() => themePalette(theme), [theme])
  const photoId = firstFillPhoto(spread, photos)
  if (!page) return null

  const place = (lockup: BookLockup) => {
    const els = placeLockup(lockup, { page, spread, words, photos, palette, newId: elementId })
    if (!els.length || !spread || spread.elements.length + els.length > MAX_SPREAD_ELEMENTS) return
    commit(d => ({ ...d, spreads: d.spreads.map((sp, i) => (i === active ? addBookLockup(sp, els, elementId('g')) : sp)) }))
    select(els.map(e => e.id))
  }

  return (
    <div data-testid="lockup-shelf">
      {SHELF_GROUPS.map(group => (
        <div key={group.id} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 6 }}>
            {t(`journey.studio.lockupGroup.${group.id}`)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {shelfLockups(group.lockups).map(l => (
              <Tile key={l.id} lockup={l} words={words} palette={palette} photoId={photoId} label={t(`journey.studio.lockup.${l.id}`)} onPick={place} />
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: 0, lineHeight: 1.4 }}>{t('journey.studio.textStylesHint')}</p>
    </div>
  )
}

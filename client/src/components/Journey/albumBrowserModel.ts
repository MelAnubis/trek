/**
 * Ordering and grouping for the photo-provider album browser (the "Albums"
 * tab of the Immich / Synology / OneDrive picker on a journey).
 *
 * The picker used to show every album as one horizontally scrolling row of
 * chips, which stops being usable around a dozen albums. This turns the list
 * into something you can scan: albums that match the journey's dates first,
 * then the rest grouped by year, newest first — or sorted by name or size —
 * with an accent-insensitive search on top.
 *
 * Kept free of React so the rules can be tested on their own.
 */

export interface PickerAlbum {
  id: string
  albumName?: string
  name?: string
  assetCount?: number
  /** Immich only (ISO datetime). Synology and OneDrive don't send dates. */
  startDate?: string | null
  endDate?: string | null
  /** Immich only: the asset to show as the album's cover. */
  albumThumbnailAssetId?: string | null
  shared?: boolean
  passphrase?: string
}

export type AlbumSort = 'recent' | 'name' | 'size'

export function albumTitle(a: PickerAlbum): string {
  return (a.albumName || a.name || '').trim()
}

/** Lower-case and strip accents, so "via" finds "Vía de la Plata". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * The year an album belongs to: its start date when the provider sends one,
 * otherwise a leading or standalone 19xx/20xx in its name ("2019 07 Danubio",
 * "Verano 2021"). Null when neither says.
 */
export function albumYear(a: PickerAlbum): number | null {
  if (a.startDate) {
    const y = Number(a.startDate.slice(0, 4))
    if (Number.isFinite(y) && y > 1900) return y
  }
  const m = albumTitle(a).match(/(?:^|[^\d])((?:19|20)\d{2})(?!\d)/)
  return m ? Number(m[1]) : null
}

/** A sortable key for "most recent": the start date, else year (+ month if the name has "YYYY MM"), else nothing. */
function recency(a: PickerAlbum): string {
  if (a.startDate) return a.startDate.slice(0, 10)
  const title = albumTitle(a)
  const ym = title.match(/((?:19|20)\d{2})[\s._-]+(0[1-9]|1[0-2])(?!\d)/)
  if (ym) return `${ym[1]}-${ym[2]}-01`
  const y = albumYear(a)
  return y ? `${y}-00-00` : ''
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null
const byName = (a: PickerAlbum, b: PickerAlbum) => collator ? collator.compare(albumTitle(a), albumTitle(b)) : albumTitle(a).localeCompare(albumTitle(b))

export function sortAlbums(albums: PickerAlbum[], sort: AlbumSort): PickerAlbum[] {
  const out = [...albums]
  if (sort === 'name') return out.sort(byName)
  if (sort === 'size') return out.sort((a, b) => (b.assetCount ?? 0) - (a.assetCount ?? 0) || byName(a, b))
  // Most recent first; undated albums go last, alphabetically.
  return out.sort((a, b) => {
    const ra = recency(a), rb = recency(b)
    if (ra && rb && ra !== rb) return rb.localeCompare(ra)
    if (!!ra !== !!rb) return ra ? -1 : 1
    return byName(a, b)
  })
}

export function filterAlbums(albums: PickerAlbum[], query: string): PickerAlbum[] {
  const q = fold(query.trim())
  if (!q) return albums
  const words = q.split(/\s+/)
  return albums.filter(a => {
    const t = fold(albumTitle(a))
    return words.every(w => t.includes(w))
  })
}

/**
 * Whether an album's own dates overlap the journey's range. Only Immich sends
 * album dates, so for the other providers nothing "matches" and the section
 * simply doesn't appear rather than guessing from names.
 */
export function overlapsRange(a: PickerAlbum, from: string, to: string): boolean {
  if (!from || !to || !a.startDate) return false
  const s = a.startDate.slice(0, 10)
  const e = (a.endDate || a.startDate).slice(0, 10)
  return s <= to && e >= from
}

export interface AlbumSection {
  /** 'trip' for the journey-dates section, a year as a string, or 'undated'. */
  key: string
  albums: PickerAlbum[]
}

/**
 * The sections the browser draws, in order. With `sort: 'recent'` albums are
 * grouped by year (newest first) after the trip-match section; sorting by name
 * or size is a flat list, since a year heading over an alphabetical run would
 * only scatter it. A search also flattens — you are looking for one album,
 * not browsing.
 */
export function albumSections(albums: PickerAlbum[], opts: { sort: AlbumSort; query: string; tripFrom: string; tripTo: string }): AlbumSection[] {
  const visible = sortAlbums(filterAlbums(albums, opts.query), opts.sort)
  if (visible.length === 0) return []
  const searching = !!opts.query.trim()

  const matches = searching ? [] : visible.filter(a => overlapsRange(a, opts.tripFrom, opts.tripTo))
  const sections: AlbumSection[] = []
  if (matches.length) sections.push({ key: 'trip', albums: matches })
  const rest = visible.filter(a => !matches.includes(a))

  if (opts.sort !== 'recent' || searching) {
    if (rest.length) sections.push({ key: 'all', albums: rest })
    return sections
  }

  const byYear = new Map<string, PickerAlbum[]>()
  for (const a of rest) {
    const y = albumYear(a)
    const k = y ? String(y) : 'undated'
    if (!byYear.has(k)) byYear.set(k, [])
    byYear.get(k)!.push(a)
  }
  const years = [...byYear.keys()].filter(k => k !== 'undated').sort((a, b) => Number(b) - Number(a))
  for (const y of years) sections.push({ key: y, albums: byYear.get(y)! })
  if (byYear.has('undated')) sections.push({ key: 'undated', albums: byYear.get('undated')! })
  return sections
}

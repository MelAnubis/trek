// Groups a photo picker's items by capture day — most recent day first, so
// the picker reads like a camera roll instead of an undated grid. Shared by
// Studio's photo panel and the journal entry editor's "Desde galería"
// picker, since both show the same journey gallery and should group it the
// same way.

interface DatedPhoto {
  taken_at?: string | null
  created_at?: number | null
}

/** Capture date if known, else the day the photo was added — same fallback the gallery's own sort uses server-side (COALESCE(taken_at, created_at)). */
function dayKeyOf(photo: DatedPhoto): string {
  if (photo.taken_at) return photo.taken_at.slice(0, 10)
  if (photo.created_at) return new Date(photo.created_at).toISOString().slice(0, 10)
  return ''
}

export interface PhotoDayGroup<T> {
  dayKey: string
  photos: T[]
}

/**
 * Most recent day first; within a day, the caller's own order is kept
 * (Array#sort is stable) — the gallery already arrives oldest-first, so a
 * day's own photos come out oldest-first too.
 */
export function groupPhotosByDay<T extends DatedPhoto>(photos: T[]): PhotoDayGroup<T>[] {
  const sorted = [...photos].sort((a, b) => dayKeyOf(b).localeCompare(dayKeyOf(a)))
  const groups: PhotoDayGroup<T>[] = []
  for (const photo of sorted) {
    const dayKey = dayKeyOf(photo)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) last.photos.push(photo)
    else groups.push({ dayKey, photos: [photo] })
  }
  return groups
}

/** "16 de septiembre de 2026" / "September 16, 2026" — a picker header, not the timeline's own weekday-first date format. */
export function formatPhotoDayHeader(dayKey: string, locale?: string): string {
  if (!dayKey) return ''
  return new Date(dayKey + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

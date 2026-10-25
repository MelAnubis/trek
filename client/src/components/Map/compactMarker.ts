import { useMemo } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { useTripStore } from '../../store/tripStore'

/** The small dot an unplanned place shows as when «Marcadores compactos» is on (TREK v5). */
export function compactMarkerHtml(color: string | null | undefined): string {
  return `<div style="width:14px;height:14px;border-radius:50%;background:${(color || '#6b7280').replace(/[^#a-zA-Z0-9(),. %]/g, '')};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);box-sizing:border-box"></div>`
}

/** The ids of places drawn compact: unplanned ones, while the setting is on. Null when it is off. */
export function useCompactUnplanned(): Set<number> | null {
  const on = useSettingsStore(s => s.settings.compact_unplanned) === true
  const assignments = useTripStore(s => s.assignments)
  const places = useTripStore(s => s.places)
  return useMemo(() => {
    if (!on) return null
    const planned = new Set<number>()
    Object.values(assignments || {}).forEach(list => list.forEach(a => { if (a.place?.id) planned.add(a.place.id) }))
    return new Set(places.filter(p => !planned.has(p.id)).map(p => p.id))
  }, [on, assignments, places])
}

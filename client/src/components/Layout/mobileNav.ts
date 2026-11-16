import { Bell, CalendarDays, Compass, Globe, Navigation, Palette, Plane, Radio, Route, Settings, type LucideIcon } from 'lucide-react'

/**
 * The phone's bottom bar: which destinations it shows and in what order,
 * from the `mobile_nav` setting (an ordered list of ids). The profile button
 * is always last and is not part of the list — it is how you reach
 * settings and sign out, so it can't be removed.
 *
 * Addon destinations only appear while the addon is enabled; an id that is
 * unknown or unavailable is skipped rather than drawn as a dead button.
 */

export interface MobileNavItem {
  id: string
  to: string
  icon: LucideIcon
  /** Translation key, or a literal label when `literal` is set. */
  labelKey: string
  /** Required global addon id, if any. `arte` is not an addon but a permission (see ARTE_NAV_ID). */
  addon?: string
}

/**
 * The illustrated-maps module is switched on by a permission (Admin →
 * Permissions → arte_use), not by an addon. Callers add this id to the
 * "enabled addons" list they pass in when the user has that permission.
 */
export const ARTE_NAV_ID = 'arte'

export const MOBILE_NAV_CATALOG: MobileNavItem[] = [
  { id: 'trips', to: '/dashboard', icon: Plane, labelKey: 'nav.myTrips' },
  { id: 'planner', to: '/planner', icon: Route, labelKey: 'nav.mobile.planner' },
  { id: 'journey', to: '/journey', icon: Compass, labelKey: 'admin.addons.catalog.journey.name', addon: 'journey' },
  { id: 'atlas', to: '/atlas', icon: Globe, labelKey: 'admin.addons.catalog.atlas.name', addon: 'atlas' },
  { id: 'vacay', to: '/vacay', icon: CalendarDays, labelKey: 'admin.addons.catalog.vacay.name', addon: 'vacay' },
  { id: 'arte', to: '/arte', icon: Palette, labelKey: 'arte.nav', addon: ARTE_NAV_ID },
  { id: 'navigate', to: '/navigate', icon: Navigation, labelKey: 'nav.mobile.navigate' },
  { id: 'tracking', to: '/tracking', icon: Radio, labelKey: 'tracking.title' },
  { id: 'notifications', to: '/notifications', icon: Bell, labelKey: 'nav.mobile.notifications' },
  { id: 'settings', to: '/settings', icon: Settings, labelKey: 'nav.bottomSettings' },
]

/** Five plus the profile button is as many as a phone's width holds with readable labels. */
export const MOBILE_NAV_MAX = 5

const BY_ID = new Map(MOBILE_NAV_CATALOG.map(i => [i.id, i]))

/**
 * The default bar: the places used on the road — trips, the route planner,
 * live tracking, the journey and turn-by-turn. Atlas and Vacay stay a choice
 * in Settings → Display. Someone who saved their own bar keeps it.
 */
export const DEFAULT_MOBILE_NAV = ['trips', 'planner', 'tracking', 'journey', 'navigate']

/** The destinations available to this user (addons that are on). */
export function availableNavItems(enabledAddons: string[]): MobileNavItem[] {
  const on = new Set(enabledAddons)
  return MOBILE_NAV_CATALOG.filter(i => !i.addon || on.has(i.addon))
}

/**
 * The bar to draw: the saved list (or the default) — known, available,
 * de-duplicated ids only, at most MOBILE_NAV_MAX. Never empty: with nothing
 * usable left, "my trips" stays so the bar always leads somewhere.
 */
export function resolveMobileNav(saved: unknown, enabledAddons: string[]): MobileNavItem[] {
  const avail = new Set(availableNavItems(enabledAddons).map(i => i.id))
  const ids = Array.isArray(saved) && saved.length ? saved : DEFAULT_MOBILE_NAV
  const out: MobileNavItem[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !avail.has(id) || out.some(o => o.id === id)) continue
    out.push(BY_ID.get(id)!)
    if (out.length >= MOBILE_NAV_MAX) break
  }
  return out.length ? out : [BY_ID.get('trips')!]
}

/** The list to store: ids only, known, unique, capped. */
export function normalizeMobileNav(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const id of ids) if (typeof id === 'string' && BY_ID.has(id) && !out.includes(id) && out.length < MOBILE_NAV_MAX) out.push(id)
  return out
}

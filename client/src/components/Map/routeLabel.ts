import type { RouteSegment } from '../../types'

const WALK = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M7 21l3-7"/><path d="M10 14l5-5"/><path d="M15 9l-4 7"/><path d="M18 18l-3-7"/></svg>'
const CAR = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2-4H7L5 10l-2.5 1.1C1.7 11.3 1 12.1 1 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>'
const BIKE = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>'

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/**
 * The travel-time pill between two stops, for Leaflet and GL alike: walking and
 * driving by default, or the time by bike when the day is routed for cycling (TREK v5).
 */
export function routeLabelInner(seg: Pick<RouteSegment, 'walkingText' | 'drivingText' | 'cyclingText'>, profile: 'default' | 'cycling' | undefined): string {
  const part = (icon: string, text: string) => `<span style="display:flex;align-items:center;gap:2px">${icon}${esc(text ?? '')}</span>`
  if (profile === 'cycling' && seg.cyclingText) return part(BIKE, seg.cyclingText)
  return `${part(WALK, seg.walkingText)}<span style="opacity:0.3">|</span>${part(CAR, seg.drivingText)}`
}

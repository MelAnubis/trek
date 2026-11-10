/**
 * Which trip tabs a phone shows in the bar and which go under «Más».
 * The first ones keep their place (the plan always first); the active tab is
 * always visible — when it lives in the overflow it takes the last visible slot,
 * so the bar never hides where you are.
 */
export function splitTripTabs<T extends { id: string }>(tabs: T[], activeId: string, maxVisible: number): { visible: T[]; overflow: T[] } {
  if (tabs.length <= maxVisible) return { visible: tabs, overflow: [] }
  // One slot goes to the «Más» button itself.
  const slots = Math.max(1, maxVisible - 1)
  let visible = tabs.slice(0, slots)
  if (!visible.some(t => t.id === activeId)) {
    const active = tabs.find(t => t.id === activeId)
    if (active) visible = [...visible.slice(0, slots - 1), active]
  }
  const shown = new Set(visible.map(t => t.id))
  return { visible, overflow: tabs.filter(t => !shown.has(t.id)) }
}

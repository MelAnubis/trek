/**
 * Day-note colours — the palette upstream liketrek/TREK settled on (#1629),
 * short on purpose so a colour means something: red "watch out", green
 * "done / booked", blue "information". Must match NOTE_COLORS in the
 * server's dayNoteService.ts, which refuses anything else.
 */
export const NOTE_COLORS = ['#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#9333ea'] as const

/** Names for the picker's labels — a screen reader should say "red", not a hex code. */
export const NOTE_COLOR_NAMES: Record<string, string> = {
  '#dc2626': 'red', '#ea580c': 'orange', '#d97706': 'amber', '#16a34a': 'green',
  '#0891b2': 'cyan', '#2563eb': 'blue', '#9333ea': 'purple',
}

export interface NoteSurface {
  background: string
  border: string
  iconBackground: string
  iconColor: string
}

const NEUTRAL: NoteSurface = {
  background: 'var(--bg-hover)',
  border: 'var(--border-faint)',
  iconBackground: 'var(--bg-hover)',
  iconColor: 'var(--text-muted)',
}

/** How a note card is tinted: a wash of its colour, a stronger edge, the icon in full colour. */
export function noteSurface(color: string | null | undefined): NoteSurface {
  if (!color || !(NOTE_COLORS as readonly string[]).includes(color.toLowerCase())) return NEUTRAL
  return {
    background: `color-mix(in srgb, ${color} 11%, transparent)`,
    border: `color-mix(in srgb, ${color} 38%, transparent)`,
    iconBackground: `color-mix(in srgb, ${color} 22%, transparent)`,
    iconColor: color,
  }
}

/**
 * Appearance: colour scheme, accent, transparency, density, text size and
 * motion — the per-user "look", stored as one JSON blob under the
 * `appearance` setting. A trimmed port of liketrek/TREK's appearance
 * feature (same AGPLv3 license); the rules kept from it:
 *
 * - DEFAULT_APPEARANCE is exactly today's look: the default scheme sets no
 *   attribute, every scale is 1 — a user who never opens the tab sees no
 *   change.
 * - normalizeAppearance never throws and lets nothing unchecked through: a
 *   bad blob (hand-edited, from an older version) can't reach the DOM.
 * - applyAppearance is the ONE place that writes it to the DOM, and it
 *   mirrors itself into localStorage so public/theme-boot.js can paint the
 *   right theme before React loads (no white flash in dark mode).
 *
 * Components never compute colours from this: they read CSS tokens
 * (--accent, --bg-hover…), and index.css redefines those per scheme.
 */

export const APPEARANCE_SCHEMES = ['default', 'mono', 'teal', 'green', 'rose', 'amber', 'violet', 'highContrast', 'custom'] as const
export type AppearanceScheme = (typeof APPEARANCE_SCHEMES)[number]

/** A representative swatch per scheme for the picker (light, dark). */
export const SCHEME_SWATCHES: Record<Exclude<AppearanceScheme, 'custom'>, [string, string]> = {
  default: ['#6366f1', '#818cf8'],
  mono: ['#111827', '#e4e4e7'],
  teal: ['#0d9488', '#14b8a6'],
  green: ['#16a34a', '#22c55e'],
  rose: ['#e11d48', '#f43f5e'],
  amber: ['#d97706', '#f59e0b'],
  violet: ['#7c3aed', '#8b5cf6'],
  highContrast: ['#1d4ed8', '#60a5fa'],
}

export const CUSTOM_ACCENT_PRESETS = ['#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#475569']

export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 1.4

export interface AppearanceConfig {
  scheme: AppearanceScheme
  /** #rrggbb, used only by the custom scheme. */
  accent: string | null
  transparency: boolean
  density: 'comfortable' | 'compact'
  /** Root text size multiplier (rem-based text follows it). */
  fontScale: number
  reduceMotion: boolean
}

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  scheme: 'default', accent: null, transparency: true, density: 'comfortable', fontScale: 1, reduceMotion: false,
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function expandHex(h: string): string {
  const c = h.slice(1).toLowerCase()
  return `#${c.length === 3 ? c.split('').map(x => x + x).join('') : c}`
}

export function normalizeAppearance(raw: unknown): AppearanceConfig {
  let v: Record<string, unknown> = {}
  if (typeof raw === 'string') { try { v = JSON.parse(raw) } catch { v = {} } }
  else if (raw && typeof raw === 'object') v = raw as Record<string, unknown>
  if (!v || typeof v !== 'object' || Array.isArray(v)) v = {}

  const scheme = (APPEARANCE_SCHEMES as readonly string[]).includes(v.scheme as string) ? v.scheme as AppearanceScheme : 'default'
  const accent = typeof v.accent === 'string' && HEX.test(v.accent) ? expandHex(v.accent) : null
  const fs = typeof v.fontScale === 'number' && Number.isFinite(v.fontScale) ? v.fontScale : 1
  return {
    // A custom scheme without a usable colour is just the default look.
    scheme: scheme === 'custom' && !accent ? 'default' : scheme,
    accent,
    transparency: v.transparency !== false,
    density: v.density === 'compact' ? 'compact' : 'comfortable',
    fontScale: Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, fs)) * 100) / 100,
    reduceMotion: v.reduceMotion === true,
  }
}

/** Near-black or white, whichever reads on this fill (WCAG relative luminance). */
export function accentTextFor(hex: string): string {
  const full = expandHex(hex).slice(1)
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
  const [r, g, b] = [0, 2, 4].map(i => lin(Number.parseInt(full.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111827' : '#ffffff'
}

export type DarkMode = boolean | string | undefined | null

export function resolveDark(mode: DarkMode, isShared = false): boolean {
  if (isShared) return false
  if (mode === 'auto') return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return mode === true || mode === 'dark'
}

export const APPEARANCE_SNAPSHOT_KEY = 'trek_appearance'

/**
 * Write the look to <html>. Idempotent; with DEFAULT_APPEARANCE it leaves
 * no attribute and no inline style behind. Shared/public pages force the
 * neutral light default whatever the viewer's own settings are.
 */
export function applyAppearance(input: { darkMode: DarkMode; appearance?: unknown; isSharedPage?: boolean }, root: HTMLElement = document.documentElement): AppearanceConfig {
  const cfg = normalizeAppearance(input.appearance)
  const shared = !!input.isSharedPage
  const eff: AppearanceConfig = shared ? DEFAULT_APPEARANCE : cfg
  const dark = resolveDark(input.darkMode, shared)

  root.classList.toggle('dark', dark)
  const attr = (name: string, on: boolean, value = '') => (on ? root.setAttribute(name, value) : root.removeAttribute(name))
  attr('data-scheme', eff.scheme !== 'default', eff.scheme)
  attr('data-no-transparency', !eff.transparency)
  attr('data-density', eff.density === 'compact', 'compact')
  attr('data-reduce-motion', eff.reduceMotion)

  if (eff.scheme === 'custom' && eff.accent) {
    root.style.setProperty('--accent-custom', eff.accent)
    root.style.setProperty('--accent-custom-text', accentTextFor(eff.accent))
  } else {
    root.style.removeProperty('--accent-custom')
    root.style.removeProperty('--accent-custom-text')
  }
  if (eff.fontScale === 1) root.style.removeProperty('font-size')
  else root.style.fontSize = `${eff.fontScale * 100}%`

  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]') : null
  if (meta) meta.setAttribute('content', dark ? '#09090b' : '#ffffff')

  if (!shared) {
    try {
      localStorage.setItem(APPEARANCE_SNAPSHOT_KEY, JSON.stringify({ v: 1, darkMode: input.darkMode ?? false, appearance: eff }))
    } catch { /* private mode: we only lose the flash-free first paint */ }
  }
  return cfg
}

/** On logout, so the next person on a shared browser doesn't flash the previous one's theme. */
export function clearAppearanceSnapshot(): void {
  try { localStorage.removeItem(APPEARANCE_SNAPSHOT_KEY) } catch { /* non-fatal */ }
}

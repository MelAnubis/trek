/**
 * Flag emoji from an ISO-3166-1 alpha-2 code — a regional-indicator pair,
 * computed rather than drawn.
 *
 * Upstream (flags.ts) rejects exactly this approach: Windows Chrome had no
 * flag glyphs at all and fell back to drawing the two bare letters, so it
 * ships a hand-built vector set (a few dozen "exact construction" flags,
 * `flags.ts`) plus a 305-line country-silhouette fallback (`countryShapes.ts`)
 * for the rest. That is real, licence-free correctness for every ISO code —
 * this fork takes the cheaper tradeoff instead: modern platforms (macOS,
 * iOS, Android, Linux, and Windows 11's Segoe UI Emoji since 2021) render
 * these correctly, and a country list still reads fine as plain names alone
 * on a platform that doesn't — `showFlag` on the countries/badge elements
 * can be switched off per book, so a missing glyph never has to carry the
 * whole design.
 */
export function flagEmoji(iso2: string): string {
  const code = iso2.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ''
  const REGIONAL_INDICATOR_A = 0x1f1e6
  return [...code].map(c => String.fromCodePoint(REGIONAL_INDICATOR_A + (c.charCodeAt(0) - 65))).join('')
}

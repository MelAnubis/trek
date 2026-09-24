/**
 * The book's typefaces, self-hosted via @fontsource rather than fetched
 * from Google Fonts' CDN — this app is meant to run fully self-hosted
 * (Docker/offline-capable deployments included), so a book whose print
 * export silently depends on an external CDN being reachable at export
 * time is a real reliability gap, not just a philosophical one. Each
 * import below is a side-effect CSS import: Vite bundles the @font-face
 * rules and the woff2 files themselves as fingerprinted static assets
 * into the app's own build, so printSheets.ts's collectStyles() (which
 * just clones every <style>/<link rel="stylesheet"> already on the page
 * into the print iframe) picks these up automatically, with nothing else
 * to wire up.
 *
 * `sans`, `serif` and `display` are the three original slots upstream
 * keeps for back-compat. `inter`/`garamond`/`playfair`/`bebas` are the
 * fuller font library's remaining four families, matching upstream's own
 * choices (Garamond -> EB Garamond, Playfair -> Playfair Display, Bebas ->
 * Bebas Neue — the closest @fontsource-published equivalents).
 */

import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/lora/400.css'
import '@fontsource/lora/500.css'
import '@fontsource/lora/600.css'
import '@fontsource/lora/700.css'
import '@fontsource/museomoderno/400.css'
import '@fontsource/museomoderno/500.css'
import '@fontsource/museomoderno/600.css'
import '@fontsource/museomoderno/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/500.css'
import '@fontsource/eb-garamond/600.css'
import '@fontsource/eb-garamond/700.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/500.css'
import '@fontsource/playfair-display/600.css'
import '@fontsource/playfair-display/700.css'
// Bebas Neue ships only weight 400 — an all-caps display face has no real
// use for a heavier cut, so 500-700 just fall back to the browser's own
// synthetic bold rather than a second font file that doesn't exist.
import '@fontsource/bebas-neue/400.css'

import type { BookFontFamily } from '../../types/book'

export const BOOK_FONTS: Record<BookFontFamily, { name: string; stack: string }> = {
  sans: { name: 'Poppins', stack: '"Poppins", system-ui, sans-serif' },
  serif: { name: 'Lora', stack: '"Lora", Georgia, serif' },
  display: { name: 'MuseoModerno', stack: '"MuseoModerno", "Poppins", system-ui, sans-serif' },
  inter: { name: 'Inter', stack: '"Inter", system-ui, sans-serif' },
  garamond: { name: 'EB Garamond', stack: '"EB Garamond", Garamond, Georgia, serif' },
  playfair: { name: 'Playfair Display', stack: '"Playfair Display", Georgia, serif' },
  bebas: { name: 'Bebas Neue', stack: '"Bebas Neue", "Poppins", system-ui, sans-serif' },
}

export const BOOK_FONT_ORDER: BookFontFamily[] = ['sans', 'serif', 'display', 'inter', 'garamond', 'playfair', 'bebas']

/** Falls back to Poppins rather than a generic, so the renderer always has *something* bundled. */
export function fontStack(id: string): string {
  return BOOK_FONTS[id as BookFontFamily]?.stack ?? BOOK_FONTS.sans.stack
}

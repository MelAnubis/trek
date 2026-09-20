import type { BookPageSetup } from '../../types/book'

/**
 * The book's own page presets, as concrete dimensions — kept next to
 * `bookPageSetupSchema`'s enum (server/src/services/journeyBook/bookSchema.ts)
 * rather than duplicated inline, since a new book's "Create" flow and any
 * future page-size picker both need the same numbers.
 *
 * `custom` isn't listed here — its width/height/bleed come from whatever the
 * caller types in, not a fixed table entry.
 */
export const PAGE_PRESETS: Record<Exclude<BookPageSetup['preset'], 'custom'>, { pageWidth: number; pageHeight: number; bleed: number; labelKey: string }> = {
  'square-210': { pageWidth: 210, pageHeight: 210, bleed: 3, labelKey: 'journey.studio.pagePreset.square210' },
  'square-300': { pageWidth: 300, pageHeight: 300, bleed: 3, labelKey: 'journey.studio.pagePreset.square300' },
  'a4-portrait': { pageWidth: 210, pageHeight: 297, bleed: 3, labelKey: 'journey.studio.pagePreset.a4Portrait' },
  'a4-landscape': { pageWidth: 297, pageHeight: 210, bleed: 3, labelKey: 'journey.studio.pagePreset.a4Landscape' },
  'a5-landscape': { pageWidth: 210, pageHeight: 148, bleed: 3, labelKey: 'journey.studio.pagePreset.a5Landscape' },
}

/** Build a full page setup from a preset id, or from explicit custom dimensions. */
export function pageSetupFor(preset: BookPageSetup['preset'], custom?: { pageWidth: number; pageHeight: number; bleed: number }): BookPageSetup {
  if (preset === 'custom') {
    const c = custom ?? { pageWidth: 210, pageHeight: 210, bleed: 3 }
    return { preset, pageWidth: c.pageWidth, pageHeight: c.pageHeight, bleed: c.bleed, safe: 5 }
  }
  const p = PAGE_PRESETS[preset]
  return { preset, pageWidth: p.pageWidth, pageHeight: p.pageHeight, bleed: p.bleed, safe: 5 }
}

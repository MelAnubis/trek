/**
 * The book's typefaces — Phase 1 subset (just the three original slots
 * upstream keeps for back-compat). The extra named families (Inter,
 * Garamond, Playfair, Bebas) and self-hosted @fontsource faces arrive with
 * the fuller font library in a later phase; for now these load from Google
 * Fonts, the same way JourneyBookPDF.tsx already loads Inter for the fixed
 * PDF export.
 */

import type { BookFontFamily } from '../../types/book';

export const BOOK_FONTS: Record<BookFontFamily, { name: string; stack: string }> = {
  sans: { name: 'Poppins', stack: '"Poppins", system-ui, sans-serif' },
  serif: { name: 'Lora', stack: '"Lora", Georgia, serif' },
  display: { name: 'MuseoModerno', stack: '"MuseoModerno", "Poppins", system-ui, sans-serif' },
};

export const BOOK_FONT_ORDER: BookFontFamily[] = ['sans', 'serif', 'display'];

export const BOOK_FONTS_GOOGLE_HREF =
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=MuseoModerno:wght@400;500;600;700&display=swap';

/** Falls back to Poppins rather than a generic, so the renderer always has *something* bundled. */
export function fontStack(id: string): string {
  return BOOK_FONTS[id as BookFontFamily]?.stack ?? BOOK_FONTS.sans.stack;
}

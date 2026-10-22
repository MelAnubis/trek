// FE-NOTECOLORS-001 to FE-NOTECOLORS-002
import { NOTE_COLORS, NOTE_COLOR_NAMES, noteSurface } from './noteColors'

describe('noteColors', () => {
  it('FE-NOTECOLORS-001: every palette colour has a name for its label', () => {
    for (const c of NOTE_COLORS) expect(NOTE_COLOR_NAMES[c]).toBeTruthy()
  })

  it('FE-NOTECOLORS-002: a palette colour tints the card; none or an unknown value keeps the neutral card', () => {
    expect(noteSurface('#dc2626').iconColor).toBe('#dc2626')
    expect(noteSurface('#DC2626').background).toContain('color-mix')
    expect(noteSurface(null).background).toBe('var(--bg-hover)')
    expect(noteSurface('red; background:url(x)').background).toBe('var(--bg-hover)')
  })
})

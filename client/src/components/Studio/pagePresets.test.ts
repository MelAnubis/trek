// FE-PAGEPRESETS-001 to FE-PAGEPRESETS-004
import { PAGE_PRESETS, pageSetupFor } from './pagePresets'

describe('pageSetupFor', () => {
  it('FE-PAGEPRESETS-001: a named preset resolves to its table dimensions', () => {
    const setup = pageSetupFor('a4-portrait')
    expect(setup).toEqual({ preset: 'a4-portrait', pageWidth: 210, pageHeight: 297, bleed: 3, safe: 5 })
  })

  it('FE-PAGEPRESETS-002: custom uses the given dimensions, not a table lookup', () => {
    const setup = pageSetupFor('custom', { pageWidth: 203.2, pageHeight: 254, bleed: 3.18 })
    expect(setup).toEqual({ preset: 'custom', pageWidth: 203.2, pageHeight: 254, bleed: 3.18, safe: 5 })
  })

  it('FE-PAGEPRESETS-003: custom with no dimensions given falls back to a sane default rather than throwing', () => {
    const setup = pageSetupFor('custom')
    expect(setup.pageWidth).toBeGreaterThan(0)
    expect(setup.pageHeight).toBeGreaterThan(0)
  })

  it('FE-PAGEPRESETS-004: every named preset has a positive width and height', () => {
    for (const key of Object.keys(PAGE_PRESETS) as (keyof typeof PAGE_PRESETS)[]) {
      expect(PAGE_PRESETS[key].pageWidth).toBeGreaterThan(0)
      expect(PAGE_PRESETS[key].pageHeight).toBeGreaterThan(0)
    }
  })
})

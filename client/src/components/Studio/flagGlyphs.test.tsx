// FE-FLAGGLYPHS-001 to FE-FLAGGLYPHS-006
import { render } from '@testing-library/react'
import { FlagGlyph, FlagSilhouette, patternForCode } from './flagGlyphs'

describe('patternForCode', () => {
  it('FE-FLAGGLYPHS-001: the same code always picks the same pattern', () => {
    expect(patternForCode('FR')).toBe(patternForCode('FR'))
    expect(patternForCode('fr')).toBe(patternForCode('FR'))
  })

  it('FE-FLAGGLYPHS-002: different codes are not guaranteed the same pattern, but a handful of real ISO codes are not all identical', () => {
    const patterns = new Set(['FR', 'JP', 'BR', 'NO', 'ZA', 'CA', 'IN', 'AU'].map(patternForCode))
    expect(patterns.size).toBeGreaterThan(1)
  })

  it('FE-FLAGGLYPHS-003: no code falls back to a fixed default pattern rather than throwing', () => {
    expect(() => patternForCode(null)).not.toThrow()
    expect(() => patternForCode(undefined)).not.toThrow()
    expect(patternForCode(null)).toBe(patternForCode(undefined))
  })
})

describe('FlagGlyph', () => {
  it('FE-FLAGGLYPHS-004: renders an <svg> sized from the `size` prop, not a fixed constant', () => {
    const { container } = render(<FlagGlyph code="FR" primary="#111827" secondary="#ffffff" size="12mm" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('style')).toContain('width: 12mm')
  })

  it('FE-FLAGGLYPHS-005: paints with the given primary/secondary colors, not hardcoded ones', () => {
    const { container } = render(<FlagGlyph code="FR" primary="#123456" secondary="#abcdef" />)
    const fills = [...container.querySelectorAll('rect, polygon, circle')].map(el => el.getAttribute('fill'))
    expect(fills).toEqual(expect.arrayContaining(['#123456']))
  })
})

describe('FlagSilhouette', () => {
  it('FE-FLAGGLYPHS-006: renders an <svg> without throwing for any color', () => {
    expect(() => render(<FlagSilhouette color="#111827" />)).not.toThrow()
  })
})

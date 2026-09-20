// FE-ENTRYTEXT-001 to FE-ENTRYTEXT-006
import { formatBookCoords, formatBookDate } from './entryText'

describe('formatBookCoords', () => {
  it('FE-ENTRYTEXT-001: dms format (the default) renders degrees/minutes/seconds with a hemisphere letter, no minus sign', () => {
    const s = formatBookCoords(-33.8688, 151.2093)
    expect(s).not.toContain('-')
    expect(s).toContain('S')
    expect(s).toContain('E')
  })

  it('FE-ENTRYTEXT-002: decimal format keeps 4 places and a hemisphere letter', () => {
    const s = formatBookCoords(-33.8688, 151.2093, 'decimal')
    expect(s).toBe('33.8688° S  151.2093° E')
  })

  it('FE-ENTRYTEXT-003: a positive latitude/longitude gets N/E', () => {
    const s = formatBookCoords(64.1466, -21.9426, 'decimal')
    expect(s).toContain('N')
    expect(s).toContain('W')
  })
})

describe('formatBookDate', () => {
  it('FE-ENTRYTEXT-004: a null ISO date returns an empty string rather than throwing', () => {
    expect(formatBookDate(null, 'en')).toBe('')
  })

  it('FE-ENTRYTEXT-005: an invalid ISO date returns an empty string', () => {
    expect(formatBookDate('not-a-date', 'en')).toBe('')
  })

  it('FE-ENTRYTEXT-006: a valid ISO date is spelled out with the full year, in the given locale', () => {
    const s = formatBookDate('2026-05-28', 'en')
    expect(s).toContain('2026')
    expect(s).toContain('May')
  })
})

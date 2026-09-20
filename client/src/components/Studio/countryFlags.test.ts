// FE-COUNTRYFLAGS-001 to FE-COUNTRYFLAGS-004
import { flagEmoji } from './countryFlags'

describe('flagEmoji', () => {
  it('FE-COUNTRYFLAGS-001: a valid ISO-3166-1 alpha-2 code yields the matching regional-indicator pair', () => {
    expect(flagEmoji('IS')).toBe('\u{1F1EE}\u{1F1F8}')
    expect(flagEmoji('FR')).toBe('\u{1F1EB}\u{1F1F7}')
  })

  it('FE-COUNTRYFLAGS-002: lower-case input is normalised the same as upper-case', () => {
    expect(flagEmoji('is')).toBe(flagEmoji('IS'))
  })

  it('FE-COUNTRYFLAGS-003: anything that isn\'t exactly two letters returns an empty string rather than garbage codepoints', () => {
    expect(flagEmoji('ISL')).toBe('')
    expect(flagEmoji('1')).toBe('')
    expect(flagEmoji('')).toBe('')
  })

  it('FE-COUNTRYFLAGS-004: surrounding whitespace is trimmed', () => {
    expect(flagEmoji(' IS ')).toBe(flagEmoji('IS'))
  })
})

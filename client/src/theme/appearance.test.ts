// FE-APPEARANCE-001 to FE-APPEARANCE-006
import { applyAppearance, accentTextFor, normalizeAppearance, DEFAULT_APPEARANCE, APPEARANCE_SNAPSHOT_KEY, clearAppearanceSnapshot } from './appearance'

const root = () => document.documentElement

beforeEach(() => {
  root().className = ''
  for (const a of ['data-scheme', 'data-no-transparency', 'data-density', 'data-reduce-motion', 'style']) root().removeAttribute(a)
  localStorage.clear()
})

describe('normalizeAppearance', () => {
  it('FE-APPEARANCE-001: nothing, garbage or unknown fields come out as the default look', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance('{not json')).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance([1, 2])).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({ scheme: 'neon', fontScale: 'big', evil: 1 })).toEqual(DEFAULT_APPEARANCE)
  })

  it('FE-APPEARANCE-002: values are clamped and checked; a custom scheme needs a real colour', () => {
    expect(normalizeAppearance({ fontScale: 5 }).fontScale).toBe(1.4)
    expect(normalizeAppearance({ fontScale: 0.1 }).fontScale).toBe(0.85)
    expect(normalizeAppearance({ scheme: 'custom', accent: '#abc' })).toMatchObject({ scheme: 'custom', accent: '#aabbcc' })
    expect(normalizeAppearance({ scheme: 'custom', accent: 'url(x)' }).scheme).toBe('default')
  })
})

describe('applyAppearance', () => {
  it('FE-APPEARANCE-003: the default look leaves no attribute or inline style behind', () => {
    applyAppearance({ darkMode: 'light', appearance: { scheme: 'rose', fontScale: 1.2, density: 'compact' } })
    applyAppearance({ darkMode: 'light', appearance: undefined })
    expect(root().getAttribute('data-scheme')).toBeNull()
    expect(root().getAttribute('data-density')).toBeNull()
    expect(root().style.fontSize).toBe('')
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('FE-APPEARANCE-004: a full look is written to <html> and snapshotted for the first paint', () => {
    applyAppearance({ darkMode: 'dark', appearance: { scheme: 'custom', accent: '#fde047', fontScale: 1.2, density: 'compact', transparency: false, reduceMotion: true } })
    expect(root().classList.contains('dark')).toBe(true)
    expect(root().getAttribute('data-scheme')).toBe('custom')
    expect(root().style.getPropertyValue('--accent-custom')).toBe('#fde047')
    // A pale yellow accent gets dark text on it.
    expect(root().style.getPropertyValue('--accent-custom-text')).toBe('#111827')
    expect(root().style.fontSize).toBe('120%')
    expect(root().hasAttribute('data-no-transparency')).toBe(true)
    expect(root().getAttribute('data-density')).toBe('compact')
    expect(root().hasAttribute('data-reduce-motion')).toBe(true)
    expect(JSON.parse(localStorage.getItem(APPEARANCE_SNAPSHOT_KEY)!)).toMatchObject({ v: 1, darkMode: 'dark', appearance: { scheme: 'custom' } })
    clearAppearanceSnapshot()
    expect(localStorage.getItem(APPEARANCE_SNAPSHOT_KEY)).toBeNull()
  })

  it('FE-APPEARANCE-005: a shared page shows the neutral light default and does not overwrite the snapshot', () => {
    applyAppearance({ darkMode: 'dark', appearance: { scheme: 'teal' } })
    const before = localStorage.getItem(APPEARANCE_SNAPSHOT_KEY)
    applyAppearance({ darkMode: 'dark', appearance: { scheme: 'teal', fontScale: 1.3 }, isSharedPage: true })
    expect(root().classList.contains('dark')).toBe(false)
    expect(root().getAttribute('data-scheme')).toBeNull()
    expect(root().style.fontSize).toBe('')
    expect(localStorage.getItem(APPEARANCE_SNAPSHOT_KEY)).toBe(before)
  })

  it('FE-APPEARANCE-006: accent text is white on dark fills and near-black on light ones', () => {
    expect(accentTextFor('#1d4ed8')).toBe('#ffffff')
    expect(accentTextFor('#facc15')).toBe('#111827')
  })
})

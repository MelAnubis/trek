// FE-PASTEDIMAGE-001 to FE-PASTEDIMAGE-005
import { fitImageFrame } from './pastedImage'

const PAGE = { pageWidth: 210, pageHeight: 210 }

describe('fitImageFrame', () => {
  it('FE-PASTEDIMAGE-001: a square image gets a square frame', () => {
    const { w, h } = fitImageFrame(1000, 1000, PAGE)
    expect(w).toBe(h)
  })

  it('FE-PASTEDIMAGE-002: a landscape image keeps its aspect ratio', () => {
    const { w, h } = fitImageFrame(2000, 1000, PAGE)
    expect(w / h).toBeCloseTo(2, 1)
  })

  it('FE-PASTEDIMAGE-003: a portrait image keeps its aspect ratio', () => {
    const { w, h } = fitImageFrame(1000, 2000, PAGE)
    expect(h / w).toBeCloseTo(2, 1)
  })

  it('FE-PASTEDIMAGE-004: never exceeds 90% of the page in either dimension, even for an extreme aspect ratio', () => {
    const { w, h } = fitImageFrame(5000, 100, PAGE)
    expect(w).toBeLessThanOrEqual(PAGE.pageWidth * 0.9 + 0.01)
    expect(h).toBeLessThanOrEqual(PAGE.pageHeight * 0.9 + 0.01)
  })

  it('FE-PASTEDIMAGE-005: a zero or missing natural size falls back to a square frame rather than NaN/Infinity', () => {
    const { w, h } = fitImageFrame(0, 0, PAGE)
    expect(Number.isFinite(w)).toBe(true)
    expect(Number.isFinite(h)).toBe(true)
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
  })
})

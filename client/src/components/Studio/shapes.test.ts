// FE-SHAPES-001 to FE-SHAPES-010
import { SHAPE_PATHS, SHAPE_GROUPS, FRAME_SHAPES, HOLED_SHAPES, scalePath, unitPath } from './shapes'
import { BOOK_SHAPES } from '../../types/book'

describe('SHAPE_PATHS', () => {
  it('FE-SHAPES-001: every BookShapeId has a path', () => {
    for (const id of BOOK_SHAPES) {
      expect(SHAPE_PATHS[id], id).toBeTruthy()
      expect(typeof SHAPE_PATHS[id]).toBe('string')
    }
  })

  it('FE-SHAPES-002: every path starts with M and ends with Z (a single or multi-subpath closed outline)', () => {
    for (const [id, path] of Object.entries(SHAPE_PATHS)) {
      expect(path.startsWith('M'), id).toBe(true)
      expect(path.endsWith('Z'), id).toBe(true)
    }
  })

  it('FE-SHAPES-003: every path uses only the documented command subset (M L C Q Z, no arcs or relative commands)', () => {
    const allowed = /^[MLCQZ\d\s.-]*$/
    for (const [id, path] of Object.entries(SHAPE_PATHS)) {
      expect(allowed.test(path), `${id}: ${path}`).toBe(true)
    }
  })

  it('FE-SHAPES-004: normalisation fills the 0..100 box — every path\'s numeric extent spans close to 0 and 100 on at least one axis', () => {
    for (const [id, path] of Object.entries(SHAPE_PATHS)) {
      const nums = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number)
      const xs = nums.filter((_, i) => i % 2 === 0)
      const ys = nums.filter((_, i) => i % 2 === 1)
      const spansX = Math.max(...xs) - Math.min(...xs)
      const spansY = Math.max(...ys) - Math.min(...ys)
      // At least one axis should reach close to the full 100-unit box (a line, for instance, has zero height).
      expect(Math.max(spansX, spansY), id).toBeGreaterThan(90)
    }
  })
})

describe('scalePath', () => {
  it('FE-SHAPES-005: scales a simple path\'s numbers by the given width/height independently', () => {
    const scaled = scalePath('M0 0L100 0L100 100L0 100Z', 50, 20)
    expect(scaled).toBe('M0 0L50 0L50 20L0 20Z')
  })

  it('FE-SHAPES-006: negative coordinates (some organic shapes dip below 0) scale the same way', () => {
    const scaled = scalePath('M-10 50L110 50Z', 10, 10)
    expect(scaled).toBe('M-1 5L11 5Z')
  })
})

describe('unitPath', () => {
  it('FE-SHAPES-007: converts 0..100 coordinates to 0..1 fractions for objectBoundingBox clip-paths', () => {
    const unit = unitPath('M0 0L100 0L100 100L0 100Z')
    expect(unit).toBe('M0 0L1 0L1 1L0 1Z')
  })
})

describe('SHAPE_GROUPS / FRAME_SHAPES / HOLED_SHAPES', () => {
  it('FE-SHAPES-008: every shape in every group is a real, defined shape id', () => {
    for (const group of SHAPE_GROUPS) {
      for (const id of group.shapes) {
        expect(SHAPE_PATHS[id], `${group.id}: ${id}`).toBeTruthy()
      }
    }
  })

  it('FE-SHAPES-009: FRAME_SHAPES are all real shape ids, and rect is among them (the default mask-free frame)', () => {
    for (const id of FRAME_SHAPES) expect(SHAPE_PATHS[id], id).toBeTruthy()
    expect(FRAME_SHAPES).toContain('rect')
  })

  it('FE-SHAPES-010: HOLED_SHAPES only names shapes that actually exist', () => {
    for (const id of HOLED_SHAPES) expect(SHAPE_PATHS[id], id).toBeTruthy()
  })
})

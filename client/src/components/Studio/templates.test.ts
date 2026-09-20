// FE-TEMPLATES-001 to FE-TEMPLATES-004
import { TEMPLATES, COVER_TEMPLATES } from './templates'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

describe('TEMPLATES + COVER_TEMPLATES — structural invariants', () => {
  it('FE-TEMPLATES-001: every frame has finite, positive width and height, and finite x/y', () => {
    for (const tpl of [...TEMPLATES, ...COVER_TEMPLATES]) {
      const slots = tpl.build(PAGE)
      for (const slot of slots) {
        expect(Number.isFinite(slot.frame.x), `${tpl.id}: x`).toBe(true)
        expect(Number.isFinite(slot.frame.y), `${tpl.id}: y`).toBe(true)
        expect(slot.frame.w, `${tpl.id}: w`).toBeGreaterThan(0)
        expect(slot.frame.h, `${tpl.id}: h`).toBeGreaterThan(0)
      }
    }
  })

  it('FE-TEMPLATES-002: photoSlots matches the number of photo-kind slots build() actually produces', () => {
    for (const tpl of [...TEMPLATES, ...COVER_TEMPLATES]) {
      const slots = tpl.build(PAGE)
      const photoCount = slots.filter(s => s.kind === 'photo').length
      expect(photoCount, tpl.id).toBe(tpl.photoSlots)
    }
  })

  it('FE-TEMPLATES-003: template ids are unique within each set', () => {
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length)
    expect(new Set(COVER_TEMPLATES.map(t => t.id)).size).toBe(COVER_TEMPLATES.length)
  })

  it('FE-TEMPLATES-004: a text-only template (photoSlots 0) still has at least one heading or body slot to hold content', () => {
    for (const tpl of TEMPLATES.filter(t => t.photoSlots === 0)) {
      const slots = tpl.build(PAGE)
      expect(slots.some(s => s.kind === 'heading' || s.kind === 'body'), tpl.id).toBe(true)
    }
  })
})

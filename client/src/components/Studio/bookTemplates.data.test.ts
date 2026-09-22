// FE-BOOKTPLDATA-001 to FE-BOOKTPLDATA-007
import { SPREAD_TEMPLATES } from './bookTemplates.data'

const SUPPORTED_KINDS = new Set(['photo', 'text', 'shape', 'stats', 'places', 'badge', 'icon', 'list', 'map', 'image'])

describe('SPREAD_TEMPLATES — structural invariants', () => {
  it('FE-BOOKTPLDATA-001: ships all six of upstream\'s reference templates', () => {
    expect(SPREAD_TEMPLATES).toHaveLength(6)
  })

  it('FE-BOOKTPLDATA-002: template ids are unique', () => {
    expect(new Set(SPREAD_TEMPLATES.map(t => t.id)).size).toBe(SPREAD_TEMPLATES.length)
  })

  it('FE-BOOKTPLDATA-003: every element is a kind this fork\'s schema actually supports', () => {
    for (const t of SPREAD_TEMPLATES) {
      for (const el of t.elements) {
        expect(SUPPORTED_KINDS.has(el.kind), `${t.id}: ${el.kind}`).toBe(true)
      }
    }
  })

  it('FE-BOOKTPLDATA-004: element ids are unique within each template, and every frame has a positive width/height', () => {
    for (const t of SPREAD_TEMPLATES) {
      const ids = t.elements.map(el => el.id)
      expect(new Set(ids).size, t.id).toBe(ids.length)
      for (const el of t.elements) {
        expect(el.frame.w, `${t.id}/${el.id}: w`).toBeGreaterThan(0)
        expect(el.frame.h, `${t.id}/${el.id}: h`).toBeGreaterThan(0)
      }
    }
  })

  it('FE-BOOKTPLDATA-005: no element carries a field this fork\'s BookElement type doesn\'t have (textScale/weight/stale off travel elements, autoColor/iconColor/etc off badges) — see the file\'s own header on why those were stripped', () => {
    const forbidden = ['textScale', 'stale', 'autoColor', 'autoIconColor', 'iconColor', 'showIcon', 'showLabel', 'showOutline']
    for (const t of SPREAD_TEMPLATES) {
      for (const el of t.elements) {
        for (const key of forbidden) {
          expect(key in el, `${t.id}/${el.id} has ${key}`).toBe(false)
        }
        // `weight` is legitimate on a text element (its own font weight) but not on any other kind.
        if (el.kind !== 'text') expect('weight' in el, `${t.id}/${el.id} has weight`).toBe(false)
      }
    }
  })

  it('FE-BOOKTPLDATA-006: no template carries a list element — this fork fills pros/cons itself, as a compact footer on the entry\'s own page (autoLayout.ts\'s prosConsFooterElements), so a second, always-empty list panel baked into the template would just be dead space', () => {
    for (const t of SPREAD_TEMPLATES) {
      expect(t.elements.some(el => el.kind === 'list'), t.id).toBe(false)
    }
  })

  it('FE-BOOKTPLDATA-007: at least one template needs no story (so a photo-only entry still has somewhere hand-drawn to land)', () => {
    const noStoryRequired = SPREAD_TEMPLATES.some(t => !t.elements.some(el => el.kind === 'text' && el.binding?.source === 'entry.story'))
    expect(noStoryRequired).toBe(true)
  })
})

// FE-COMP-PACKINGPDF-001 to FE-COMP-PACKINGPDF-012
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadPackingListPDF } from './PackingListPDF'

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseTrip = { id: 1, title: 'My Trip' } as any

const t = (key: string, params?: any) => {
  const table: Record<string, string> = {
    'packing.defaultCategory': 'Other',
    'admin.packingTemplates.items': 'items',
    'packing.printByCategory': 'By category',
    'packing.printByBag': 'By bag',
    'packing.noBag': 'Unassigned',
    'packing.title': 'Packing List',
    'pdf.saveAsPdf': 'Save as PDF',
  }
  return table[key] ?? key
}

function getOverlay(): HTMLElement | null {
  return document.getElementById('pdf-preview-overlay')
}

function getIframe(): HTMLIFrameElement | null {
  return document.querySelector('#pdf-preview-overlay iframe')
}

const items = [
  { id: 1, trip_id: 1, name: 'Passport', category: 'Documents', checked: 0, quantity: 1, bag_id: 1, weight_grams: 50 } as any,
  { id: 2, trip_id: 1, name: 'T-Shirt', category: 'Clothing', checked: 1, quantity: 3, bag_id: 1, weight_grams: 150 } as any,
  { id: 3, trip_id: 1, name: 'Sunscreen', category: 'Toiletries', checked: 0, quantity: 1, bag_id: null, weight_grams: null } as any,
]

const bags = [{ id: 1, name: 'Backpack', color: '#6366f1' }]

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000', pathname: '/', href: 'http://localhost:3000/', search: '' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  document.getElementById('pdf-preview-overlay')?.remove()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('downloadPackingListPDF', () => {
  it('FE-COMP-PACKINGPDF-001: resolves without throwing (groupBy category)', async () => {
    await expect(downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })).resolves.not.toThrow()
  })

  it('FE-COMP-PACKINGPDF-002: resolves without throwing (groupBy bag)', async () => {
    await expect(downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'bag', t, locale: 'en-US' })).resolves.not.toThrow()
  })

  it('FE-COMP-PACKINGPDF-003: appends an overlay with an iframe srcdoc', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })
    expect(getOverlay()).not.toBeNull()
    const iframe = getIframe()
    expect(iframe).not.toBeNull()
    expect(iframe!.srcdoc.length).toBeGreaterThan(0)
  })

  it('FE-COMP-PACKINGPDF-004: groupBy category renders one card per category with its items', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })
    const html = getIframe()!.srcdoc
    expect(html).toContain('Documents')
    expect(html).toContain('Clothing')
    expect(html).toContain('Toiletries')
    expect(html).toContain('Passport')
    expect(html).toContain('T-Shirt')
    expect(html).toContain('Sunscreen')
  })

  it('FE-COMP-PACKINGPDF-005: groupBy bag groups by bag name and buckets unassigned items separately', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'bag', t, locale: 'en-US' })
    const html = getIframe()!.srcdoc
    expect(html).toContain('Backpack')
    expect(html).toContain('Unassigned')
    // Passport + T-Shirt are in the bag, Sunscreen is unassigned
    const backpackIdx = html.indexOf('Backpack')
    const unassignedIdx = html.indexOf('Unassigned')
    const passportIdx = html.indexOf('Passport')
    const sunscreenIdx = html.indexOf('Sunscreen')
    expect(passportIdx).toBeGreaterThan(backpackIdx)
    expect(passportIdx).toBeLessThan(unassignedIdx)
    expect(sunscreenIdx).toBeGreaterThan(unassignedIdx)
  })

  it('FE-COMP-PACKINGPDF-006: shows quantity for items with quantity > 1', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })
    expect(getIframe()!.srcdoc).toContain('×3')
  })

  it('FE-COMP-PACKINGPDF-007: shows weight in grams when present', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })
    expect(getIframe()!.srcdoc).toContain('50g')
  })

  it('FE-COMP-PACKINGPDF-008: renders a blank checkbox per item regardless of checked state', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })
    const html = getIframe()!.srcdoc
    const checkboxCount = (html.match(/class="checkbox"/g) || []).length
    expect(checkboxCount).toBe(items.length)
  })

  it('FE-COMP-PACKINGPDF-009: escHtml prevents XSS in item and trip names', async () => {
    const xssItems = [{ id: 9, trip_id: 1, name: '<script>alert(1)</script>', category: 'Other', checked: 0, quantity: 1 } as any]
    await downloadPackingListPDF({ trip: { id: 1, title: '<img src=x onerror=alert(1)>' } as any, items: xssItems, bags: [], groupBy: 'category', t, locale: 'en-US' })
    const html = getIframe()!.srcdoc
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('FE-COMP-PACKINGPDF-010: close button removes the overlay', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags, groupBy: 'category', t, locale: 'en-US' })
    const closeBtn = document.getElementById('pdf-close-btn') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    closeBtn.click()
    expect(getOverlay()).toBeNull()
  })

  it('FE-COMP-PACKINGPDF-011: works with an empty items list', async () => {
    await expect(downloadPackingListPDF({ trip: baseTrip, items: [], bags: [], groupBy: 'category', t, locale: 'en-US' })).resolves.not.toThrow()
    expect(getIframe()!.srcdoc).toContain('<!DOCTYPE html>')
  })

  it('FE-COMP-PACKINGPDF-012: groupBy bag with no bags falls back to a single unassigned group', async () => {
    await downloadPackingListPDF({ trip: baseTrip, items, bags: [], groupBy: 'bag', t, locale: 'en-US' })
    const html = getIframe()!.srcdoc
    expect(html).toContain('Unassigned')
    expect(html).toContain('Passport')
  })
})

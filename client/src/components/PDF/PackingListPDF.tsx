// Packing list checklist PDF via browser print window (same pattern as TripPDF.tsx)
import type { Trip, PackingItem } from '../../types'

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function absUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  return window.location.origin + (url.startsWith('/') ? '' : '/') + url
}

// Same palette as PackingListPanel's katColor(), kept in sync so printed
// category dots match the colors the user sees on screen.
const KAT_COLORS = ['#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f97316', '#06b6d4', '#ef4444', '#eab308', '#8b5cf6', '#14b8a6']
function katColor(kat: string, allCategories: string[]) {
  const idx = allCategories.indexOf(kat)
  if (idx >= 0) return KAT_COLORS[idx % KAT_COLORS.length]
  let h = 0
  for (let i = 0; i < kat.length; i++) h = ((h << 5) - h + kat.charCodeAt(i)) | 0
  return KAT_COLORS[Math.abs(h) % KAT_COLORS.length]
}

interface PackingItemWithBag extends PackingItem {
  bag_id?: number | null
  weight_grams?: number | null
}

interface PackingBag {
  id: number
  name: string
  color: string
}

interface downloadPackingListPDFProps {
  trip: Trip
  items: PackingItemWithBag[]
  bags?: PackingBag[]
  groupBy: 'category' | 'bag'
  t: (key: string, params?: Record<string, string | number>) => string
  locale: string
}

function itemRowHtml(item: PackingItemWithBag) {
  const qty = item.quantity && item.quantity > 1 ? `<span class="item-qty">×${item.quantity}</span>` : ''
  const weight = item.weight_grams ? `<span class="item-weight">${item.weight_grams}g</span>` : ''
  return `
    <div class="check-row">
      <span class="checkbox"></span>
      <span class="item-name">${escHtml(item.name)}</span>
      ${qty}${weight}
    </div>`
}

function groupCardHtml(name: string, color: string, groupItems: PackingItemWithBag[], itemsLabel: string) {
  if (groupItems.length === 0) return ''
  return `
    <div class="group-card">
      <div class="group-header" style="border-left-color:${color}">
        <span class="group-dot" style="background:${color}"></span>
        <span class="group-title">${escHtml(name)}</span>
        <span class="group-count">${groupItems.length} ${escHtml(itemsLabel)}</span>
      </div>
      <div class="group-body">${groupItems.map(itemRowHtml).join('')}</div>
    </div>`
}

export async function downloadPackingListPDF({ trip, items, bags = [], groupBy, t: _t, locale: _locale }: downloadPackingListPDFProps) {
  const loc = _locale || undefined
  const tr = _t || ((k: string) => k)

  const defaultCategory = tr('packing.defaultCategory')
  const allCategories: string[] = []
  for (const item of items) {
    const cat = item.category || defaultCategory
    if (!allCategories.includes(cat)) allCategories.push(cat)
  }

  const itemsLabel = tr('admin.packingTemplates.items')
  const groupsTitle = groupBy === 'bag' ? tr('packing.printByBag') : tr('packing.printByCategory')

  let groupsHtml = ''
  if (groupBy === 'bag') {
    const bagIds = new Set(bags.map(b => b.id))
    groupsHtml += bags.map(bag => groupCardHtml(bag.name, bag.color, items.filter(i => i.bag_id === bag.id), itemsLabel)).join('')
    // Includes items with no bag_id as well as items whose bag_id no longer
    // matches an existing bag (e.g. the bag was deleted after assignment).
    const unassigned = items.filter(i => !i.bag_id || !bagIds.has(i.bag_id))
    groupsHtml += groupCardHtml(tr('packing.noBag'), '#94a3b8', unassigned, itemsLabel)
  } else {
    groupsHtml = allCategories.map(cat => groupCardHtml(cat, katColor(cat, allCategories), items.filter(i => (i.category || defaultCategory) === cat), itemsLabel)).join('')
  }

  const html = `<!DOCTYPE html>
<html lang="${(loc || 'en').split('-')[0]}">
<head>
<meta charset="UTF-8">
<base href="${window.location.origin}/">
<title>${escHtml(trip?.title || tr('packing.title'))}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Poppins', sans-serif; background: #fff; color: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 28px; }

  .pdf-header { margin-bottom: 18px; }
  .pdf-eyebrow { font-size: 9px; font-weight: 600; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; }
  .pdf-title { font-size: 22px; font-weight: 700; color: #0f172a; }
  .pdf-subtitle { font-size: 11px; color: #64748b; margin-top: 3px; }

  .groups { column-count: 2; column-gap: 20px; }
  @media (max-width: 700px) { .groups { column-count: 1; } }

  .group-card {
    break-inside: avoid; -webkit-column-break-inside: avoid;
    border: 1px solid #e2e8f0; border-radius: 8px;
    margin-bottom: 14px; overflow: hidden; display: inline-block; width: 100%;
  }
  .group-header {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px; background: #f8fafc; border-left: 4px solid;
  }
  .group-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .group-title { font-size: 11px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.03em; flex: 1; }
  .group-count { font-size: 9.5px; color: #94a3b8; font-weight: 600; white-space: nowrap; }
  .group-body { padding: 4px 10px 8px; }

  .check-row { display: flex; align-items: center; gap: 8px; padding: 5px 2px; border-bottom: 1px dashed #f1f5f9; page-break-inside: avoid; }
  .check-row:last-child { border-bottom: none; }
  .checkbox { width: 12px; height: 12px; border: 1.6px solid #94a3b8; border-radius: 3px; flex-shrink: 0; }
  .item-name { font-size: 11px; color: #1e293b; flex: 1; }
  .item-qty { font-size: 9.5px; font-weight: 600; color: #64748b; }
  .item-weight { font-size: 9px; color: #94a3b8; background: #f1f5f9; border-radius: 99px; padding: 1px 6px; }

  .pdf-footer { margin-top: 24px; display: flex; align-items: center; justify-content: center; gap: 6px; opacity: 0.3; }
  .pdf-footer span { font-size: 7px; color: #64748b; letter-spacing: 0.5px; }

  @media print { body { margin: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>

<div class="pdf-header">
  <div class="pdf-eyebrow">${escHtml(groupsTitle)}</div>
  <div class="pdf-title">${escHtml(trip?.title || tr('packing.title'))}</div>
  <div class="pdf-subtitle">${items.length} ${escHtml(itemsLabel)}</div>
</div>

<div class="groups">${groupsHtml}</div>

<div class="pdf-footer">
  <span>made with</span>
  <img src="${absUrl('/logo-dark.svg')}" style="height:10px;opacity:0.6;" />
</div>

</body></html>`

  const overlay = document.createElement('div')
  overlay.id = 'pdf-preview-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:8px;'
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }

  const card = document.createElement('div')
  card.style.cssText = 'width:100%;max-width:1000px;height:95vh;background:var(--bg-card);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);'

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border-primary);flex-shrink:0;'
  header.innerHTML = `
    <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${escHtml(trip?.title || tr('packing.title'))} — ${escHtml(groupsTitle)}</span>
    <div style="display:flex;align-items:center;gap:8px">
      <button id="pdf-print-btn" style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;font-family:inherit">${tr('pdf.saveAsPdf')}</button>
      <button id="pdf-close-btn" style="background:none;border:none;cursor:pointer;color:var(--text-faint);display:flex;padding:4px;border-radius:6px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'flex:1;width:100%;border:none;'
  iframe.sandbox = 'allow-same-origin allow-modals allow-scripts'
  iframe.srcdoc = html

  card.appendChild(header)
  card.appendChild(iframe)
  overlay.appendChild(card)
  document.body.appendChild(overlay)

  header.querySelector('#pdf-close-btn').onclick = () => overlay.remove()
  header.querySelector('#pdf-print-btn').onclick = () => { iframe.contentWindow?.print() }
}

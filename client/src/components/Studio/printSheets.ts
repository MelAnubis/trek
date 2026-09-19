/**
 * Handing the book to the printer. Ported from liketrek/trek's
 * client/src/components/Studio/printSheets.ts (same AGPLv3 license) — the
 * same house style JourneyBookPDF.tsx already uses for the Trip journey
 * PDF: a sandboxed `srcdoc` iframe and `iframe.contentWindow.print()`, no
 * server-side rendering.
 *
 * What comes out is a real PDF: vector text, embedded fonts, images at
 * full resolution. What does not come out is a TrimBox/BleedBox — a
 * browser sets neither — which is why the sheets carry crop marks
 * instead: a press reads where to cut from the marks.
 */

const PAPER = '#ffffff'
const WORKTOP = '#52525b'
const BAR = '#0f172a'
const BAR_LINE = '#e4e4e7'

export interface PrintSheetsInput {
  /** The rendered sheets, as HTML. */
  html: string
  /** Sheet size in millimetres, bleed and crop-mark room included. */
  sheetWidth: number
  sheetHeight: number
  /** The size of a one-page sheet, when the document also holds two-page ones (spread mode mixes covers and spreads). Omitted when every sheet is the same size. */
  singleWidth?: number
  singleHeight?: number
  title: string
  labels: { save: string; close: string; count: string; preparing: string }
}

/**
 * Every stylesheet the app is currently using, as markup for the iframe
 * head — copied rather than re-listed, so the sheets (the editor's own
 * components) get the editor's own CSS including the bundled `@font-face`
 * rules.
 */
function collectStyles(): string {
  const out: string[] = []
  for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    if (node.tagName === 'LINK') {
      const href = (node as HTMLLinkElement).href
      if (href) out.push(`<link rel="stylesheet" href="${escapeAttr(href)}">`)
    } else {
      out.push(`<style>${node.textContent ?? ''}</style>`)
    }
  }
  return out.join('\n')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A page box for the single-page sheets, when the document mixes widths — a named page rule is how CSS says "these print on a different sheet size". */
function singleRule(input: PrintSheetsInput): string {
  if (!input.singleWidth || !input.singleHeight) return ''
  if (input.singleWidth === input.sheetWidth && input.singleHeight === input.sheetHeight) return ''
  return `  @page single { size: ${input.singleWidth}mm ${input.singleHeight}mm; margin: 0; }
  .bx-sheet.is-single { page: single; }`
}

/**
 * Open the print view. Resolves once the document is on screen and ready
 * to print — after its images and fonts have loaded, not merely after the
 * markup is in place, which is how a book avoids coming out with blank
 * rectangles where the photographs were.
 */
export function printSheets(input: PrintSheetsInput): () => void {
  const lang = document.documentElement.lang || 'en'

  const doc = `<!doctype html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8">
<title>${escapeText(input.title)}</title>
<base href="${escapeAttr(window.location.origin)}/">
${collectStyles()}
<style>
  @page { size: ${input.sheetWidth}mm ${input.sheetHeight}mm; margin: 0; }
${singleRule(input)}
  @media screen { .bx-book { zoom: var(--bx-fit, 1); } }
  /* Overrides the host app's own SPA shell rules (index.css sets
     html{height:100%;overflow:hidden} so the app scrolls on body, not
     html) — collectStyles() copies that in wholesale above, and left
     unset here it clips this whole multi-sheet document down to one
     page's worth of content before break-after:page ever gets a chance
     to paginate it, which is why printing used to produce a single,
     cropped page instead of every sheet. */
  html, body { margin: 0; padding: 0; background: ${WORKTOP}; height: auto; overflow: visible; }
  .bx-book { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 0; }
  .bx-sheet { box-shadow: 0 2px 12px rgba(0,0,0,0.35); }
  @media print {
    html, body { background: ${PAPER}; height: auto; overflow: visible; }
    .bx-book { display: block; gap: 0; padding: 0; }
    .bx-sheet { box-shadow: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>${input.html}</body>
</html>`

  const overlay = document.createElement('div')
  overlay.id = 'bx-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:8px;'

  const style = document.createElement('style')
  style.textContent = `
    #bx-overlay .bx-card { width:100%;max-width:1100px;height:95vh;background:${PAPER};border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.35); }
    #bx-overlay .bx-head { display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 16px;border-bottom:1px solid ${BAR_LINE};flex-shrink:0;background:${BAR}; }
    #bx-overlay .bx-name { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:rgba(255,255,255,0.45);font-weight:500;letter-spacing:0.03em; }
    #bx-overlay .bx-actions { display:flex;align-items:center;gap:8px;flex:none; }
    #bx-overlay .bx-btn { min-height:44px;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;border:none; }
    #bx-overlay .bx-btn[disabled] { opacity:0.5;cursor:default; }
    #bx-overlay .bx-save { border:none;background:${PAPER};color:${BAR}; }
    #bx-overlay .bx-close { border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7); }
    @media (max-width: 640px) {
      #bx-overlay { padding:0; }
      #bx-overlay .bx-card { height:100dvh;max-width:none;border-radius:0; }
      #bx-overlay .bx-name { display:none; }
      #bx-overlay .bx-actions { flex:1; }
      #bx-overlay .bx-btn { flex:1;padding:10px 12px;font-size:13px; }
    }
  `

  const card = document.createElement('div')
  card.className = 'bx-card'

  const header = document.createElement('div')
  header.className = 'bx-head'
  header.innerHTML = `
    <span class="bx-name">${escapeText(input.title)} &middot; ${escapeText(input.labels.count)}</span>
    <div class="bx-actions">
      <button id="bx-save" class="bx-btn bx-save" disabled>${escapeText(input.labels.preparing)}</button>
      <button id="bx-close" class="bx-btn bx-close">${escapeText(input.labels.close)}</button>
    </div>
  `

  const iframe = document.createElement('iframe')
  iframe.style.cssText = `flex:1;width:100%;border:none;background:${WORKTOP};`
  // Nothing inside the document runs — printing is triggered from here
  // through contentWindow.print() — so allow-scripts is deliberately withheld.
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals')
  iframe.srcdoc = doc

  card.appendChild(header)
  card.appendChild(iframe)
  overlay.appendChild(style)
  overlay.appendChild(card)
  document.body.appendChild(overlay)

  const close = () => { stopFitting(); overlay.remove() }
  overlay.onclick = e => { if (e.target === overlay) close() }
  header.querySelector<HTMLButtonElement>('#bx-close')!.onclick = close

  const save = header.querySelector<HTMLButtonElement>('#bx-save')!
  save.onclick = () => { iframe.contentWindow?.print() }

  /** CSS millimetres are defined against 96dpi, so this ratio is exact. */
  const PX_PER_MM = 96 / 25.4

  /** Shrink the preview until a sheet fits across the pane. Never enlarge. */
  const fitPreview = () => {
    const root = iframe.contentDocument?.documentElement
    if (!root) return
    const available = iframe.clientWidth - 32
    if (available <= 0) return
    const scale = Math.min(1, available / (input.sheetWidth * PX_PER_MM))
    root.style.setProperty('--bx-fit', String(Math.round(scale * 1000) / 1000))
  }

  window.addEventListener('resize', fitPreview)
  const stopFitting = () => window.removeEventListener('resize', fitPreview)

  iframe.addEventListener('load', () => {
    fitPreview()
    void whenReady(iframe).then(() => {
      save.disabled = false
      save.textContent = input.labels.save
    })
  })

  return close
}

/**
 * When the document is actually printable — a photograph still decoding
 * prints as an empty box, and a face still loading prints in the
 * fallback, so both images and fonts are waited on (bounded by a ceiling,
 * so a picture that will never load can't hold the button hostage forever).
 */
async function whenReady(iframe: HTMLIFrameElement): Promise<void> {
  const win = iframe.contentWindow
  const doc = iframe.contentDocument
  if (!win || !doc) return

  const settle = (el: Element) => new Promise<void>(resolve => {
    el.addEventListener('load', () => resolve(), { once: true })
    el.addEventListener('error', () => resolve(), { once: true })
  })

  const images = Array.from(doc.images).map(img => (img.complete ? Promise.resolve() : settle(img)))

  const wait = win.setTimeout?.bind(win) ?? setTimeout
  const ceiling = new Promise<void>(resolve => { wait(resolve, 8000) })

  await Promise.race([
    Promise.all([...images, doc.fonts?.ready ?? Promise.resolve()]),
    ceiling,
  ])
}

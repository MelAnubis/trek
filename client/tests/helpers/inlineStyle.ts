// Inline styles that moved to Tailwind classes (the static part of style={{…}}): a test can
// still ask "does this element have padding 4px 10px?" whichever way it is set.

/* eslint-disable */
const KEYWORDS: Record<string, Record<string, string>> = {
  display: { flex: 'flex', grid: 'grid', block: 'block', inline: 'inline', 'inline-block': 'inline-block', 'inline-flex': 'inline-flex', 'inline-grid': 'inline-grid', none: 'hidden', contents: 'contents' },
  position: { absolute: 'absolute', relative: 'relative', fixed: 'fixed', sticky: 'sticky', static: 'static' },
  flexDirection: { column: 'flex-col', row: 'flex-row', 'column-reverse': 'flex-col-reverse', 'row-reverse': 'flex-row-reverse' },
  flexWrap: { wrap: 'flex-wrap', nowrap: 'flex-nowrap' },
  alignItems: { center: 'items-center', 'flex-start': 'items-start', 'flex-end': 'items-end', stretch: 'items-stretch', baseline: 'items-baseline', start: 'items-start', end: 'items-end' },
  justifyContent: { center: 'justify-center', 'space-between': 'justify-between', 'flex-start': 'justify-start', 'flex-end': 'justify-end', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly', start: 'justify-start', end: 'justify-end' },
  alignSelf: { center: 'self-center', 'flex-start': 'self-start', 'flex-end': 'self-end', stretch: 'self-stretch', auto: 'self-auto' },
  textAlign: { center: 'text-center', left: 'text-left', right: 'text-right', justify: 'text-justify' },
  whiteSpace: { nowrap: 'whitespace-nowrap', 'pre-wrap': 'whitespace-pre-wrap', pre: 'whitespace-pre', normal: 'whitespace-normal', 'pre-line': 'whitespace-pre-line' },
  overflow: { hidden: 'overflow-hidden', auto: 'overflow-auto', visible: 'overflow-visible', scroll: 'overflow-scroll' },
  overflowY: { auto: 'overflow-y-auto', hidden: 'overflow-y-hidden', scroll: 'overflow-y-scroll' },
  overflowX: { auto: 'overflow-x-auto', hidden: 'overflow-x-hidden', scroll: 'overflow-x-scroll' },
  textOverflow: { ellipsis: 'text-ellipsis', clip: 'text-clip' },
  cursor: { pointer: 'cursor-pointer', default: 'cursor-default', 'not-allowed': 'cursor-not-allowed', grab: 'cursor-grab', text: 'cursor-text', move: 'cursor-move' },
  pointerEvents: { none: 'pointer-events-none', auto: 'pointer-events-auto' },
  userSelect: { none: 'select-none', text: 'select-text', all: 'select-all' },
  boxSizing: { 'border-box': 'box-border', 'content-box': 'box-content' },
  textTransform: { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  fontStyle: { italic: 'italic', normal: 'not-italic' },
  wordBreak: { 'break-all': 'break-all', 'break-word': 'break-words' },
  objectFit: { cover: 'object-cover', contain: 'object-contain', fill: 'object-fill' },
  visibility: { hidden: 'invisible', visible: 'visible' },
}

const PREFIX: Record<string, string> = {
  padding: 'p', paddingTop: 'pt', paddingBottom: 'pb', paddingLeft: 'pl', paddingRight: 'pr',
  margin: 'm', marginTop: 'mt', marginBottom: 'mb', marginLeft: 'ml', marginRight: 'mr',
  gap: 'gap', rowGap: 'gap-y', columnGap: 'gap-x',
  width: 'w', height: 'h', minWidth: 'min-w', maxWidth: 'max-w', minHeight: 'min-h', maxHeight: 'max-h',
  top: 'top', bottom: 'bottom', left: 'left', right: 'right', inset: 'inset',
  borderRadius: 'rounded', zIndex: 'z', opacity: 'opacity', lineHeight: 'leading', letterSpacing: 'tracking',
  flex: 'flex', flexShrink: 'shrink', flexGrow: 'grow',
}

const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order'])

/** The class the inline-style conversion produced for this property and value. */
export function styleClass(key: string, raw: string | number): string {
  const v = typeof raw === 'number' ? (UNITLESS.has(key) || raw === 0 ? String(raw) : raw + 'px') : String(raw).trim()
  if (KEYWORDS[key] && KEYWORDS[key][v]) return '!' + KEYWORDS[key][v]
  const arb = v.replace(/\s+/g, '_')
  if (key === 'fontSize') return '!text-[length:' + arb + ']'
  if (key === 'fontWeight' && /^\d+$/.test(v)) return '!font-[' + arb + ']'
  if (key === 'color') return '![color:' + arb + ']'
  if (PREFIX[key]) return '!' + PREFIX[key] + '-[' + arb + ']'
  return '![' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + arb + ']'
}

/** True when the element has this style inline or as its converted class. */
export function hasStyle(el: Element | null | undefined, key: string, value: string | number): boolean {
  if (!el) return false
  const inline = (el as HTMLElement).style?.[key as any]
  const want = typeof value === 'number' && !UNITLESS.has(key) && value !== 0 ? value + 'px' : String(value)
  if (inline === want) return true
  return el.classList.contains(styleClass(key, value))
}

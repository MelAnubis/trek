import type { CSSProperties } from 'react'

/**
 * Abstract geometric flag glyphs for the badge element's `flag`/`country`
 * variants. Not real national flags — this fork carries no per-country
 * outline/flag dataset (see bookMapElementSchema's own comment on why the
 * map element doesn't either, having dropped upstream's countryShapes.ts
 * rather than vendor it) — but a small deterministic pattern library
 * (stripes, cross, saltire, canton, chevron, sunburst, frame) picked from
 * the badge's own ISO code string and painted with the badge's own
 * accent/color, so two different codes reliably look visually distinct
 * without asserting a specific nation's actual flag design.
 */

type FlagPattern = 'h-tri' | 'v-tri' | 'h-bi' | 'diagonal' | 'cross' | 'saltire' | 'canton' | 'chevron' | 'sunburst' | 'frame'

const PATTERNS: FlagPattern[] = ['h-tri', 'v-tri', 'h-bi', 'diagonal', 'cross', 'saltire', 'canton', 'chevron', 'sunburst', 'frame']

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function patternForCode(code: string | null | undefined): FlagPattern {
  if (!code) return 'h-tri'
  return PATTERNS[hashString(code.toUpperCase()) % PATTERNS.length]
}

const PAPER = '#ffffff'
const W = 32
const H = 22

export function FlagGlyph({ code, primary, secondary, size = '8mm', style }: {
  code?: string | null
  primary: string
  secondary: string
  /** A CSS length (mm, matching every other book element) — the glyph's width; height follows the flag's own aspect ratio. */
  size?: string
  style?: CSSProperties
}) {
  const pattern = patternForCode(code)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', flexShrink: 0, width: size, height: `calc(${size} * ${H} / ${W})`, ...style }}>
      {pattern === 'h-tri' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={primary} />
          <rect x={0} y={H / 3} width={W} height={H / 3} fill={PAPER} />
        </>
      )}
      {pattern === 'v-tri' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={primary} />
          <rect x={W / 3} y={0} width={W / 3} height={H} fill={secondary} />
        </>
      )}
      {pattern === 'h-bi' && (
        <>
          <rect x={0} y={0} width={W} height={H / 2} fill={primary} />
          <rect x={0} y={H / 2} width={W} height={H / 2} fill={secondary} />
        </>
      )}
      {pattern === 'diagonal' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={secondary} />
          <polygon points={`0,0 ${W},0 0,${H}`} fill={primary} />
        </>
      )}
      {pattern === 'cross' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={secondary} />
          <rect x={W * 0.28} y={0} width={W * 0.16} height={H} fill={PAPER} />
          <rect x={0} y={H * 0.4} width={W} height={H * 0.2} fill={PAPER} />
        </>
      )}
      {pattern === 'saltire' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={secondary} />
          <polygon points={`0,0 ${W * 0.18},0 ${W},${H * 0.82} ${W},${H} ${W * 0.82},${H} 0,${H * 0.18}`} fill={primary} />
          <polygon points={`${W},0 ${W},${H * 0.18} ${W * 0.18},${H} 0,${H} 0,${H * 0.82} ${W * 0.82},0`} fill={primary} />
        </>
      )}
      {pattern === 'canton' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={PAPER} />
          <rect x={0} y={0} width={W} height={H / 5} fill={primary} />
          <rect x={0} y={(H * 2) / 5} width={W} height={H / 5} fill={primary} />
          <rect x={0} y={(H * 4) / 5} width={W} height={H / 5} fill={primary} />
          <rect x={0} y={0} width={W * 0.4} height={H * 0.55} fill={secondary} />
        </>
      )}
      {pattern === 'chevron' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={primary} />
          <polygon points={`0,0 ${W * 0.45},${H / 2} 0,${H}`} fill={PAPER} />
          <polygon points={`${W * 0.15},0 ${W * 0.6},${H / 2} ${W * 0.15},${H}`} fill={secondary} />
        </>
      )}
      {pattern === 'sunburst' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={PAPER} />
          <circle cx={W / 2} cy={H / 2} r={H * 0.32} fill={primary} />
        </>
      )}
      {pattern === 'frame' && (
        <>
          <rect x={0} y={0} width={W} height={H} fill={primary} />
          <rect x={W * 0.12} y={H * 0.16} width={W * 0.76} height={H * 0.68} fill={secondary} />
        </>
      )}
    </svg>
  )
}

/**
 * A generic waving-flag silhouette — the fallback when no code is set yet,
 * same "legitimately empty for a moment" reasoning as BookMapElement's own
 * null-src placeholder.
 */
export function FlagSilhouette({ color, size = '8mm', style }: { color: string; size?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0, width: size, height: size, ...style }}>
      <rect x={3} y={2} width={1.6} height={20} rx={0.8} fill={color} opacity={0.9} />
      <path d="M4.6 3 C 10 1, 14 5, 20 3 L 18 8 C 14 9.5, 10 6.5, 4.6 8 Z" fill={color} opacity={0.55} />
    </svg>
  )
}

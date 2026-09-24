import type { CSSProperties } from 'react'
import type { BookElement, BookImageElement, BookPageSetup, BookPhotoElement, BookShapeElement, BookSpread } from '../../types/book'
import { fontStack } from './bookFonts'
import { BookPhotoImg } from './BookPhotoImg'
import { folio } from './bookSheets'
import { BadgeView, IconView, ListView, MapView, PlacesView, StatsView } from './TravelElements'
import { HOLED_SHAPES, SHAPE_PATHS, scalePath, unitPath } from './shapes'

/**
 * One spread, drawn. Ported from liketrek/trek's
 * client/src/components/Studio/SpreadView.tsx (same AGPLv3 license) —
 * `ElementView` dispatches photo/text/shape/image locally and the
 * travel-specific kinds (map/stats/countries/badge/icon/list) out to
 * TravelElements.tsx.
 *
 * This component is the whole reason Studio renders in DOM rather than on a
 * canvas: the *same* tree the editor draws is what the print renderer will
 * run in a sandboxed iframe (the same iframe+window.print() mechanism
 * JourneyBookPDF.tsx already uses). Edit mode (Phase 2) adds handles and
 * outlines on top; print mode is this and nothing else — no second renderer
 * to drift against.
 *
 * Everything is positioned in millimetres. CSS maps mm onto print output with
 * a fixed ratio, so what you see at `scale(0.4)` on screen is the same box
 * model the printer gets at 1:1.
 */

/** Exported for TravelElements.tsx's renderers, which need the same absolute-mm placement every other element kind gets. */
export function frameStyle(el: BookElement): CSSProperties {
  return {
    position: 'absolute',
    left: `${el.frame.x}mm`,
    top: `${el.frame.y}mm`,
    width: `${el.frame.w}mm`,
    height: `${el.frame.h}mm`,
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const FILTERS: Record<string, string | undefined> = {
  none: undefined,
  bw: 'grayscale(1) contrast(1.05)',
  warm: 'saturate(1.1) sepia(0.16)',
  cool: 'saturate(1.05) hue-rotate(-8deg) brightness(1.02)',
  fade: 'saturate(0.72) contrast(0.88) brightness(1.08)',
  contrast: 'contrast(1.22) saturate(1.06)',
}

/**
 * `rect` and `ellipse` draw as plain boxes — a box genuinely is a better
 * rectangle than a path (exact corner radii, an even border on every side).
 * Everything else in the decorative library (shapes.ts) draws as an SVG
 * path, scaled in millimetres rather than through the viewBox so a stroke
 * width means one thing regardless of the shape's aspect ratio — see
 * shapes.ts's own comment for why.
 */
function ShapeView({ el }: { el: BookShapeElement }) {
  const fill = el.fill ?? 'transparent'
  const gradient = el.gradient !== 'none' && el.fill
  const gradientId = `shape-grad-${el.id}`

  const background = !gradient
    ? fill
    : `linear-gradient(${el.gradient === 'up' ? 'to top' : 'to bottom'},`
      + ` ${hexToRgba(el.fill!, 0)} 0%,`
      + ` ${hexToRgba(el.fill!, 0.55)} 46%,`
      + ` ${hexToRgba(el.fill!, 1)} 100%)`

  if (el.shape === 'rect' || el.shape === 'ellipse') {
    return (
      <div
        style={{
          ...frameStyle(el),
          background,
          border: el.stroke ? `${el.strokeWidth}mm ${el.strokeStyle} ${el.stroke}` : undefined,
          boxSizing: 'border-box',
          borderRadius: el.shape === 'ellipse' ? '50%' : el.radius ? `${el.radius}mm` : undefined,
        }}
      />
    )
  }

  const path = scalePath(SHAPE_PATHS[el.shape] ?? SHAPE_PATHS.rect, el.frame.w, el.frame.h)
  const dashArray = el.strokeStyle === 'dashed' ? `${el.strokeWidth * 3} ${el.strokeWidth * 2}`
    : el.strokeStyle === 'dotted' ? `${el.strokeWidth} ${el.strokeWidth * 1.6}` : undefined

  return (
    <svg style={frameStyle(el)} viewBox={`0 0 ${el.frame.w} ${el.frame.h}`} preserveAspectRatio="none">
      {gradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1={el.gradient === 'up' ? '1' : '0'} x2="0" y2={el.gradient === 'up' ? '0' : '1'}>
            <stop offset="0%" stopColor={hexToRgba(el.fill!, 0)} />
            <stop offset="46%" stopColor={hexToRgba(el.fill!, 0.55)} />
            <stop offset="100%" stopColor={hexToRgba(el.fill!, 1)} />
          </linearGradient>
        </defs>
      )}
      <path
        d={path}
        fill={gradient ? `url(#${gradientId})` : fill}
        fillRule={HOLED_SHAPES.has(el.shape) ? 'evenodd' : 'nonzero'}
        stroke={el.stroke ?? undefined}
        strokeWidth={el.stroke ? el.strokeWidth : undefined}
        strokeDasharray={dashArray}
        strokeLinejoin="round"
      />
    </svg>
  )
}

const FRAME_INSET: Record<string, { pad: number; bottom: number }> = {
  none: { pad: 0, bottom: 0 },
  polaroid: { pad: 0.055, bottom: 0.17 },
  white: { pad: 0.035, bottom: 0.035 },
  shadow: { pad: 0, bottom: 0 },
  film: { pad: 0.075, bottom: 0.075 },
  tape: { pad: 0, bottom: 0 },
}

const round2 = (n: number) => Math.round(n * 100) / 100

function PhotoView({ el, big, print, dropLabel, publicToken }: {
  el: BookPhotoElement; big: boolean; print: boolean; dropLabel: string; publicToken?: string
}) {
  const deco = FRAME_INSET[el.frameStyle] ?? FRAME_INSET.none
  const side = Math.min(el.frame.w, el.frame.h)
  const pad = round2(deco.pad * side)
  const bottom = round2(deco.bottom * side)
  const empty = el.photoId == null

  // An empty frame is a template's promise of where a picture goes — in the
  // printed book an unfilled frame is nothing at all.
  if (empty && print) return null

  const labelSize = Math.max(2.4, Math.min(4.6, side * 0.085))
  const roomy = side - pad * 2 > 22 && el.frame.w - pad * 2 > 34

  const hatch = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'repeating-linear-gradient(45deg, rgba(0,0,0,.055) 0 6px, rgba(0,0,0,.025) 6px 12px), #ffffff',
        border: '1px dashed rgba(0,0,0,.16)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2mm',
      }}
    >
      {roomy && dropLabel && (
        <span
          style={{
            fontFamily: fontStack('sans'),
            fontSize: `${labelSize}mm`,
            fontWeight: 600,
            letterSpacing: '0.16em',
            lineHeight: 1.5,
            textAlign: 'center',
            textTransform: 'uppercase',
            color: 'rgba(0,0,0,.34)',
            whiteSpace: 'pre-line',
            userSelect: 'none',
          }}
        >
          {dropLabel}
        </span>
      )}
    </div>
  )

  // A mask past the two basic shapes clips through an objectBoundingBox
  // SVG clipPath rather than CSS clip-path: path() — the latter takes its
  // numbers as bare CSS px, and this box is sized in mm, so the path would
  // clip to the wrong region without converting units. objectBoundingBox
  // sidesteps that entirely: its 0..1 coordinates are fractions of the
  // clipped element's own box, whatever that box is sized in.
  const clipId = `photo-mask-${el.id}`
  const needsClipPath = el.mask != null && el.mask !== 'ellipse' && el.mask !== 'rect'

  const picture = (
    <div
      style={{
        position: 'absolute',
        left: `${pad}mm`,
        top: `${pad}mm`,
        right: `${pad}mm`,
        bottom: `${bottom || pad}mm`,
        overflow: 'hidden',
        borderRadius: el.mask === 'ellipse' ? '50%' : el.radius ? `${el.radius}mm` : undefined,
        clipPath: needsClipPath ? `url(#${clipId})` : undefined,
      }}
    >
      {needsClipPath && (
        <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d={unitPath(SHAPE_PATHS[el.mask!] ?? SHAPE_PATHS.rect)} />
            </clipPath>
          </defs>
        </svg>
      )}
      {empty ? hatch : (
        <BookPhotoImg
          photoId={el.photoId!}
          big={big}
          print={print}
          publicToken={publicToken}
          style={{
            width: '100%',
            height: '100%',
            objectFit: el.fit,
            objectPosition: `${el.focalX * 100}% ${el.focalY * 100}%`,
            filter: FILTERS[el.filter],
            display: 'block',
          }}
        />
      )}
    </div>
  )

  return (
    <div
      style={{
        ...frameStyle(el),
        background: el.frameStyle === 'polaroid' || el.frameStyle === 'white' ? '#ffffff'
          : el.frameStyle === 'film' ? '#141414'
          : undefined,
        boxShadow: el.frameStyle === 'shadow' || el.frameStyle === 'polaroid'
          ? '0 1.2mm 3mm rgba(0,0,0,.22)'
          : undefined,
      }}
    >
      {picture}
    </div>
  )
}

/** A self-contained `data:` URI — always a plain `<img src>`, in both edit and print mode, since there's no live fetch to race (see the type's own comment). */
function ImageView({ el }: { el: BookImageElement }) {
  return (
    <img
      src={el.src}
      alt=""
      draggable={false}
      style={{
        ...frameStyle(el),
        objectFit: el.fit,
        borderRadius: el.radius ? `${el.radius}mm` : undefined,
        display: 'block',
      }}
    />
  )
}

export function ElementView({
  el, big, print = false, dropLabel = '', publicToken,
}: { el: BookElement; big: boolean; print?: boolean; dropLabel?: string; publicToken?: string }) {
  if (el.kind === 'photo') {
    return <PhotoView el={el} big={big} print={print} dropLabel={dropLabel} publicToken={publicToken} />
  }

  if (el.kind === 'shape') return <ShapeView el={el} />
  if (el.kind === 'image') return <ImageView el={el} />
  if (el.kind === 'map') return <MapView el={el} />
  if (el.kind === 'stats') return <StatsView el={el} />
  if (el.kind === 'places') return <PlacesView el={el} />
  if (el.kind === 'badge') return <BadgeView el={el} />
  if (el.kind === 'icon') return <IconView el={el} />
  if (el.kind === 'list') return <ListView el={el} />

  return (
    <div
      style={{
        ...frameStyle(el),
        color: el.color,
        fontSize: `${el.size}pt`,
        fontFamily: fontStack(el.font),
        fontWeight: el.weight,
        fontStyle: el.italic ? 'italic' : undefined,
        lineHeight: el.leading,
        letterSpacing: `${el.tracking}em`,
        textAlign: el.align,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        hyphens: 'auto',
      }}
    >
      {el.text}
    </div>
  )
}

/**
 * The folios — drawn by the renderer rather than stored as elements, since
 * the number a page carries is a function of where the spread sits in the
 * book, not something that survives the spread being moved or deleted.
 * Simpler than upstream's own PageNumbers.tsx: a fixed position (outer
 * corner) and colour rather than a position/font/auto-contrast picker — see
 * StudioInspector's Document panel for the one setting this fork exposes.
 * The cover carries none, same as upstream: a folio on a cover is a mistake
 * in every book ever bound.
 */
function PageNumbers({ spread, page, spreadIndex }: { spread: BookSpread; page: BookPageSetup; spreadIndex: number }) {
  if (!page.pageNumbers?.show || spread.role !== 'inner') return null
  const left = folio(spreadIndex)
  const right = left + 1
  const W = page.pageWidth
  const boxW = W * 0.4
  const common: CSSProperties = {
    position: 'absolute',
    top: `${page.pageHeight - 12}mm`,
    width: `${boxW}mm`,
    fontSize: '8pt',
    fontWeight: 500,
    letterSpacing: '0.08em',
    lineHeight: 1,
    color: '#8a8578',
    fontVariantNumeric: 'tabular-nums',
    pointerEvents: 'none',
  }
  return (
    <>
      <div style={{ ...common, left: '6mm', textAlign: 'left' }}>{left}</div>
      <div style={{ ...common, left: `${W * 2 - boxW - 6}mm`, textAlign: 'right' }}>{right}</div>
    </>
  )
}

/** The sheet. `print` is exactly what the print renderer will produce; the editor (Phase 2) draws the same thing and layers its chrome above it. */
export function SpreadView({
  spread,
  page,
  big = false,
  print = false,
  dropLabel = '',
  spreadIndex,
  publicToken,
}: {
  spread: BookSpread
  page: BookPageSetup
  big?: boolean
  print?: boolean
  dropLabel?: string
  /** Position in the document, cover included — needed to number the page. Omit where a spread is shown out of book context (e.g. a template swatch) and folios don't apply. */
  spreadIndex?: number
  /** Set for the public share view: routes photos through the token-gated proxy instead of the authenticated one. */
  publicToken?: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: spread.background ?? '#ffffff',
        overflow: print ? 'visible' : 'hidden',
      }}
    >
      {spread.elements.map(el => (
        <ElementView key={el.id} el={el} big={big} print={print} dropLabel={dropLabel} publicToken={publicToken} />
      ))}
      {spreadIndex != null && <PageNumbers spread={spread} page={page} spreadIndex={spreadIndex} />}
    </div>
  )
}

/**
 * The fold down the middle of an open book.
 *
 * Preview chrome, not content — which is why it lives outside `SpreadView`.
 * A printed book has a physical crease; a *printed* shadow down the gutter
 * would be a defect. So the editor and the page thumbnails draw this, and
 * the print renderer never sees it.
 *
 * Two layers, because that is what makes paper read as curving rather than
 * as a grey stripe: the shadow ramps into the spine and darkens hard at the
 * crease, and just outside it a pale band lifts, the way the sheet catches
 * light as it comes back up out of the binding.
 */
export function SpreadFold({ page, scaled }: { page: BookPageSetup; scaled: number }) {
  const width = 52 * scaled
  const left = page.pageWidth * scaled - width / 2
  return (
    <div style={{ position: 'absolute', left, top: 0, width, bottom: 0, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg,'
            + ' rgba(255,255,255,0) 0%,'
            + ' rgba(255,255,255,.07) 12%,'
            + ' rgba(255,255,255,.17) 27%,'
            + ' rgba(255,255,255,.11) 37%,'
            + ' rgba(255,255,255,0) 43%,'
            + ' rgba(0,0,0,.035) 45.5%,'
            + ' rgba(0,0,0,.10) 48%,'
            + ' rgba(0,0,0,.18) 49.6%,'
            + ' rgba(0,0,0,.21) 50%,'
            + ' rgba(0,0,0,.18) 50.4%,'
            + ' rgba(0,0,0,.10) 52%,'
            + ' rgba(0,0,0,.035) 54.5%,'
            + ' rgba(255,255,255,0) 57%,'
            + ' rgba(255,255,255,.11) 63%,'
            + ' rgba(255,255,255,.17) 73%,'
            + ' rgba(255,255,255,.07) 88%,'
            + ' rgba(255,255,255,0) 100%)',
        }}
      />
      {/* The crease itself. Sub-pixel at small zoom, which is right — you
          should not see a hard line on a page shown at 15%. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          bottom: 0,
          width: Math.max(0.5, 0.35 * scaled),
          marginLeft: -Math.max(0.25, 0.175 * scaled),
          background: 'rgba(0,0,0,.16)',
        }}
      />
    </div>
  )
}

import { useId, useMemo, type CSSProperties } from 'react'
import type { BookElement, BookImageElement, BookPageSetup, BookPaint, BookPhotoElement, BookShapeElement, BookSpread } from '../../types/book'
import { fontStack } from './bookFonts'
import { filterCss, frameSpec, textEffectCss } from './bookStyles'
import { BookPhotoImg } from './BookPhotoImg'
import { folioSettings, isNumbered } from './bookSheets'
import { folioInk } from './folioColour'
import { AccommodationView, BadgeView, CountriesView, IconView, ListView, MapView, PackingView, PlacesView, StatsView } from './TravelElements'
import { HOLED_SHAPES, SHAPE_PATHS, scalePath, unitPath } from './shapes'
import { PaintedPath, SpreadPaint } from './paint/paintRender'
import { roundedRectPath, strokeDash } from './paint/paintGeometry'
import { hasEdge, photoEdgeClip, photoEdgePath, shapeOutline } from './shapeOutline'
import { LineView } from './LineView'
import { StickerView } from './StickerView'
import { TextEffectsView } from './text/TextEffectsView'
import { hasTextEffects } from './text/textEffects'
import { photoLookOf, pictureFilter, silhouetteShadows, svgFilterMatrices, zoomPlacement, type PhotoLook } from './photoLook'

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


/**
 * `rect` and `ellipse` draw as plain boxes — a box genuinely is a better
 * rectangle than a path (exact corner radii, an even border on every side).
 * Everything else in the decorative library (shapes.ts) draws as an SVG
 * path, scaled in millimetres rather than through the viewBox so a stroke
 * width means one thing regardless of the shape's aspect ratio — see
 * shapes.ts's own comment for why.
 */
function ShapeView({ el }: { el: BookShapeElement }) {
  // A paint (gradient, see-through colour, pattern) or a cut edge: drawn wholly in SVG (5.7.6).
  if (el.paint || hasEdge(el, el.shape)) return <PaintedShapeView el={el} paint={el.paint ?? legacyPaint(el)} />
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


const round2 = (n: number) => Math.round(n * 100) / 100

/** What a shape's old fields say, as paint, for one drawn in SVG because of its edge. */
function legacyPaint(el: BookShapeElement): BookPaint | null {
  if (el.fill === null) return null
  if (el.gradient === 'none') return { type: 'solid', color: el.fill }
  const color = el.fill
  return { type: 'linear', angle: el.gradient === 'up' ? 0 : 180, stops: [{ at: 0, color, alpha: 0 }, { at: 0.46, color, alpha: 0.55 }, { at: 1, color, alpha: 1 }] }
}

/**
 * A shape carrying a paint or a cut edge, drawn wholly in SVG (port of
 * liketrek/TREK's paint/PaintedShape.tsx). The path is drawn into the frame
 * inset by half the stroke, so the whole stroke sits inside the frame.
 */
function PaintedShapeView({ el, paint }: { el: BookShapeElement; paint: BookPaint | null }) {
  const sw = el.stroke ? el.strokeWidth : 0
  const w = Math.max(0.01, el.frame.w - sw)
  const h = Math.max(0.01, el.frame.h - sw)
  const d = useMemo(
    () => (hasEdge(el, el.shape) ? shapeOutline(el, w, h)
      : el.shape === 'rect' ? roundedRectPath(w, h, Math.max(0, el.radius - sw / 2))
        : shapeOutline(el, w, h)),
    [el, w, h, sw],
  )
  const box = useMemo(() => ({ x: 0, y: 0, w, h }), [w, h])
  return (
    <div style={frameStyle(el)}>
      <svg width={`${el.frame.w}mm`} height={`${el.frame.h}mm`} viewBox={`0 0 ${el.frame.w} ${el.frame.h}`} style={{ display: 'block', overflow: 'visible' }}>
        <g transform={sw ? `translate(${sw / 2} ${sw / 2})` : undefined}>
          <PaintedPath
            d={d}
            paint={paint}
            box={box}
            idPrefix={el.id}
            fillRule={HOLED_SHAPES.has(el.shape) ? 'evenodd' : undefined}
            stroke={el.stroke ?? undefined}
            strokeWidth={sw || undefined}
            strokeDasharray={strokeDash(el.strokeStyle, sw)}
            strokeLinecap={el.strokeStyle === 'dotted' ? 'round' : undefined}
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  )
}

function PhotoView({ el, big, print, dropLabel, publicToken }: {
  el: BookPhotoElement; big: boolean; print: boolean; dropLabel: string; publicToken?: string
}) {
  const deco = frameSpec(el.frameStyle)
  const side = Math.min(el.frame.w, el.frame.h)
  const pad = round2(deco.pad * side)
  const bottom = round2(deco.bottom * side)
  const empty = el.photoId == null
  // Per instance: the page view can draw a spread twice, and two filters with one id would cross.
  const filterRef = `photo-look-${useId().replace(/:/g, '')}`
  // An empty frame wears the frame style but none of the look: a border or a
  // shadow around a hatch would read as part of the picture to come.
  const look = photoLookOf(empty ? {} : el)
  const matrices = svgFilterMatrices(look)
  const filterId = matrices.length ? filterRef : null

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
  // A cut edge (5.7.6) replaces the mask's outline with its cut one, in the picture box's own millimetres.
  const edgeClip = photoEdgeClip(el, el.frame.w - pad * 2, el.frame.h - pad - (bottom || pad))
  const needsClipPath = edgeClip !== null || (el.mask != null && el.mask !== 'ellipse' && el.mask !== 'rect')

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
        ...deco.inner?.(side),
      }}
    >
      {needsClipPath && (
        <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d={edgeClip ?? unitPath(SHAPE_PATHS[el.mask!] ?? SHAPE_PATHS.rect)} />
            </clipPath>
          </defs>
        </svg>
      )}
      {empty ? hatch : (
        <LookPicture el={el} look={look} big={big} print={print} publicToken={publicToken} filterId={filterId} />
      )}
      {!empty && (
        <BorderBand mask={el.mask} radius={el.radius} look={look}
          width={el.frame.w - pad * 2} height={el.frame.h - pad - (bottom || pad)}
          d={edgeClip ? photoEdgePath(el, el.frame.w - pad * 2, el.frame.h - pad - (bottom || pad)) ?? undefined : undefined} />
      )}
      {filterId && (
        <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
          <defs>
            <filter id={filterId} colorInterpolationFilters="sRGB">
              {matrices.map((values, i) => <feColorMatrix key={i} type="matrix" values={values} />)}
            </filter>
          </defs>
        </svg>
      )}
    </div>
  )

  // Over the picture, not clipped by it: tape strips run past the edge.
  const overlay = deco.overlay === 'tape' ? (
    <>
      {[{ left: '-4%', rot: -38 }, { right: '-4%', rot: 38 }].map((t, i) => (
        <div key={i} style={{
          position: 'absolute', top: `${-side * 0.035}mm`, ...('left' in t ? { left: t.left } : { right: t.right }),
          width: `${side * 0.32}mm`, height: `${side * 0.085}mm`,
          background: 'rgba(250, 240, 200, 0.78)', boxShadow: '0 0.2mm 0.5mm rgba(0,0,0,.12)',
          transform: `rotate(${t.rot}deg)`, pointerEvents: 'none',
        }} />
      ))}
    </>
  ) : deco.overlay === 'vignette' ? (
    <div style={{
      position: 'absolute', left: `${pad}mm`, top: `${pad}mm`, right: `${pad}mm`, bottom: `${bottom || pad}mm`,
      borderRadius: el.mask === 'ellipse' ? '50%' : el.radius ? `${el.radius}mm` : undefined,
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,.18) 72%, rgba(0,0,0,.55) 100%)',
      pointerEvents: 'none',
    }} />
  ) : deco.overlay === 'corners' ? (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map(c => {
        const sz = side * 0.14
        const at = { tl: { left: 0, top: 0, rot: 0 }, tr: { right: 0, top: 0, rot: 90 }, br: { right: 0, bottom: 0, rot: 180 }, bl: { left: 0, bottom: 0, rot: 270 } }[c]
        return (
          <svg key={c} viewBox="0 0 10 10" style={{
            position: 'absolute', width: `${sz}mm`, height: `${sz}mm`,
            left: 'left' in at ? 0 : undefined, right: 'right' in at ? 0 : undefined,
            top: 'top' in at ? 0 : undefined, bottom: 'bottom' in at ? 0 : undefined,
            transform: `rotate(${at.rot}deg)`, pointerEvents: 'none',
          }} aria-hidden>
            <path d="M0 0 H10 L0 10 Z" fill="#1f1f1f" />
          </svg>
        )
      })}
    </>
  ) : null

  // The die-cut edge and hard shadow: box shadows on the outer box when its
  // outline is the picture's (a rectangle, rounded or an ellipse) or a card
  // that holds it; a silhouette of the mask behind the picture otherwise.
  const outer = deco.outer?.(side) ?? {}
  const card = pad > 0 || bottom > 0
  const silhouette = !card && needsClipPath
  const looks = silhouette ? [] : silhouetteShadows(look.shadow, look.cutout)
  const shadows = [...looks, ...(typeof outer.boxShadow === 'string' ? [outer.boxShadow] : [])]
  const round = !card && looks.length
    ? (el.mask === 'ellipse' ? '50%' : el.radius ? `${el.radius}mm` : undefined)
    : undefined

  return (
    <div
      data-frame={el.frameStyle}
      style={{
        ...frameStyle(el),
        ...outer,
        ...(round ? { borderRadius: round } : null),
        boxShadow: shadows.length ? shadows.join(', ') : undefined,
      }}
    >
      {silhouette && (look.shadow || look.cutout) && (
        <ShapeSilhouette w={el.frame.w} h={el.frame.h} mask={el.mask ?? 'rect'} look={look}
          d={edgeClip ? photoEdgePath(el, el.frame.w, el.frame.h) ?? undefined : undefined} />
      )}
      {picture}
      {overlay}
    </div>
  )
}

/** The picture, zoomed about its focal point and mirrored where the look says so (port of upstream's Picture). */
function LookPicture({ el, look, big, print, publicToken, filterId }: {
  el: BookPhotoElement; look: PhotoLook; big: boolean; print: boolean; publicToken?: string; filterId: string | null
}) {
  const zoom = zoomPlacement(look.zoom, el.focalX, el.focalY)
  const img = (
    <BookPhotoImg
      photoId={el.photoId!}
      big={big}
      print={print}
      publicToken={publicToken}
      style={{
        width: zoom?.size ?? '100%',
        height: zoom?.size ?? '100%',
        // The app's base styles cap images at their box's width; a zoomed picture is meant to overflow it.
        maxWidth: zoom ? 'none' : undefined,
        transform: zoom?.transform,
        objectFit: el.fit,
        objectPosition: `${el.focalX * 100}% ${el.focalY * 100}%`,
        filter: pictureFilter(filterCss(el.filter), look, filterId),
        display: 'block',
      }}
    />
  )
  if (!look.flipX) return img
  // Mirrored inside a box the size of the frame, so the crop shows the same part and the mask is not mirrored with it.
  return <div style={{ position: 'absolute', inset: 0, transform: 'scaleX(-1)' }}>{img}</div>
}

/** The hard shadow and die-cut edge of a shaped photo: its mask, grown by the cutout, behind the picture. */
function ShapeSilhouette({ w, h, mask, look, d: given }: { w: number; h: number; mask: NonNullable<BookPhotoElement['mask']>; look: PhotoLook; d?: string }) {
  const d = given ?? scalePath(SHAPE_PATHS[mask] ?? SHAPE_PATHS.rect, w, h)
  const rule = HOLED_SHAPES.has(mask) ? 'evenodd' : undefined
  const grow = look.cutout?.width ?? 0
  const path = (color: string, dx = 0, dy = 0) => (
    <path d={d} transform={dx || dy ? `translate(${dx} ${dy})` : undefined} fill={color} fillRule={rule}
      stroke={grow ? color : undefined} strokeWidth={grow ? grow * 2 : undefined} strokeLinejoin="round" />
  )
  return (
    <svg aria-hidden width={`${w}mm`} height={`${h}mm`} viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block', pointerEvents: 'none' }}>
      {look.shadow && <g opacity={look.shadow.alpha}>{path(look.shadow.color, look.shadow.dx, look.shadow.dy)}</g>}
      {look.cutout && path(look.cutout.color)}
    </svg>
  )
}

/** The border: a band along the inside of the picture's edge, following its shape. */
function BorderBand({ mask, radius, look, width, height, d }: {
  mask: BookPhotoElement['mask']; radius: number | undefined; look: PhotoLook; width: number; height: number; d?: string
}) {
  const border = look.border
  if (!border || width <= 0 || height <= 0) return null
  if (d || (mask && mask !== 'rect' && mask !== 'ellipse')) {
    // Stroked twice as wide as the band and cut by the picture's own clip, so exactly the inner half shows.
    return (
      <svg aria-hidden viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}>
        <path d={d ?? scalePath(SHAPE_PATHS[mask ?? 'rect'] ?? SHAPE_PATHS.rect, width, height)} fill="none"
          stroke={border.color} strokeWidth={border.width * 2} strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, borderStyle: 'solid', borderWidth: `${border.width}mm`, borderColor: border.color,
      borderRadius: mask === 'ellipse' ? '50%' : radius ? `${radius}mm` : undefined, boxSizing: 'border-box', pointerEvents: 'none',
    }} />
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
  if (el.kind === 'countries') return <CountriesView el={el} />
  if (el.kind === 'badge') return <BadgeView el={el} />
  if (el.kind === 'icon') return <IconView el={el} />
  if (el.kind === 'list') return <ListView el={el} />
  if (el.kind === 'packing') return <PackingView el={el} />
  if (el.kind === 'accommodation') return <AccommodationView el={el} />
  if (el.kind === 'line') return <LineView el={el} frameStyle={frameStyle(el)} />
  if (el.kind === 'sticker') return <StickerView el={el} frameStyle={frameStyle(el)} />
  if (hasTextEffects(el)) return <TextEffectsView el={el} frameStyle={frameStyle(el)} big={big} print={print} publicToken={publicToken} />

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
        textTransform: el.uppercase && (!el.transform || el.transform === 'none') ? 'uppercase' : undefined,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        hyphens: 'auto',
      }}
    >
      {/* An inline span, so a highlight follows each wrapped line. */}
      <span style={textEffectCss(el)}>{el.text}</span>
    </div>
  )
}

/**
 * The folios — drawn by the renderer rather than stored as elements, since
 * the number a page carries is a function of where the spread sits in the
 * book, not something that survives the spread being moved or deleted.
 * Follows upstream's PageNumbers.tsx: start number, outer/inner/centre
 * position, margin from the trim, size, font, and a colour that is either
 * fixed or picked per page from what the number lands on (folioColour.ts).
 * The cover and back cover carry none: a folio on a cover is a mistake in
 * every book ever bound.
 */
function PageNumbers({ spread, page, spreadIndex, folios: given }: { spread: BookSpread; page: BookPageSetup; spreadIndex: number; folios?: readonly number[] }) {
  const cfg = folioSettings(page)
  if (!cfg.show || !isNumbered(spread.role)) return null
  // Counted by the caller, which has the whole book (see foliosOf). Without
  // it, the old arithmetic: a book of inner spreads straight after a cover.
  const folios = given ?? (spread.role === 'inner' ? [cfg.startAt + (spreadIndex - 1) * 2, cfg.startAt + (spreadIndex - 1) * 2 + 1] : [])
  if (folios.length === 0) return null
  const W = page.pageWidth
  const y = page.pageHeight - cfg.margin

  // A spread numbers both pages. A single page is one page wide; 'first' is
  // a right-hand leaf and 'last' a left-hand one, which decides which edge
  // is the outer one.
  const sides: Array<['left' | 'right', number]> = spread.role === 'inner'
    ? [['left', folios[0]], ['right', folios[1]]]
    : [[spread.role === 'first' ? 'right' : 'left', folios[0]]]

  const place = (side: 'left' | 'right') => {
    const pageX = side === 'left' || spread.role !== 'inner' ? 0 : W
    if (cfg.position === 'centre') return { x: pageX, w: W, align: 'center' as const }
    const atLeftEdge = side === 'left' ? cfg.position === 'outer' : cfg.position !== 'outer'
    return atLeftEdge
      ? { x: pageX + cfg.margin, w: W * 0.4, align: 'left' as const }
      : { x: pageX + W * 0.6 - cfg.margin, w: W * 0.4, align: 'right' as const }
  }

  return (
    <>
      {sides.map(([side, number]) => {
        const at = place(side)
        // Sampled where the digits actually are, not at the box's left edge.
        const ink = cfg.autoColor
          ? folioInk(spread, at.align === 'left' ? at.x + 3 : at.align === 'right' ? at.x + at.w - 3 : at.x + at.w / 2, y + cfg.size * 0.18)
          : { color: cfg.color, shadow: undefined }
        return (
          <div key={side} data-folio={number} style={{
            position: 'absolute',
            left: `${at.x}mm`,
            top: `${y}mm`,
            width: `${at.w}mm`,
            textAlign: at.align,
            fontFamily: fontStack(cfg.font),
            fontSize: `${cfg.size}pt`,
            fontWeight: 500,
            letterSpacing: '0.08em',
            lineHeight: 1,
            color: ink.color,
            textShadow: ink.shadow,
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
          }}>{number}</div>
        )
      })}
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
  folios,
}: {
  spread: BookSpread
  page: BookPageSetup
  big?: boolean
  print?: boolean
  dropLabel?: string
  /** Position in the document, cover included — needed to number the page. Omit where a spread is shown out of book context (e.g. a template swatch) and folios don't apply. */
  spreadIndex?: number
  /** This spread's page numbers, from foliosOf over the whole book. Omitted: the old inner-spreads-only arithmetic. */
  folios?: readonly number[]
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
      {spread.backgroundPaint && (
        <SpreadPaint paint={spread.backgroundPaint} width={page.pageWidth * (spread.role === 'inner' ? 2 : 1)}
          height={page.pageHeight} bleed={page.bleed} idPrefix={spread.id} />
      )}
      {/* A hidden layer stays in the layers panel and off the page, here and in print. */}
      {spread.elements.filter(el => !el.hidden).map(el => (
        <ElementView key={el.id} el={el} big={big} print={print} dropLabel={dropLabel} publicToken={publicToken} />
      ))}
      {spreadIndex != null && <PageNumbers spread={spread} page={page} spreadIndex={spreadIndex} folios={folios} />}
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

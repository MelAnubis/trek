import type { CSSProperties } from 'react'
import type { BookElement, BookPageSetup, BookPhotoElement, BookShapeElement, BookSpread } from '../../types/book'
import { fontStack } from './bookFonts'
import { BookPhotoImg } from './BookPhotoImg'

/**
 * One spread, drawn. Ported (Phase 1 subset: photo/text/shape only — no
 * icon/map/stats/countries/badge/list yet, those land with the travel
 * elements in a later phase) from liketrek/trek's
 * client/src/components/Studio/SpreadView.tsx (same AGPLv3 license).
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

function frameStyle(el: BookElement): CSSProperties {
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

/** Phase 1 only draws rect/ellipse — the decorative shape library (lines, stars, banners…) arrives in Phase 2. */
function ShapeView({ el }: { el: BookShapeElement }) {
  const fill = el.fill ?? 'transparent'
  const gradient = el.gradient !== 'none' && el.fill

  const background = !gradient
    ? fill
    : `linear-gradient(${el.gradient === 'up' ? 'to top' : 'to bottom'},`
      + ` ${hexToRgba(el.fill!, 0)} 0%,`
      + ` ${hexToRgba(el.fill!, 0.55)} 46%,`
      + ` ${hexToRgba(el.fill!, 1)} 100%)`

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

const FRAME_INSET: Record<string, { pad: number; bottom: number }> = {
  none: { pad: 0, bottom: 0 },
  polaroid: { pad: 0.055, bottom: 0.17 },
  white: { pad: 0.035, bottom: 0.035 },
  shadow: { pad: 0, bottom: 0 },
  film: { pad: 0.075, bottom: 0.075 },
  tape: { pad: 0, bottom: 0 },
}

const round2 = (n: number) => Math.round(n * 100) / 100

function PhotoView({ el, big, print, dropLabel }: {
  el: BookPhotoElement; big: boolean; print: boolean; dropLabel: string
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
      }}
    >
      {empty ? hatch : (
        <BookPhotoImg
          photoId={el.photoId!}
          big={big}
          print={print}
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

export function ElementView({
  el, big, print = false, dropLabel = '',
}: { el: BookElement; big: boolean; print?: boolean; dropLabel?: string }) {
  if (el.kind === 'photo') {
    return <PhotoView el={el} big={big} print={print} dropLabel={dropLabel} />
  }

  if (el.kind === 'shape') return <ShapeView el={el} />

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

/** The sheet. `print` is exactly what the print renderer will produce; the editor (Phase 2) draws the same thing and layers its chrome above it. */
export function SpreadView({
  spread,
  page,
  big = false,
  print = false,
  dropLabel = '',
}: {
  spread: BookSpread
  page: BookPageSetup
  big?: boolean
  print?: boolean
  dropLabel?: string
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
        <ElementView key={el.id} el={el} big={big} print={print} dropLabel={dropLabel} />
      ))}
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

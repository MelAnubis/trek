import type { CSSProperties } from 'react'
import type { BookStickerElement } from '../../types/book'
import { bookSticker, bookStickerLayerPaint } from './stickers/catalogue'
import type { BookStickerDef } from './stickers/sticker-types'

/**
 * A sticker, drawn (port of liketrek/TREK's StickerView.tsx, 5.7.10): its
 * layers as one inline SVG in the sticker's own box, scaled to the frame and
 * keeping its proportions, every layer a vector path in print. A flip mirrors
 * the drawing inside the frame. An id this library does not hold draws nothing.
 */
export function StickerArt({ def, colors = [], flipX = false }: { def: BookStickerDef; colors?: readonly string[]; flipX?: boolean }) {
  const [w, h] = def.box
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden
      style={{ display: 'block', overflow: 'visible', transform: flipX ? 'scaleX(-1)' : undefined }}>
      {def.layers.map((layer, i) => {
        const { color, opacity } = bookStickerLayerPaint(layer, def.slots, colors)
        const alpha = opacity < 1 ? opacity : undefined
        return layer.w ? (
          <path key={i} d={layer.d} fill="none" stroke={color} strokeOpacity={alpha} strokeWidth={layer.w} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={i} d={layer.d} fill={color} fillOpacity={alpha} fillRule={layer.eo ? 'evenodd' : undefined} />
        )
      })}
    </svg>
  )
}

export function StickerView({ el, frameStyle }: { el: BookStickerElement; frameStyle: CSSProperties }) {
  const def = bookSticker(el.stickerId)
  if (!def) return null
  return (
    <div style={frameStyle}>
      <StickerArt def={def} colors={el.colors} flipX={el.flipX} />
    </div>
  )
}

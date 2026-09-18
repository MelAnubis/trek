import { useEffect, useRef, useState } from 'react'
import type { PeerCursor } from './useBookPresence'
import { peerColour } from './peerColour'

/**
 * The other people's pointers.
 *
 * ── Why they are interpolated ────────────────────────────────────────────
 *
 * They arrive about ten times a second, because sending sixty would be five
 * times the traffic for something the eye cannot use. Drawn as they arrive,
 * that reads as a stutter; drawn towards where they last were, it reads as a
 * hand moving. The catch-up is deliberately quick — a pointer that eases
 * elegantly into place is a pointer that is telling you where somebody was a
 * third of a second ago.
 *
 * The colour is derived from the person's id — see peerColour.ts.
 */

/** How much of the remaining distance is covered per frame. */
const EASE = 0.28

/** Below this, in millimetres, the pointer is simply put where it belongs. */
const SNAP_MM = 0.15

export function PeerCursors({
  cursors, spreadIndex, zoom,
}: {
  cursors: PeerCursor[]
  /** Only the pointers on the spread being looked at are drawn. */
  spreadIndex: number
  /** The sheet's scale, so the arrow can undo it and stay one size. */
  zoom: number
}) {
  const here = cursors.filter(c => c.spreadIndex === spreadIndex)
  if (here.length === 0) return null

  return (
    <>
      {here.map(cursor => (
        <Pointer key={cursor.socketId} cursor={cursor} zoom={zoom} />
      ))}
    </>
  )
}

function Pointer({ cursor, zoom }: { cursor: PeerCursor; zoom: number }) {
  const [at, setAt] = useState({ x: cursor.x, y: cursor.y })
  const target = useRef({ x: cursor.x, y: cursor.y })
  const frame = useRef<number | null>(null)

  target.current = { x: cursor.x, y: cursor.y }

  useEffect(() => {
    const step = () => {
      setAt(current => {
        const dx = target.current.x - current.x
        const dy = target.current.y - current.y
        if (Math.abs(dx) < SNAP_MM && Math.abs(dy) < SNAP_MM) {
          frame.current = null
          return target.current
        }
        frame.current = requestAnimationFrame(step)
        return { x: current.x + dx * EASE, y: current.y + dy * EASE }
      })
    }
    if (frame.current == null) frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [cursor.x, cursor.y])

  const colour = peerColour(cursor.userId)

  return (
    <div
      style={{
        position: 'absolute',
        // Placed in the sheet's millimetres, which is what the position means,
        // and then scaled back out: an arrow that grew with the zoom would be a
        // postage stamp at 30% and a dinner plate at 400%.
        left: `${at.x}mm`,
        top: `${at.y}mm`,
        transform: `scale(${1 / Math.max(zoom, 0.05)})`,
        transformOrigin: 'top left',
        pointerEvents: 'none',
        zIndex: 50,
      }}
      aria-hidden
    >
      {/*
        The arrow itself. Drawn rather than an icon so the fill can be the
        person's colour and the outline can stay white — a solid pointer
        disappears into a dark photograph, and a white one into a white page.
      */}
      <svg width="18" height="23" viewBox="0 0 14 18" fill="none" style={{ display: 'block' }}>
        <path
          d="M1 1L1 14.5L4.6 11.3L7.1 16.6L9.6 15.4L7.1 10.2L11.6 10.2L1 1Z"
          fill={colour}
          stroke="#ffffff"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      {cursor.username && (
        <span style={{
          position: 'absolute', left: 14, top: 18, whiteSpace: 'nowrap',
          padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 600,
          color: '#fff', background: colour, boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        }}>
          {cursor.username}
        </span>
      )}
    </div>
  )
}

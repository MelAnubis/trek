import { useEffect, useState } from 'react'
import { ChevronsDown, ChevronsUp, Copy, Lock, RotateCcw, RotateCw, Trash2, Unlock } from 'lucide-react'
import type { BookElement, BookPageSetup, BookSpread } from '../../types/book'
import { SpreadFold, SpreadView } from './SpreadView'
import { elementId } from './bookIds'
import { fontStack } from './bookFonts'
import { useSpreadInteraction, type HandleId } from './useSpreadInteraction'
import { useStudioStore } from '../../store/studioStore'
import { useTranslation } from '../../i18n'
import { PeerCursors } from './PeerCursors'
import type { PeerCursor } from './useBookPresence'

/**
 * The sheet plus everything you do to it. Ported from liketrek/trek's
 * client/src/components/Studio/StudioCanvas.tsx (same AGPLv3 license).
 * Raw-OS-file drop-to-upload is still trimmed (photos come from the Content
 * panel's own drag source for now; dropping a file straight from the desktop
 * is a follow-up). Peer cursors (Phase 5) are wired in via `cursors`/`onCursor`.
 *
 * The page itself is `SpreadView`, byte for byte what the print renderer
 * will draw. Selection outlines, handles and snap guides live in a layer
 * *above* it and never touch the document, so nothing you see while editing
 * can end up in the book.
 */

const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * A locked element stays selectable on purpose, so the lock has to be
 * honoured here the way the drag, resize and rotate gestures honour it.
 */
const deletable = (spread: BookSpread | undefined, selection: string[]): string[] =>
  (spread?.elements ?? []).filter(e => selection.includes(e.id) && !e.locked).map(e => e.id)

const ROTATE_CORNERS = [
  { id: 'nw', left: '0%', top: '0%' },
  { id: 'ne', left: '100%', top: '0%' },
  { id: 'se', left: '100%', top: '100%' },
  { id: 'sw', left: '0%', top: '100%' },
] as const

const HANDLE_POS: Record<HandleId, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
}

export function StudioCanvas({
  spread,
  spreadIndex,
  page,
  zoom,
  pxPerMm,
  bookView,
  dropLabel,
  cursors,
  onCursor,
}: {
  spread: BookSpread | null
  spreadIndex: number
  page: BookPageSetup
  zoom: number
  pxPerMm: number
  bookView: boolean
  dropLabel: string
  /** Other editors' pointers, all spreads — StudioCanvas filters to its own. */
  cursors?: PeerCursor[]
  /** Where this tab's own pointer is, in the spread's millimetres — null on leave. */
  onCursor?: (x: number | null, y: number | null) => void
}) {
  const { t } = useTranslation()
  const selection = useStudioStore(s => s.selection)
  const select = useStudioStore(s => s.select)
  const removeElements = useStudioStore(s => s.removeElements)
  const spreadCount = useStudioStore(s => s.doc?.spreads.length ?? 0)
  const setActiveSpread = useStudioStore(s => s.setActiveSpread)
  const duplicate = useStudioStore(s => s.duplicate)
  const copyToClipboard = useStudioStore(s => s.copy)
  const pasteFromClipboard = useStudioStore(s => s.paste)
  const raise = useStudioStore(s => s.raise)
  const commit = useStudioStore(s => s.commit)
  const addElement = useStudioStore(s => s.addElement)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  /**
   * Turn the selection by a number of degrees. Kept in -180..180 so an
   * element turned all the way round reads as straight rather than as 360.
   */
  const rotateBy = (deg: number) => {
    commit(d => ({
      ...d,
      spreads: d.spreads.map((sp, i) => (i !== spreadIndex ? sp : {
        ...sp,
        elements: sp.elements.map(e => {
          if (!selection.includes(e.id) || e.locked) return e
          let next = (e.rotation + deg) % 360
          if (next > 180) next -= 360
          if (next < -180) next += 360
          return { ...e, rotation: Math.round(next * 10) / 10 }
        }),
      })),
    }))
  }

  const pointInMm = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scaled, y: (e.clientY - r.top) / scaled }
  }

  const frameUnder = (x: number, y: number) => spread?.elements.find(el =>
    el.kind === 'photo'
    && !el.locked
    && x >= el.frame.x && x <= el.frame.x + el.frame.w
    && y >= el.frame.y && y <= el.frame.y + el.frame.h,
  ) ?? null
  const scaled = pxPerMm * zoom

  const { guides, dragging, startMove, startResize, startRotate, onPointerMove, finish } = useSpreadInteraction({
    spread, spreadIndex, page, pxPerMm: scaled,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault()
        const ids = deletable(spread, selection)
        if (ids.length) removeElements(spreadIndex, ids)
        return
      }
      // Page Down/Up move a page at a time, from anywhere in Studio — this
      // listener is on window, not the canvas element, so it fires
      // regardless of which panel (sidebar, inspector, canvas itself) has
      // focus, the same way Delete/Backspace above already does.
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        if (!spreadCount) return
        e.preventDefault()
        const next = spreadIndex + (e.key === 'PageDown' ? 1 : -1)
        if (next >= 0 && next < spreadCount) setActiveSpread(next)
        return
      }
      // Ctrl/Cmd+C and Ctrl/Cmd+V, from anywhere in Studio, same as
      // Delete/Backspace above — the clipboard is in-memory, not the
      // document, so copying works even with nothing selected (a no-op)
      // and pasting works from any panel that has focus.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (!selection.length) return
        e.preventDefault()
        copyToClipboard(spreadIndex, selection)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteFromClipboard(spreadIndex)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, spread, spreadIndex, removeElements, spreadCount, setActiveSpread, copyToClipboard, pasteFromClipboard])

  if (!spread) return null

  const single = spread.role !== 'inner'
  const sheetW = single ? page.pageWidth : page.pageWidth * 2
  const sel = spread.elements.filter(e => selection.includes(e.id))

  return (
    <div
      className="st-stage"
      style={{ width: sheetW * scaled, height: page.pageHeight * scaled, position: 'relative' }}
      onPointerMove={e => {
        onPointerMove(e)
        if (!onCursor) return
        const r = e.currentTarget.getBoundingClientRect()
        onCursor((e.clientX - r.left) / scaled, (e.clientY - r.top) / scaled)
      }}
      // Leaving the stage sends null, so the arrow goes rather than sticking
      // where the pointer happened to cross the edge.
      onPointerLeave={() => onCursor?.(null, null)}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('application/x-trek-photo')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const p = pointInMm(e)
        setDropTarget(frameUnder(p.x, p.y)?.id ?? null)
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={e => {
        const raw = e.dataTransfer.getData('application/x-trek-photo')
        if (!raw) return
        e.preventDefault()
        setDropTarget(null)

        const photoId = Number(raw)
        if (!Number.isFinite(photoId)) return

        const p = pointInMm(e)
        const target = frameUnder(p.x, p.y)
        if (target) {
          // Dropped onto a frame: fill it — that is the whole point of an
          // empty frame, and replacing a picture is the natural way to swap one.
          commit(d => ({
            ...d,
            spreads: d.spreads.map((sp, i) => (i !== spreadIndex ? sp : {
              ...sp,
              elements: sp.elements.map(el => (el.id === target.id ? { ...el, photoId } : el)),
            })),
          }))
          select([target.id])
          return
        }

        // Dropped on bare paper: a new frame, centred on the cursor.
        const w = Math.min(page.pageWidth, page.pageHeight) * 0.5
        const h = w * 0.72
        const id = elementId('p')
        addElement(spreadIndex, {
          id, kind: 'photo',
          frame: { x: p.x - w / 2, y: p.y - h / 2, w, h },
          rotation: 0, opacity: 1, locked: false,
          photoId, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null,
        } as BookElement)
        select([id])
      }}
    >
      <div
        className="st-sheet"
        style={{
          width: `${sheetW}mm`,
          height: `${page.pageHeight}mm`,
          transform: `scale(${zoom})`,
          position: 'relative',
          transformOrigin: 'top left',
        }}
        onPointerDown={() => select([])}
      >
        <SpreadView spread={spread} page={page} big={zoom > 0.34} dropLabel={dropLabel} />

        {cursors && cursors.length > 0 && (
          <PeerCursors cursors={cursors} spreadIndex={spreadIndex} zoom={zoom} />
        )}

        {/* Hit targets sit above the page so a photo's own <img> never eats
            the gesture, and so a locked element simply is not grabbable. */}
        {spread.elements.map(el => (
          <div
            key={el.id}
            onPointerDown={e => { if (editing !== el.id) startMove(e, el) }}
            onDoubleClick={() => { if (el.kind === 'text' && !el.locked) setEditing(el.id) }}
            style={{
              position: 'absolute',
              left: `${el.frame.x}mm`,
              top: `${el.frame.y}mm`,
              width: `${el.frame.w}mm`,
              height: `${el.frame.h}mm`,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              cursor: el.locked ? 'default' : 'move',
              pointerEvents: 'auto',
            }}
          />
        ))}
      </div>

      {/* Editing happens *on the page*, in the element's own type at the
          element's own size — the whole reason to type here is to watch the
          line endings while you do it. */}
      {editing && (() => {
        const el = spread.elements.find(e => e.id === editing)
        if (!el || el.kind !== 'text') return null
        return (
          <textarea
            className="st-inline-edit"
            autoFocus
            defaultValue={el.text}
            style={{
              position: 'absolute',
              left: el.frame.x * scaled,
              top: el.frame.y * scaled,
              width: el.frame.w * scaled,
              height: el.frame.h * scaled,
              fontSize: `${el.size * (96 / 72) * zoom}px`,
              fontFamily: fontStack(el.font),
              fontWeight: el.weight,
              fontStyle: el.italic ? 'italic' : undefined,
              lineHeight: el.leading,
              letterSpacing: `${el.tracking}em`,
              textAlign: el.align,
              color: el.color,
              background: 'rgba(255,255,255,0.9)',
              border: '1px solid var(--border-primary, #ccc)',
              resize: 'none',
              padding: 0,
            }}
            onBlur={e => {
              const text = e.target.value
              setEditing(null)
              if (text !== el.text) {
                commit(d => ({
                  ...d,
                  spreads: d.spreads.map((sp, i) => (i !== spreadIndex ? sp : {
                    ...sp,
                    elements: sp.elements.map(x => (x.id === el.id ? { ...x, text, overridden: true } : x)),
                  })),
                }))
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
            }}
          />
        )
      })()}

      {/* Chrome layer: drawn in screen pixels so outlines stay hairline at
          any zoom instead of growing with the page. */}
      <div className="st-chrome" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {bookView && !single && <SpreadFold page={page} scaled={scaled} />}

        {dropTarget && (() => {
          const el = spread.elements.find(e => e.id === dropTarget)
          if (!el) return null
          return (
            <div
              className="st-drop"
              style={{
                position: 'absolute',
                left: el.frame.x * scaled,
                top: el.frame.y * scaled,
                width: el.frame.w * scaled,
                height: el.frame.h * scaled,
                border: '2px solid var(--text-primary, #111)',
                borderRadius: 4,
              }}
            />
          )
        })()}

        {sel.map(el => (
          <div
            key={el.id}
            className="st-select"
            style={{
              position: 'absolute',
              left: el.frame.x * scaled,
              top: el.frame.y * scaled,
              width: el.frame.w * scaled,
              height: el.frame.h * scaled,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              outline: '1.5px solid var(--text-primary, #111)',
              pointerEvents: 'none',
            }}
          >
            {sel.length === 1 && !dragging && !el.locked && ROTATE_CORNERS.map(c => (
              <div
                key={c.id}
                className={`st-rotate is-${c.id}`}
                style={{
                  position: 'absolute', left: c.left, top: c.top,
                  width: 18, height: 18, marginLeft: -9, marginTop: -9,
                  borderRadius: '50%', background: 'var(--bg-card, #fff)',
                  border: '1px solid var(--border-primary, #ccc)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'grab', pointerEvents: 'auto',
                }}
                onPointerDown={startRotate}
                title={t('journey.studio.rotate')}
              >
                <RotateCw size={11} />
              </div>
            ))}

            {sel.length === 1 && !dragging && !el.locked && HANDLES.map(h => (
              <span
                key={h}
                className={`st-handle ${h.length === 2 ? 'is-corner' : h === 'n' || h === 's' ? 'is-h' : 'is-v'}`}
                style={{
                  position: 'absolute', left: HANDLE_POS[h].left, top: HANDLE_POS[h].top, cursor: HANDLE_POS[h].cursor,
                  width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5,
                  background: 'var(--bg-card, #fff)', border: '1.5px solid var(--text-primary, #111)',
                  pointerEvents: 'auto',
                }}
                onPointerDown={e => startResize(e, h)}
              />
            ))}
          </div>
        ))}

        {/* The quick bar: the three or four things you reach for constantly, right where you are already looking. */}
        {sel.length >= 1 && !dragging && (() => {
          const x0 = Math.min(...sel.map(e => e.frame.x)) * scaled
          const x1 = Math.max(...sel.map(e => e.frame.x + e.frame.w)) * scaled
          const y0 = Math.min(...sel.map(e => e.frame.y)) * scaled
          const locked = sel.every(e => e.locked)
          return (
            <div
              className="st-quickbar"
              style={{
                position: 'absolute', left: (x0 + x1) / 2, top: Math.max(6, y0 - 12), transform: 'translate(-50%, -100%)',
                display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 10,
                background: 'var(--bg-card, #fff)', boxShadow: '0 2px 10px rgba(0,0,0,0.18)', pointerEvents: 'auto',
              }}
              onPointerDown={e => e.stopPropagation()}
            >
              <button type="button" onClick={() => duplicate(spreadIndex, selection)} title={t('journey.studio.duplicate')} className="st-qb-btn">
                <Copy size={14} />
              </button>
              {sel.length === 1 && (
                <>
                  <button type="button" onClick={() => raise(spreadIndex, sel[0].id, 'front')} title={t('journey.studio.toFront')} className="st-qb-btn">
                    <ChevronsUp size={14} />
                  </button>
                  <button type="button" onClick={() => raise(spreadIndex, sel[0].id, 'back')} title={t('journey.studio.toBack')} className="st-qb-btn">
                    <ChevronsDown size={14} />
                  </button>
                </>
              )}
              <button type="button" onClick={e => rotateBy(e.shiftKey ? -1 : -15)} title={t('journey.studio.rotateLeft')} className="st-qb-btn">
                <RotateCcw size={14} />
              </button>
              <button type="button" onClick={e => rotateBy(e.shiftKey ? 1 : 15)} title={t('journey.studio.rotateRight')} className="st-qb-btn">
                <RotateCw size={14} />
              </button>
              <span style={{ width: 1, height: 16, background: 'var(--border-primary, #e4e4e7)' }} />
              <button
                type="button"
                className="st-qb-btn"
                onClick={() => commit(d => ({
                  ...d,
                  spreads: d.spreads.map((sp, i) => (i !== spreadIndex ? sp : {
                    ...sp,
                    elements: sp.elements.map(e => (selection.includes(e.id) ? { ...e, locked: !locked } : e)),
                  })),
                }))}
                title={t(locked ? 'journey.studio.unlock' : 'journey.studio.lock')}
              >
                {locked ? <Unlock size={14} /> : <Lock size={14} />}
              </button>
              <span style={{ width: 1, height: 16, background: 'var(--border-primary, #e4e4e7)' }} />
              <button type="button"
                className="st-qb-btn is-danger"
                onClick={() => { const ids = deletable(spread, selection); if (ids.length) removeElements(spreadIndex, ids) }}
                title={t('journey.studio.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })()}

        {guides.map((g, i) => (
          <div
            key={i}
            className="st-guide"
            style={g.axis === 'x'
              ? { position: 'absolute', left: g.at * scaled, top: 0, width: 1, height: '100%', background: '#ec4899' }
              : { position: 'absolute', top: g.at * scaled, left: 0, height: 1, width: '100%', background: '#ec4899' }}
          />
        ))}
      </div>

      <style>{`
        .st-qb-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: none; border-radius: 6px; cursor: pointer; color: var(--text-muted, #52525b); }
        .st-qb-btn:hover { background: var(--bg-hover, #f4f4f5); }
        .st-qb-btn.is-danger:hover { background: #fef2f2; color: #dc2626; }
      `}</style>
    </div>
  )
}

import { useEffect } from 'react'
import type { BookSpread } from '../../types/book'
import { useStudioStore } from '../../store/studioStore'

/**
 * The sheet's keyboard. Ported from liketrek/TREK's
 * client/src/components/Studio/useStudioKeys.ts (same AGPLv3 license).
 *
 * Every shortcut here is one a design tool has taught people already, and none
 * of them takes a key away from the browser while somebody is typing: in a
 * field, a text area or a text being edited on the page, the keys are the
 * field's. Nor from a control that takes the key itself (a row of the layers
 * tree prevents its default). Every action below is one undo step.
 *
 * - Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y: undo and redo.
 * - Delete or Backspace: remove what is selected and not locked.
 * - Ctrl+C: copy elements (Ctrl+V is the native `paste` event, StudioCanvas).
 * - Ctrl+D: duplicate. Ctrl+A: select everything on the page.
 * - Ctrl+G, Ctrl+Shift+G: group and ungroup.
 * - Ctrl+Alt+C, Ctrl+Alt+V: copy and paste style.
 * - Ctrl+] and Ctrl+[: forward and backward, with Shift to the front and back.
 * - Arrows: nudge 1 mm, 10 mm with Shift. Holding one down is one undo step.
 * - Escape inside a group: back to the whole group selected; else deselect.
 * - Page Up / Page Down: the previous / next page.
 *
 * Ctrl is Cmd on a Mac throughout.
 */

const NUDGE_MM = 1
const NUDGE_BIG_MM = 10

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Whether a key press belongs to whatever has the focus rather than to the sheet. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

const deletable = (spread: BookSpread | null, selection: string[]): string[] =>
  (spread?.elements ?? []).filter(e => selection.includes(e.id) && !e.locked).map(e => e.id)

type Store = ReturnType<typeof useStudioStore.getState>

interface Shortcut {
  matches: (e: KeyboardEvent, key: string, store: Store, spread: BookSpread | null) => boolean
  run: (e: KeyboardEvent, store: Store, spreadIndex: number) => void
}

const has = (store: Store) => store.selection.length > 0
const BRACKETS = new Set([']', '[', '}', '{'])

const SHORTCUTS: Shortcut[] = [
  { matches: (e, key) => !e.altKey && key === 'z', run: (e, s) => (e.shiftKey ? s.redo() : s.undo()) },
  { matches: (e, key) => !e.altKey && !e.shiftKey && key === 'y', run: (_e, s) => s.redo() },
  // Ctrl+Alt is AltGr on many keyboards: only the two letters it does not type are taken.
  { matches: (e, key, s) => e.altKey && key === 'c' && has(s), run: (_e, s, i) => s.copyStyle(i) },
  { matches: (e, key, s) => e.altKey && key === 'v' && has(s) && s.styleClip !== null, run: (_e, s, i) => s.pasteStyle(i) },
  { matches: (e, key, s) => !e.altKey && key === 'g' && has(s), run: (e, s, i) => (e.shiftKey ? s.ungroup(i) : s.group(i)) },
  { matches: (e, key, s) => !e.altKey && !e.shiftKey && key === 'd' && has(s), run: (_e, s, i) => s.duplicate(i, s.selection) },
  { matches: (e, key, _s, spread) => !e.altKey && !e.shiftKey && key === 'a' && !!spread?.elements.length, run: (_e, s, i) => s.selectAll(i) },
  {
    matches: (e, _key, s) => !e.altKey && BRACKETS.has(e.key) && has(s),
    run: (e, s, i) => {
      const up = e.key === ']' || e.key === '}'
      const far = up ? 'front' : 'back'
      s.raise(i, s.selection, e.shiftKey ? far : up ? 'forward' : 'backward')
    },
  },
  // Text selected on the page is the browser's to copy, not the book's.
  { matches: (e, key, s) => !e.altKey && key === 'c' && has(s) && !window.getSelection()?.toString(), run: (_e, s, i) => s.copy(i, s.selection) },
]

/** A shortcut with Ctrl (Cmd on a Mac): answers whether it was one of ours. */
function command(e: KeyboardEvent, spreadIndex: number, spread: BookSpread | null): boolean {
  const store = useStudioStore.getState()
  const key = e.key.toLowerCase()
  const hit = SHORTCUTS.find(sc => sc.matches(e, key, store, spread))
  hit?.run(e, store, spreadIndex)
  return !!hit
}

/** The arrow a press is, when it moves the selection: no modifier but Shift, something selected. */
function nudgeOf(e: KeyboardEvent, store: Store): [number, number] | null {
  const arrow = ARROWS[e.key]
  if (!arrow || !store.selection.length || e.ctrlKey || e.metaKey || e.altKey) return null
  const step = e.shiftKey ? NUDGE_BIG_MM : NUDGE_MM
  return [arrow[0] * step, arrow[1] * step]
}

export function useStudioKeys(opts: { spreadIndex: number; editing: boolean }) {
  const { spreadIndex, editing } = opts

  useEffect(() => {
    /** The arrow keys hold one gesture open while any of them is down, so holding one is one undo step. */
    let nudging = false
    const stopNudge = () => {
      if (!nudging) return
      nudging = false
      useStudioStore.getState().endGesture()
    }

    const onKey = (e: KeyboardEvent) => {
      if (editing || e.defaultPrevented || isTypingTarget(e.target)) return
      const store = useStudioStore.getState()
      // Read when the key comes, not when the effect ran: a nudge changes the page.
      const spread = store.doc?.spreads[spreadIndex] ?? null

      if (e.key === 'Escape') {
        if (store.leaveGroup(spreadIndex)) { e.preventDefault(); return }
        if (store.selection.length) { e.preventDefault(); store.select([]) }
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection.length) {
        e.preventDefault()
        const ids = deletable(spread, store.selection)
        if (ids.length) store.removeElements(spreadIndex, ids)
        return
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        const count = store.doc?.spreads.length ?? 0
        if (!count) return
        e.preventDefault()
        const next = spreadIndex + (e.key === 'PageDown' ? 1 : -1)
        if (next >= 0 && next < count) store.setActiveSpread(next)
        return
      }
      const nudge = nudgeOf(e, store)
      if (nudge) {
        e.preventDefault()
        if (store.readOnly) return
        if (!nudging) { nudging = true; store.beginGesture() }
        store.nudge(spreadIndex, nudge[0], nudge[1])
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      if (command(e, spreadIndex, spread)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => { if (ARROWS[e.key]) stopNudge() }

    // On the window as the key bubbles: after every control (React listens on
    // its root, below it) had it, so one that took the key is respected.
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', stopNudge)
    return () => {
      stopNudge()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', stopNudge)
    }
  }, [spreadIndex, editing])
}

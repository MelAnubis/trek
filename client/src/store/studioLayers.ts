import type { BookDocument, BookElement, BookSpread } from '../types/book'
import { elementId } from '../components/Studio/bookIds'
import {
  commonGroup, expandToGroups, gatherGroups, groupElements, groupMembers, isWholeGroup,
  regroupCopies, renameElement, renameGroup, setElementsHidden, tidyGroups, ungroupElements,
  withCopies, withoutGroup,
} from '../components/Studio/bookGroups'
import {
  alignElements, arrangeElements, arrangeWithinGroup, distributableCount, distributeElements,
  type BookAlignEdge, type BookAlignTo, type BookArrangeTo, type BookDistributeAxis,
} from '../components/Studio/bookArrange'
import { bookElementStyle, withPastedStyle, type BookCopiedStyle } from '../components/Studio/bookStyleCopy'

/**
 * Groups, layers and the editor's productivity actions. Ported from
 * liketrek/TREK's client/src/store/studioLayers.ts (same AGPLv3 license).
 *
 * The geometry and the group rules live in bookGroups.ts / bookArrange.ts /
 * bookStyleCopy.ts; what lives here is only how the Studio holds them: which
 * page, what is selected, and one undo step per action.
 */

/** The part of the Studio store these actions read and write. */
interface Host {
  doc: BookDocument | null
  selection: string[]
  enteredGroup: string | null
  styleClip: BookCopiedStyle | null
  commit: (fn: (doc: BookDocument) => BookDocument) => void
  apply: (fn: (doc: BookDocument) => BookDocument) => void
}

type SetFn = (partial: Partial<Host> | ((s: Host) => Partial<Host>)) => void
type GetFn = () => Host

export interface StudioLayerActions {
  /** The group stepped into with a double-click, so a click picks one member rather than the whole group. */
  enteredGroup: string | null
  /** A copied look, for paste style (Ctrl+Alt+C, Ctrl+Alt+V). Kept across pages. */
  styleClip: BookCopiedStyle | null

  /** What a click on an element selects: its whole group, or the element alone inside the group stepped into. */
  pick: (spreadIndex: number, id: string, additive: boolean) => void
  /** A whole group selected, from its row in the layers panel; `additive` adds it. */
  selectGroup: (spreadIndex: number, groupId: string, additive: boolean) => void
  /** Step into an element's group and select the element alone (a double-click). */
  enterGroup: (spreadIndex: number, id: string) => void
  /** Step out of the group again, with the whole group selected (Escape). Answers whether it did. */
  leaveGroup: (spreadIndex: number) => boolean
  /** Every element on the page that is not hidden (Ctrl+A). */
  selectAll: (spreadIndex: number) => void

  /** Move the unlocked part of the selection by millimetres, inside an open gesture (arrow keys). */
  nudge: (spreadIndex: number, dx: number, dy: number) => void
  /** The selection, one group (Ctrl+G). Locked elements stay out of it. */
  group: (spreadIndex: number) => void
  /** Every group in the selection back to its members (Ctrl+Shift+G). */
  ungroup: (spreadIndex: number) => void
  /** The selection lined up; locked elements stay where they are. */
  align: (spreadIndex: number, edge: BookAlignEdge, to: BookAlignTo) => void
  /** The selection spaced evenly, three elements or groups at least. */
  distribute: (spreadIndex: number, axis: BookDistributeAxis) => void
  /** Elements, or whole groups, moved in the paint order. */
  raise: (spreadIndex: number, ids: string | readonly string[], to: BookArrangeTo | 'up' | 'down') => void
  /** Elements dragged to another place in the layers list, in front of (`above`) or behind (`below`) the anchor. */
  restack: (spreadIndex: number, ids: readonly string[], anchorId: string, where: 'above' | 'below', join: boolean) => void
  setHidden: (spreadIndex: number, ids: readonly string[], hidden: boolean) => void
  setLocked: (spreadIndex: number, ids: readonly string[], locked: boolean) => void
  renameLayer: (spreadIndex: number, target: { elementId: string } | { groupId: string }, name: string) => void
  /** Copy the look of the first selected element. */
  copyStyle: (spreadIndex: number) => void
  /** Paste the copied look onto the selection, what each kind can take, as one undo step. */
  pasteStyle: (spreadIndex: number) => void
  /** Copies of the selection beside it, groups copied as new groups, selected. */
  duplicate: (spreadIndex: number, ids: readonly string[]) => void
}

function onSpread(doc: BookDocument, index: number, fn: (s: BookSpread) => BookSpread): BookDocument {
  const spread = doc.spreads[index]
  if (!spread) return doc
  const next = fn(spread)
  if (next === spread) return doc
  const spreads = doc.spreads.slice()
  spreads[index] = next
  return { ...doc, spreads }
}

/** The selected elements on a spread that may change: on the page and unlocked. */
function movable(spread: BookSpread, ids: readonly string[]): BookElement[] {
  return spread.elements.filter(e => ids.includes(e.id) && !e.locked)
}

/** The ids a click on `id` selects, given the group stepped into. */
function clickTarget(spread: BookSpread, id: string, entered: string | null): string[] {
  const el = spread.elements.find(e => e.id === id)
  if (!el) return []
  return el.group && el.group === entered ? [id] : expandToGroups(spread, [id])
}

const OFFSET = 4
const round2 = (v: number) => Math.round(v * 100) / 100

export function studioLayerActions(set: SetFn, get: GetFn): StudioLayerActions {
  const spreadOf = (index: number) => get().doc?.spreads[index]
  const commitOn = (index: number, fn: (s: BookSpread) => BookSpread) => get().commit(doc => onSpread(doc, index, fn))

  return {
    enteredGroup: null,
    styleClip: null,

    pick: (spreadIndex, id, additive) => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      const { selection, enteredGroup } = get()
      const target = clickTarget(spread, id, enteredGroup)
      const el = spread.elements.find(e => e.id === id)
      // A click outside the group stepped into steps out of it.
      const entered = el?.group && el.group === enteredGroup ? enteredGroup : null
      if (additive) {
        const all = target.every(t => selection.includes(t))
        const next = all
          ? selection.filter(s => !target.includes(s))
          : [...selection, ...target.filter(t => !selection.includes(t))]
        set({ selection: next, enteredGroup: entered })
        return
      }
      // Pressing on what is already selected keeps it, so a multi-selection can be dragged.
      if (target.every(t => selection.includes(t))) { set({ enteredGroup: entered }); return }
      set({ selection: target, enteredGroup: entered })
    },

    selectGroup: (spreadIndex, groupId, additive) => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      const ids = groupMembers(spread, groupId).map(e => e.id)
      const selection = get().selection
      set({ selection: additive ? [...selection.filter(s => !ids.includes(s)), ...ids] : ids, enteredGroup: null })
    },

    enterGroup: (spreadIndex, id) => {
      const el = spreadOf(spreadIndex)?.elements.find(e => e.id === id)
      if (!el?.group) return
      set({ selection: [id], enteredGroup: el.group })
    },

    leaveGroup: spreadIndex => {
      const spread = spreadOf(spreadIndex)
      const { enteredGroup } = get()
      if (!spread || !enteredGroup) return false
      set({ selection: expandToGroups(spread, get().selection), enteredGroup: null })
      return true
    },

    selectAll: spreadIndex => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      set({ selection: spread.elements.filter(e => !e.hidden).map(e => e.id), enteredGroup: null })
    },

    nudge: (spreadIndex, dx, dy) => {
      const ids = get().selection
      get().apply(doc => onSpread(doc, spreadIndex, sp => {
        const moving = new Set(movable(sp, ids).map(e => e.id))
        if (!moving.size) return sp
        const elements = sp.elements.map(e =>
          moving.has(e.id) ? { ...e, frame: { ...e.frame, x: round2(e.frame.x + dx), y: round2(e.frame.y + dy) } } : e)
        return { ...sp, elements }
      }))
    },

    group: spreadIndex => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      const ids = movable(spread, get().selection).map(e => e.id)
      if (ids.length < 2 || isWholeGroup(spread, ids)) return
      const groupId = elementId('g')
      commitOn(spreadIndex, sp => groupElements(sp, ids, groupId))
      set({ selection: ids, enteredGroup: null })
    },

    ungroup: spreadIndex => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      const selection = get().selection
      const groups = new Set(spread.elements.filter(e => selection.includes(e.id) && e.group).map(e => e.group as string))
      if (!groups.size) return
      commitOn(spreadIndex, sp => [...groups].reduce((acc, g) => ungroupElements(acc, g), sp))
      set({ enteredGroup: null })
    },

    align: (spreadIndex, edge, to) => {
      const spread = spreadOf(spreadIndex)
      const doc = get().doc
      if (!spread || !doc) return
      const els = movable(spread, get().selection)
      if (!els.length) return
      commitOn(spreadIndex, sp => alignElements(sp, doc.page, els, edge, to))
    },

    distribute: (spreadIndex, axis) => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      const els = movable(spread, get().selection)
      if (distributableCount(spread, els) < 3) return
      commitOn(spreadIndex, sp => distributeElements(sp, els, axis))
    },

    raise: (spreadIndex, ids, to) => {
      const list = typeof ids === 'string' ? [ids] : ids
      const spread = spreadOf(spreadIndex)
      if (!spread || !list.length) return
      const step: BookArrangeTo = to === 'up' ? 'forward' : to === 'down' ? 'backward' : to
      // A group member moved alone inside its group; anything else takes its whole group along.
      const entered = get().enteredGroup
      if (entered !== null && commonGroup(spread, list) === entered) {
        commitOn(spreadIndex, sp => arrangeWithinGroup(sp, entered, list, step))
        return
      }
      const chosen = expandToGroups(spread, list)
      commitOn(spreadIndex, sp => arrangeElements(sp, chosen, step))
    },

    restack: (spreadIndex, ids, anchorId, where, join) => {
      const spread = spreadOf(spreadIndex)
      const anchor = spread?.elements.find(e => e.id === anchorId)
      if (!spread || !anchor || ids.includes(anchorId)) return
      commitOn(spreadIndex, sp => {
        const moving = sp.elements.filter(e => ids.includes(e.id))
        const rest = sp.elements.filter(e => !ids.includes(e.id))
        const at = rest.findIndex(e => e.id === anchorId) + (where === 'above' ? 1 : 0)
        // A whole group dragged keeps itself together; a member dragged alone joins or leaves.
        const whole = new Set(moving
          .filter(e => e.group && groupMembers(sp, e.group).every(m => ids.includes(m.id)))
          .map(e => e.group))
        const placed = moving.map(e => {
          if (join && anchor.group) return { ...e, group: anchor.group }
          if (!e.group || whole.has(e.group)) return e
          return withoutGroup(e)
        })
        const elements = [...rest.slice(0, at), ...placed, ...rest.slice(at)]
        const next = tidyGroups(gatherGroups({ ...sp, elements }))
        return next.elements.every((e, i) => e === sp.elements[i]) && next.groups === sp.groups ? sp : next
      })
    },

    setHidden: (spreadIndex, ids, hidden) => {
      commitOn(spreadIndex, sp => setElementsHidden(sp, ids, hidden))
      // A hidden element cannot be seen to be selected; it leaves the selection.
      if (hidden) set(s => ({ selection: s.selection.filter(id => !ids.includes(id)) }))
    },

    setLocked: (spreadIndex, ids, locked) => commitOn(spreadIndex, sp => ({
      ...sp,
      elements: sp.elements.map(e => (ids.includes(e.id) ? { ...e, locked } : e)),
    })),

    renameLayer: (spreadIndex, target, name) => commitOn(spreadIndex, sp =>
      'groupId' in target ? renameGroup(sp, target.groupId, name) : renameElement(sp, target.elementId, name)),

    copyStyle: spreadIndex => {
      const spread = spreadOf(spreadIndex)
      const selection = get().selection
      // The last one picked is the one the inspector shows, so it is the look people mean.
      const id = selection[selection.length - 1]
      const el = spread?.elements.find(e => e.id === id) ?? spread?.elements.find(e => selection.includes(e.id))
      if (el) set({ styleClip: bookElementStyle(el) })
    },

    pasteStyle: spreadIndex => {
      const { styleClip, selection } = get()
      const spread = spreadOf(spreadIndex)
      if (!styleClip || !spread) return
      const targets = new Set(movable(spread, selection).map(e => e.id))
      if (!targets.size) return
      commitOn(spreadIndex, sp => {
        let changed = false
        const elements = sp.elements.map(e => {
          if (!targets.has(e.id)) return e
          const next = withPastedStyle(e, styleClip)
          if (next !== e) changed = true
          return next
        })
        return changed ? { ...sp, elements } : sp
      })
    },

    duplicate: (spreadIndex, ids) => {
      const spread = spreadOf(spreadIndex)
      if (!spread) return
      const chosen = spread.elements.filter(e => ids.includes(e.id))
      if (!chosen.length) return
      // Offset the copy so it is visibly a second thing rather than an exact overlay.
      const copies = chosen.map(e => ({
        ...e,
        id: elementId(e.kind),
        frame: { ...e.frame, x: e.frame.x + OFFSET, y: e.frame.y + OFFSET },
      }) as BookElement)
      const regrouped = regroupCopies(copies, spread, elementId)
      commitOn(spreadIndex, sp => withCopies(sp, regrouped))
      set({ selection: regrouped.elements.map(e => e.id), enteredGroup: null })
    },
  }
}

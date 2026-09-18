import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookDocument, BookRecord } from '../../types/book'
import { journeyApi } from '../../api/client'
import { addListener, removeListener } from '../../api/websocket'

/**
 * Saving the book. Ported from liketrek/trek's
 * client/src/components/Studio/useBookStore.ts (same AGPLv3 license),
 * adapted to this fork's journeyApi response shape ({ book }, not the
 * record bare) and its plain addListener/removeListener websocket bridge
 * (matches the pattern JourneyDetailPage.tsx already uses for its own
 * `journey:*` events — see its WebSocket real-time updates effect).
 *
 * No client-side `normalizeBookDocument` here (unlike upstream): there is
 * no legacy document format yet to guard against — the server always
 * returns an already-normalized document — so this is deferred until a
 * schema change actually needs it.
 *
 * ── Why autosave rather than a save button ────────────────────────────────
 *
 * The document lives as long as the tab does, which makes every session a
 * race against a closed laptop without it. A save button would fix that and
 * introduce a different failure: the one where you did press it, an hour
 * ago, and cannot remember. Every contributor can edit the same book, so an
 * explicit save would also mean explicit merges.
 *
 * ── Why debounced rather than on every change ─────────────────────────────
 *
 * A drag is hundreds of frames and one edit. The store already models that
 * — a gesture is one undo step — and this follows the same line: quiet for
 * a moment, then write.
 *
 * ── Why a version rather than a lock ─────────────────────────────────────
 *
 * See journeyBookService.ts. A save states which version it was made
 * against, and one that has been overtaken is refused *with* the current
 * record, so the client can say what happened instead of quietly discarding
 * someone's afternoon.
 */

const AUTOSAVE_QUIET_MS = 1200
const AUTOSAVE_MAX_MS = 15_000

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'conflict'; current: BookRecord }
  /** The journey is open to this user, but they may not write it (role 'viewer'). */
  | { status: 'readonly' }
  | { status: 'error' }

export function useBookStore(
  journeyId: number,
  /** Called when another editor's version is taken, with their document. */
  onRemote?: (document: BookDocument) => void,
) {
  const [record, setRecord] = useState<BookRecord | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [state, setState] = useState<SaveState>({ status: 'idle' })

  const version = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  const firstDirtyAt = useRef<number | null>(null)
  const pending = useRef<{ document: BookDocument; title: string } | null>(null)
  const inFlight = useRef(false)
  const lastTitle = useRef('')

  /** The document the server and this client agree on, by identity — see upstream's comment on why identity, not a deep compare. */
  const synced = useRef<BookDocument | null>(null)
  /** The document the editor currently holds, agreed on or not. */
  const latest = useRef<BookDocument | null>(null)

  const hasLocalWork = () =>
    !!pending.current || inFlight.current || (!!latest.current && latest.current !== synced.current)

  /** Set while a conflict is on screen, and nothing is written until it clears. */
  const blocked = useRef(false)

  const onRemoteRef = useRef(onRemote)
  onRemoteRef.current = onRemote

  useEffect(() => {
    if (!Number.isFinite(journeyId)) return
    let cancelled = false
    journeyApi.getBook(journeyId)
      .then((res: { book: BookRecord | null }) => {
        if (cancelled) return
        setRecord(res.book)
        version.current = res.book?.version ?? null
        synced.current = res.book?.document ?? null
        latest.current = res.book?.document ?? null
      })
      .catch(() => { /* A book that will not load is a book that gets created. */ })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [journeyId])

  const write = useCallback(async () => {
    const next = pending.current
    if (!next || inFlight.current || blocked.current) return
    inFlight.current = true
    pending.current = null
    firstDirtyAt.current = null
    setState({ status: 'saving' })

    try {
      const res: { book: BookRecord } = await journeyApi.saveBook(journeyId, {
        title: next.title,
        document: next.document,
        baseVersion: version.current ?? undefined,
      })
      setRecord(res.book)
      version.current = res.book.version
      synced.current = next.document
      setState({ status: 'saved', at: Date.now() })
    } catch (err) {
      // A 409 is not a failure, it is the other person — the current record
      // comes back in the body so the editor can offer to take their
      // version or keep going from here.
      const res = (err as { response?: { status?: number; data?: { current?: BookRecord } } }).response
      if (res?.status === 409 && res.data?.current) {
        blocked.current = true
        setState({ status: 'conflict', current: res.data.current })
      } else if (res?.status === 403) {
        // A viewer can open Studio — the book is part of the journey they
        // were invited to — but the server will not take their writes. Stop
        // trying on the first refusal rather than let someone lay out an
        // entire book before finding out none of it was ever saved.
        blocked.current = true
        setState({ status: 'readonly' })
      } else {
        setState({ status: 'error' })
      }
    } finally {
      inFlight.current = false
      if (pending.current) void write()
    }
  }, [journeyId])

  const queueSave = useCallback((document: BookDocument, title: string) => {
    latest.current = document
    lastTitle.current = title
    if (document === synced.current) return
    pending.current = { document, title }
    if (firstDirtyAt.current == null) firstDirtyAt.current = Date.now()

    if (timer.current != null) window.clearTimeout(timer.current)

    const waited = Date.now() - firstDirtyAt.current
    const delay = waited >= AUTOSAVE_MAX_MS ? 0 : AUTOSAVE_QUIET_MS
    timer.current = window.setTimeout(() => { void write() }, delay)
  }, [write])

  /** Write immediately — for closing the editor, or a save the user asked for. */
  const saveNow = useCallback((document?: BookDocument, title?: string) => {
    if (document) {
      if (title != null) lastTitle.current = title
      pending.current = { document, title: title ?? lastTitle.current }
    }
    if (timer.current != null) window.clearTimeout(timer.current)
    return write()
  }, [write])

  const acceptTheirs = useCallback((current: BookRecord) => {
    blocked.current = false
    setRecord(current)
    version.current = current.version
    synced.current = current.document
    latest.current = current.document
    pending.current = null
    setState({ status: 'idle' })
    return current.document
  }, [])

  /** Keep going from here, on top of their version — rebases, does not merge. */
  const keepMine = useCallback((current: BookRecord) => {
    version.current = current.version
    blocked.current = false
    if (latest.current && latest.current !== synced.current) {
      pending.current = { document: latest.current, title: lastTitle.current }
      void write()
      return
    }
    setState({ status: 'idle' })
  }, [write])

  /** Someone else saved — pull it in, but only when this client has nothing of its own outstanding. */
  useEffect(() => {
    if (!Number.isFinite(journeyId)) return
    let cancelled = false

    const handler = (event: Record<string, unknown>) => {
      if (event.type !== 'journey:book:saved') return
      if (event.journeyId !== journeyId) return
      if (hasLocalWork()) return
      if (typeof event.version === 'number' && event.version === version.current) return

      journeyApi.getBook(journeyId)
        .then((res: { book: BookRecord | null }) => {
          if (cancelled || !res.book) return
          if (hasLocalWork()) return
          setRecord(res.book)
          version.current = res.book.version
          synced.current = res.book.document
          latest.current = res.book.document
          onRemoteRef.current?.(res.book.document)
        })
        .catch(() => { /* The next save will conflict and offer the choice. */ })
    }

    addListener(handler)
    return () => {
      cancelled = true
      removeListener(handler)
    }
  }, [journeyId])

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current)
  }, [])

  return { record, loaded, state, queueSave, saveNow, acceptTheirs, keepMine, version }
}

import { useEffect, useRef, useState } from 'react'
import { linesNow, matchCache, matchTrack, type MatchedLine } from './mapMatch'
import type { TrackPoint } from './trackingModel'

export type MatchStatus = 'off' | 'matching' | 'matched' | 'partial' | 'failed'

/**
 * The track as drawn lines, along the streets and paths when `snap` is on
 * (mapMatch.ts). The cleaned GPS lines show at once and each stretch is
 * replaced as its match comes back. A track that keeps growing (today, live)
 * is matched again `liveDelayMs` after it last changed, and only the stretch
 * that grew is actually asked for — the rest comes from the cache.
 */
export function useMatchedTrack(points: TrackPoint[], snap: boolean, liveDelayMs = 0) {
  const [lines, setLines] = useState<MatchedLine[]>(() => linesNow(points, snap ? matchCache : undefined, snap))
  const [status, setStatus] = useState<MatchStatus>(snap ? 'matching' : 'off')
  /** The track last matched, by its first fix: a new day is matched at once, a growing one after the pause. */
  const lastStart = useRef<string | null>(null)

  useEffect(() => {
    // The plain points straight away, so the map never waits on the router.
    const now = linesNow(points, snap ? matchCache : undefined, snap)
    setLines(now)
    if (!snap || points.length < 2) { setStatus(snap ? 'matched' : 'off'); return }
    // Everything already in the cache: nothing to ask.
    if (now.every(l => l.matched || l.inferred || l.positions.length < 2) && now.filter(l => l.inferred).every(l => l.matched)) { setStatus('matched'); return }
    const controller = new AbortController()
    const start = points[0]?.ts ?? null
    const delay = start === lastStart.current ? liveDelayMs : 0
    lastStart.current = start
    setStatus('matching')
    const timer = window.setTimeout(() => {
      void matchTrack(points, {
        signal: controller.signal,
        cache: matchCache,
        onProgress: partial => { if (!controller.signal.aborted) setLines(partial) },
      }).then(done => {
        if (controller.signal.aborted) return
        setLines(done)
        // A hole's guess is a bonus, not part of what was recorded: it does not count either way.
        const recorded = done.filter(l => !l.inferred)
        const matched = recorded.filter(l => l.matched).length
        const matchable = recorded.filter(l => l.positions.length > 1).length
        setStatus(matched === 0 ? 'failed' : matched < matchable ? 'partial' : 'matched')
      })
    }, delay)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [points, snap, liveDelayMs])

  return { lines, status }
}

/** Every matched line joined, for saving the day as a route along the ways. */
export function joinedLine(lines: MatchedLine[]): [number, number][] {
  return lines.flatMap((l, i) => (i > 0 && lines[i - 1].positions.length && l.positions.length
    && lines[i - 1].positions[lines[i - 1].positions.length - 1].join() === l.positions[0].join() ? l.positions.slice(1) : l.positions))
}

/**
 * How a line is drawn: a recorded one solid when it follows the ways and
 * dashed while it is still the raw fixes; a guessed hole (no fixes at all)
 * fainter and finely dotted, so it never passes for a recording.
 */
export function lineStyle(l: MatchedLine, snap: boolean): { color: string; weight: number; opacity: number; dashArray?: string } {
  if (l.inferred) return { color: l.color, weight: 4, opacity: 0.5, dashArray: '1 8' }
  return { color: l.color, weight: l.matched ? 5 : 4, opacity: l.matched ? 0.9 : 0.75, dashArray: l.matched || !snap ? undefined : '6 6' }
}

import { useRef, useCallback } from 'react'

/**
 * Long press on touch screens: after `ms` without moving, calls `onLongPress`
 * with the touch point and swallows the click that follows (so a card opens
 * its menu instead of navigating). iOS Safari fires no `contextmenu` on a long
 * press, which is why this exists next to onContextMenu.
 */
export function useLongPress(onLongPress: (point: { x: number; y: number }) => void, ms = 500) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    fired.current = false
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      timer.current = null
      if (start.current) onLongPress(start.current)
    }, ms)
  }, [onLongPress, ms, clear])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!start.current || !t) return
    // Scrolling is not a long press.
    if (Math.abs(t.clientX - start.current.x) > 10 || Math.abs(t.clientY - start.current.y) > 10) clear()
  }, [clear])

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false }
  }, [])

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear, onClickCapture }
}

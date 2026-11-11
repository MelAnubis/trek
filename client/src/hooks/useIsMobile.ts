import { useState, useEffect } from 'react'

/** Returns true when the viewport is below the lg breakpoint (1024px). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024,
  )

  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 1023px)')
    if (!mq) return // tests (and very old browsers) may hand back nothing
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    setIsMobile(!!mq.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])

  return isMobile
}

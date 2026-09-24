import { useEffect, useRef, useState } from 'react'
import type { BookDocument } from '../../types/book'
import { SpreadView } from './SpreadView'

/**
 * The Studio book, read-only, for a visitor holding a public share link.
 *
 * Reuses the exact same `SpreadView` tree the editor canvas and the
 * print/export renderer both draw from (see SpreadView.tsx's own comment) —
 * `print` stays on so empty frames vanish the way they would in the printed
 * book, and `publicToken` routes every photo through the token-gated public
 * proxy instead of the authenticated `/api/photos/…` route, since an
 * anonymous visitor carries no session cookie.
 *
 * Unlike the editor or the press output, there is no fixed viewport or sheet
 * layout to fill — this is a plain scrollable stack of pages, each scaled
 * to fit the available width so the book reads top to bottom like a webpage.
 */
export function PublicBookView({ document, publicToken }: { document: BookDocument; publicToken: string }) {
  const { page, spreads } = document
  return (
    <div className="flex flex-col items-center gap-6">
      {spreads.map((spread, i) => {
        const single = spread.role !== 'inner'
        const sheetW = single ? page.pageWidth : page.pageWidth * 2
        return (
          <BookPage key={spread.id} sheetWidth={sheetW} sheetHeight={page.pageHeight}>
            <SpreadView spread={spread} page={page} big print spreadIndex={i} publicToken={publicToken} />
          </BookPage>
        )
      })}
    </div>
  )
}

function BookPage({ sheetWidth, sheetHeight, children }: { sheetWidth: number; sheetHeight: number; children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      // No upper cap here — the container's own `max-w-[900px]` already
      // bounds the width ResizeObserver reports, so capping scale a second
      // time independently of that measured width would decouple it from
      // the height below and squash the page out of its true aspect ratio.
      if (width) setScale(width / sheetWidth)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [sheetWidth])

  return (
    <div
      ref={containerRef}
      className="w-full max-w-[900px] bg-white shadow-md rounded-sm overflow-hidden"
      style={{ height: sheetHeight * scale }}
    >
      <div style={{ width: sheetWidth, height: sheetHeight, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
        {children}
      </div>
    </div>
  )
}

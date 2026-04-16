import { useRef, useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import JourneyMap from './JourneyMap'
import MobileEntryCard from './MobileEntryCard'
import type { JourneyMapHandle } from './JourneyMap'
import type { JourneyEntry } from '../../store/journeyStore'

interface MapEntry {
  id: string
  lat: number
  lng: number
  title?: string | null
  mood?: string | null
  entry_date: string
}

interface Props {
  entries: JourneyEntry[] | any[]
  mapEntries: MapEntry[]
  trail?: { lat: number; lng: number }[]
  dark?: boolean
  readOnly?: boolean
  onEntryClick: (entry: any) => void
  onAddEntry?: () => void
  publicPhotoUrl?: (photoId: number) => string
}

export default function MobileMapTimeline({
  entries,
  mapEntries,
  trail,
  dark,
  readOnly,
  onEntryClick,
  onAddEntry,
  publicPhotoUrl,
}: Props) {
  const mapRef = useRef<JourneyMapHandle>(null)
  const carouselRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Sync map focus when carousel scrolls (with guard for uninitialized map)
  const syncMapToCarousel = useCallback((index: number) => {
    const entry = entries[index]
    if (!entry) return

    const mapEntry = mapEntries.find(m => String(m.id) === String(entry.id))
    if (mapEntry) {
      try { mapRef.current?.focusMarker(String(mapEntry.id)) } catch {}
    } else {
      try { mapRef.current?.highlightMarker(null) } catch {}
    }
  }, [entries, mapEntries])

  // IntersectionObserver for instant snap detection
  useEffect(() => {
    const el = carouselRef.current
    if (!el || entries.length === 0) return

    const observer = new IntersectionObserver(
      (observed) => {
        for (const o of observed) {
          if (o.isIntersecting) {
            const idx = Number(o.target.getAttribute('data-idx'))
            if (!isNaN(idx)) {
              setActiveIndex(idx)
              syncMapToCarousel(idx)
            }
          }
        }
      },
      { root: el, threshold: 0.6 },
    )

    cardRefs.current.forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [entries.length, syncMapToCarousel])

  // Scroll carousel to entry when map marker is clicked
  const handleMarkerClick = useCallback((id: string) => {
    const idx = entries.findIndex((e: any) => String(e.id) === id)
    if (idx === -1) return
    setActiveIndex(idx)

    const el = carouselRef.current
    if (!el) return
    const cardWidth = 272
    el.scrollTo({ left: idx * cardWidth, behavior: 'smooth' })
  }, [entries])

  // Initial map focus — delay to let Leaflet initialize and fitBounds
  useEffect(() => {
    if (entries.length > 0) {
      const timer = setTimeout(() => syncMapToCarousel(0), 500)
      return () => clearTimeout(timer)
    }
  }, [entries.length])

  const activeEntryId = entries[activeIndex]
    ? String(entries[activeIndex].id)
    : null

  if (entries.length === 0) {
    return (
      <div className="fixed inset-0 z-10" style={{ top: 0, bottom: 0 }}>
        <JourneyMap
          ref={mapRef}
          entries={mapEntries}
          checkins={[]}
          trail={trail}
          height={9999}
          dark={dark}
          onMarkerClick={handleMarkerClick}
          fullScreen
        />
        {!readOnly && onAddEntry && (
          <div className="fixed top-[calc(var(--nav-h,56px)+12px)] right-4 z-30">
            <button
              onClick={onAddEntry}
              className="w-10 h-10 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            >
              <Plus size={18} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-10" style={{ top: 0, bottom: 0 }}>
      {/* Full-screen map */}
      <JourneyMap
        ref={mapRef}
        entries={mapEntries}
        checkins={[]}
        trail={trail}
        height={9999}
        dark={dark}
        activeMarkerId={activeEntryId}
        onMarkerClick={handleMarkerClick}
        fullScreen
        paddingBottom={200}
      />

      {/* Bottom carousel */}
      <div
        className="fixed bottom-20 left-0 right-0 z-40"
        style={{ touchAction: 'pan-x' }}
      >
        <div
          ref={carouselRef}
          className="flex gap-3 overflow-x-auto px-4 pb-3 pt-1 scroll-smooth"
          style={{
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {entries.map((entry: any, i: number) => (
            <div
              key={entry.id}
              data-idx={i}
              ref={node => { if (node) cardRefs.current.set(i, node); else cardRefs.current.delete(i); }}
              style={{ scrollSnapAlign: 'center' }}
            >
              <MobileEntryCard
                entry={entry}
                index={i}
                isActive={i === activeIndex}
                onClick={() => onEntryClick(entry)}
                publicPhotoUrl={publicPhotoUrl}
              />
            </div>
          ))}
        </div>
      </div>

      {/* FAB: add entry — top right */}
      {!readOnly && onAddEntry && (
        <div className="fixed top-[calc(var(--nav-h,56px)+12px)] right-4 z-30">
          <button
            onClick={onAddEntry}
            className="w-10 h-10 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          >
            <Plus size={18} />
          </button>
        </div>
      )}
    </div>
  )
}

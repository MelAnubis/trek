import { Navigation, LocateFixed, Locate } from 'lucide-react'
import type { TrackingMode } from '../../hooks/useGeolocation'

interface Props {
  mode: TrackingMode
  error: string | null
  onClick: () => void
  // Offset from the bottom edge — callers push this up above the mobile
  // bottom nav. Defaults to 20px for desktop.
  bottomOffset?: number
}

// Three-state FAB. Matches the Apple/Google Maps pattern:
//   off    → outline locate icon
//   show   → filled locate (blue dot is visible on the map)
//   follow → filled navigation arrow (map follows + rotates with heading)
export default function LocationButton({ mode, error, onClick, bottomOffset = 20 }: Props) {
  const Icon = mode === 'follow' ? Navigation : mode === 'show' ? LocateFixed : Locate
  const isActive = mode !== 'off'
  const title = error
    ? error
    : mode === 'off'
      ? 'Show my location'
      : mode === 'show'
        ? 'Follow my location'
        : 'Stop following'

  return (
    <button className="!absolute !z-[1000] !w-[42px] !h-[42px] !rounded-[50%] ![border:none] !cursor-pointer ![box-shadow:0_2px_10px_rgba(0,0,0,0.25)] !flex !items-center !justify-center ![transition:background_0.2s,_color_0.2s]"
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ bottom: bottomOffset, right: 12, background: isActive ? '#3b82f6' : 'var(--bg-card, white)', color: isActive ? 'white' : (error ? '#ef4444' : 'var(--text-muted, #6b7280)') }}
    >
      <Icon size={20} strokeWidth={mode === 'follow' ? 2.5 : 2} />
    </button>
  )
}

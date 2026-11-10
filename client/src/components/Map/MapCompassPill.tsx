import { useEffect, useState } from 'react'
import { Navigation } from 'lucide-react'
import type mapboxgl from 'mapbox-gl'

/**
 * Round compass pill for the Mapbox planner map. The Mapbox map can be rotated and
 * pitched, so this shows the current bearing (the arrow points to north) and snaps
 * the camera back to north + flat on click. Rendered next to the POI "explore" pill
 * (Mapbox only) and built as the SAME frosted shell (padding 4 around a 34px button)
 * so its height and transparency match the POI pill exactly.
 */
export function MapCompassPill({ map }: { map: mapboxgl.Map }) {
  const [bearing, setBearing] = useState(() => map.getBearing())

  useEffect(() => {
    const update = () => setBearing(map.getBearing())
    update()
    map.on('rotate', update)
    return () => { map.off('rotate', update) }
  }, [map])

  return (
    <div className="!inline-flex !items-center !p-[4px] !rounded-[999px] !pointer-events-auto ![background:var(--sidebar-bg)] ![backdrop-filter:blur(20px)_saturate(180%)] ![-webkit-backdrop-filter:blur(20px)_saturate(180%)] ![box-shadow:var(--sidebar-shadow,_0_4px_16px_rgba(0,0,0,0.14))]">
      <button
        type="button"
        onClick={() => map.easeTo({ bearing: 0, pitch: 0, duration: 300 })}
        aria-label="Reset north"
        className="trek-hover text-content-muted !inline-flex !items-center !justify-center !w-[34px] !h-[34px] !rounded-[999px] ![border:none] !cursor-pointer ![background:transparent] !p-[0] ![transition:background_0.14s,_color_0.14s]" >
        <Navigation size={16} strokeWidth={2} style={{ transform: `rotate(${-bearing}deg)`, transition: 'transform 0.1s linear' }} />
      </button>
    </div>
  )
}

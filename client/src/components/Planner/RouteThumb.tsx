import React, { useMemo } from 'react'
import { projectPreview, type PreviewPoint } from '../../utils/plannerLibrary'

const W = 200
const H = 120

/** Silueta vectorial de la ruta: instantánea, sin teselas ni peticiones externas. */
export default function RouteThumb({ preview, color }: { preview: PreviewPoint[]; color: string }) {
  const path = useMemo(() => projectPreview(preview, W, H, 14), [preview])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
      style={{ display: 'block' }}>
      {/* rejilla suave que recuerda a un mapa */}
      <g stroke="currentColor" strokeOpacity="0.07" strokeWidth="1">
        {[30, 60, 90].map(y => <line key={`h${y}`} x1="0" y1={y} x2={W} y2={y} />)}
        {[50, 100, 150].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2={H} />)}
      </g>
      {path && (
        <>
          <path d={path.d} fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path.d} fill="none" stroke={color} strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={path.start[0]} cy={path.start[1]} r="4.5" fill="#22c55e" stroke="#fff" strokeWidth="1.6" />
          <circle cx={path.end[0]} cy={path.end[1]} r="4.5" fill="#ef4444" stroke="#fff" strokeWidth="1.6" />
        </>
      )}
    </svg>
  )
}

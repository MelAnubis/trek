import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

export interface ArrowSpec {
  lat: number
  lng: number
  /** Ángulo en pantalla, en grados, en sentido horario (0 = hacia la derecha). */
  angle: number
}

/**
 * Flechas de dirección a lo largo de una polilínea, colocadas cada `spacingPx` píxeles de PANTALLA y solo en lo
 * que se ve. Recibe puntos ya proyectados para poder probarse sin mapa.
 */
export function computeArrows(
  pts: { x: number; y: number; lat: number; lng: number; inView: boolean }[],
  spacingPx: number,
  offsetPx = 0,
  minLookPx = 8,
): { x: number; y: number; angle: number; i: number }[] {
  const out: { x: number; y: number; angle: number; i: number }[] = []
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y)
  let acc = spacingPx / 2           // la primera flecha a media separación del inicio del tramo visible
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    if (!a.inView && !b.inView) { acc = spacingPx / 2; continue }
    acc += dist(a, b)
    if (acc < spacingPx) continue
    // Dirección: del último punto anterior a ≥ minLookPx hasta el primero posterior a ≥ minLookPx (evita el
    // ruido de puntos casi superpuestos).
    let k = i, j = i
    while (k > 0 && dist(pts[k], b) < minLookPx) k--
    while (j < pts.length - 1 && dist(pts[j], b) < minLookPx) j++
    const dx = pts[j].x - pts[k].x, dy = pts[j].y - pts[k].y
    if (Math.hypot(dx, dy) < 1) continue
    const angle = Math.atan2(dy, dx) * 180 / Math.PI
    // Desplazamiento a la derecha del sentido de marcha: en una ida y vuelta las dos flechas no se pisan.
    const rad = angle * Math.PI / 180
    out.push({ x: b.x - Math.sin(rad) * offsetPx, y: b.y + Math.cos(rad) * offsetPx, angle, i })
    acc = 0
  }
  return out
}

const iconCache = new Map<string, L.DivIcon>()

function arrowIcon(angle: number, color: string, size: number): L.DivIcon {
  const a = Math.round(angle / 6) * 6
  const key = `${a}|${color}|${size}`
  let icon = iconCache.get(key)
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;transform:rotate(${a}deg);pointer-events:none">`
        + `<svg viewBox="0 0 20 20" width="${size}" height="${size}" style="display:block;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.55))">`
        + `<path d="M3 3 L18 10 L3 17 L7 10 Z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
    if (iconCache.size > 400) iconCache.clear()
    iconCache.set(key, icon)
  }
  return icon
}

interface Props {
  positions: [number, number][]
  color: string
  opacity?: number
  spacingPx?: number
  size?: number
}

/** Dibuja el sentido de recorrido de una polilínea con flechas que se recalculan al hacer zoom o mover el mapa. */
export default function ArrowLayer({ positions, color, opacity = 1, spacingPx = 90, size = 16 }: Props) {
  const map = useMap()
  const [tick, setTick] = useState(0)
  useMapEvents({ zoomend: () => setTick(t => t + 1), moveend: () => setTick(t => t + 1), resize: () => setTick(t => t + 1) })
  // La primera vez el mapa puede no tener aún tamaño: se recalcula tras el primer pintado.
  useEffect(() => { const id = requestAnimationFrame(() => setTick(t => t + 1)); return () => cancelAnimationFrame(id) }, [positions])

  const compute = useCallback((): ArrowSpec[] => {
    if (positions.length < 2) return []
    const bounds = map.getBounds().pad(0.15)
    const pts = positions.map(([lat, lng]) => {
      const p = map.latLngToLayerPoint([lat, lng])
      return { x: p.x, y: p.y, lat, lng, inView: bounds.contains([lat, lng]) }
    })
    return computeArrows(pts, spacingPx, 4).map(a => {
      const ll = map.layerPointToLatLng([a.x, a.y])
      return { lat: ll.lat, lng: ll.lng, angle: a.angle }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, map, spacingPx, tick])

  const arrows = useMemo(compute, [compute])
  return (
    <>
      {arrows.map((a, i) => (
        <Marker key={`${i}-${Math.round(a.lat * 1e5)}`} position={[a.lat, a.lng]} icon={arrowIcon(a.angle, color, size)}
          interactive={false} keyboard={false} opacity={opacity} zIndexOffset={-100} />
      ))}
    </>
  )
}

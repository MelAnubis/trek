import { describe, it, expect } from 'vitest'
import { computeArrows } from './ArrowLayer'

/** Recta horizontal de `n` puntos cada `step` px, empezando en (x0, y0). */
const rowPts = (n: number, step = 10, x0 = 0, y0 = 100, dir = 1, inView = true) =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + dir * i * step, y: y0, lat: 0, lng: 0, inView }))

describe('computeArrows', () => {
  it('coloca una flecha cada spacingPx de pantalla (la primera a media separación)', () => {
    const a = computeArrows(rowPts(41), 100)                 // 400 px de recorrido
    expect(a.map(x => Math.round(x.x))).toEqual([50, 150, 250, 350])
  })

  it('apunta en el sentido de marcha: este = 0°, oeste = 180°, sur (y crece) = 90°, norte = −90°', () => {
    expect(computeArrows(rowPts(30), 100)[0].angle).toBeCloseTo(0, 5)
    expect(Math.abs(computeArrows(rowPts(30, 10, 300, 100, -1), 100)[0].angle)).toBeCloseTo(180, 5)
    const south = Array.from({ length: 30 }, (_, i) => ({ x: 50, y: i * 10, lat: 0, lng: 0, inView: true }))
    expect(computeArrows(south, 100)[0].angle).toBeCloseTo(90, 5)
    const north = Array.from({ length: 30 }, (_, i) => ({ x: 50, y: 300 - i * 10, lat: 0, lng: 0, inView: true }))
    expect(computeArrows(north, 100)[0].angle).toBeCloseTo(-90, 5)
  })

  it('en una ida y vuelta las flechas de cada sentido quedan a su derecha y no se pisan', () => {
    const out = computeArrows(rowPts(30, 10, 0, 100, 1), 100, 4)[0]
    const back = computeArrows(rowPts(30, 10, 290, 100, -1), 100, 4)[0]
    expect(out.y).toBeCloseTo(104, 5)        // yendo al este, la derecha es hacia abajo en pantalla (y +)
    expect(back.y).toBeCloseTo(96, 5)        // yendo al oeste, hacia arriba
    expect(Math.abs(out.y - back.y)).toBeGreaterThanOrEqual(8)
  })

  it('no dibuja nada fuera de la vista y empieza de nuevo al volver a entrar', () => {
    expect(computeArrows(rowPts(41, 10, 0, 100, 1, false), 100)).toEqual([])
    const mixed = [...rowPts(20, 10, 0, 100, 1, false), ...rowPts(30, 10, 200, 100, 1, true)]
    const a = computeArrows(mixed, 100)
    expect(a.length).toBeGreaterThan(0)
    expect(a.every(x => x.x >= 190)).toBe(true)
  })

  it('ignora el ruido de puntos casi superpuestos al calcular la dirección', () => {
    const pts = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }, { x: 80.2, y: 0.4 }, { x: 80.1, y: 0.1 }, { x: 120, y: 0 }, { x: 200, y: 0 }]
      .map(p => ({ ...p, lat: 0, lng: 0, inView: true }))
    const a = computeArrows(pts, 80)
    expect(a.length).toBeGreaterThan(0)
    a.forEach(x => expect(Math.abs(x.angle)).toBeLessThan(15))
  })

  it('tramos sin recorrido o con un solo punto no producen flechas', () => {
    expect(computeArrows([], 100)).toEqual([])
    expect(computeArrows(rowPts(1), 100)).toEqual([])
    expect(computeArrows(rowPts(5, 0), 100)).toEqual([])
  })
})

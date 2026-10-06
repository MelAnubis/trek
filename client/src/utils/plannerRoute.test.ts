import { describe, it, expect } from 'vitest'
import {
  parseRouteFile, cumulativeKm, simplifyPoints, simplifyLine, smoothElevation, gainLoss,
  autoSplit, buildStages, normalizeCuts, indexAtKm, nearestOnRoute, stageIndexOfPoint,
  buildGpx, buildStageGpx, waypointsForStage, xmlEscape, safeFileName, bookingSearchUrl, googleMapsHotelsUrl, addDaysIso, nightOfStage, type RoutePoint, type PlannerWaypoint,
} from './plannerRoute'

// Ruta recta hacia el norte: 0,01° de latitud ≈ 1,11 km por punto.
function line(n: number, ele: (i: number) => number | null = () => 100): RoutePoint[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 40 + i * 0.01, lng: -3, ele: ele(i) }))
}

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Meta</name></metadata>
  <wpt lat="40.05" lon="-3.0"><ele>700</ele><name>Fuente &amp; bar</name></wpt>
  <trk><name>Mi ruta</name><trkseg>
    <trkpt lat="40.0" lon="-3.0"><ele>600</ele></trkpt>
    <trkpt lat="40.1" lon="-3.0"><ele>650.5</ele></trkpt>
    <trkpt lat="40.2" lon="-3.0"></trkpt>
  </trkseg></trk>
</gpx>`

const KML = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>
  <Placemark><name>Tramo</name><LineString><coordinates>
    -3.0,40.0,600 -3.0,40.1,650 -3.0,40.2,700
  </coordinates></LineString></Placemark>
  <Placemark><name>Hotel</name><Point><coordinates>-3.0,40.1,0</coordinates></Point></Placemark>
</Document></kml>`

describe('parseRouteFile', () => {
  it('lee un GPX con track, altitudes y waypoints', () => {
    const r = parseRouteFile(GPX, 'x.gpx')
    expect(r.name).toBe('Mi ruta')
    expect(r.points).toHaveLength(3)
    expect(r.points[1]).toEqual({ lat: 40.1, lng: -3, ele: 650.5 })
    expect(r.points[2].ele).toBeNull()
    expect(r.waypoints).toHaveLength(1)
    expect(r.waypoints[0].name).toBe('Fuente & bar')
    expect(r.waypoints[0].ele).toBe(700)
  })

  it('usa rtept si no hay trkpt', () => {
    const rte = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2"/></rte></gpx>`
    expect(parseRouteFile(rte, 'r.gpx').points).toHaveLength(2)
  })

  it('lee KML: LineString como track y Point como waypoint (lon,lat,alt)', () => {
    const r = parseRouteFile(KML, 'k.kml')
    expect(r.name).toBe('Tramo')
    expect(r.points).toHaveLength(3)
    expect(r.points[0]).toEqual({ lat: 40, lng: -3, ele: 600 })
    expect(r.waypoints).toHaveLength(1)
    expect(r.waypoints[0].name).toBe('Hotel')
  })

  it('usa el nombre del fichero si no hay nombre', () => {
    const r = parseRouteFile(`<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg></trk></gpx>`, 'camino.gpx')
    expect(r.name).toBe('camino')
  })

  it('rechaza XML roto y formatos desconocidos', () => {
    expect(() => parseRouteFile('<gpx><trk>', 'a.gpx')).toThrow('invalid-xml')
    expect(() => parseRouteFile('<html></html>', 'a.gpx')).toThrow('unsupported-format')
  })

  it('ignora coordenadas fuera de rango', () => {
    const bad = `<gpx><trk><trkseg><trkpt lat="95" lon="0"/><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`
    expect(parseRouteFile(bad, 'b.gpx').points).toHaveLength(1)
  })
})

describe('distancias y simplificación', () => {
  it('cumulativeKm acumula distancia', () => {
    const cum = cumulativeKm(line(11))
    expect(cum[0]).toBe(0)
    expect(cum[10]).toBeGreaterThan(11)
    expect(cum[10]).toBeLessThan(11.2)
  })

  it('simplifyPoints descarta puntos muy próximos y conserva extremos', () => {
    const dense: RoutePoint[] = Array.from({ length: 1000 }, (_, i) => ({ lat: 40 + i * 0.000005, lng: -3, ele: 10 }))
    const out = simplifyPoints(dense, 5)
    expect(out.length).toBeLessThan(200)
    expect(out[0].lat).toBeCloseTo(40, 5)
    expect(out[out.length - 1].lat).toBeCloseTo(dense[999].lat, 4)
  })

  it('simplifyPoints respeta maxPoints', () => {
    expect(simplifyPoints(line(500), 0, 100)).toHaveLength(100)
  })

  it('simplifyLine limita puntos y mantiene extremos', () => {
    const zig: RoutePoint[] = Array.from({ length: 2000 }, (_, i) => ({ lat: 40 + i * 0.001, lng: -3 + (i % 2) * 0.001, ele: null }))
    const out = simplifyLine(zig, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out[0]).toEqual([zig[0].lat, zig[0].lng])
    expect(out[out.length - 1]).toEqual([zig[1999].lat, zig[1999].lng])
  })

  it('simplifyLine no toca líneas cortas', () => {
    expect(simplifyLine(line(10), 300)).toHaveLength(10)
  })
})

describe('elevación', () => {
  it('suaviza el ruido y no lo cuenta como desnivel', () => {
    // Puntos cada ~5,5 m (como tras simplifyPoints) con ruido ±2 m y sin subida real.
    const pts: RoutePoint[] = Array.from({ length: 400 }, (_, i) => ({ lat: 40 + i * 0.00005, lng: -3, ele: 500 + (i % 2 ? 2 : -2) }))
    const cum = cumulativeKm(pts)
    const sm = smoothElevation(pts, cum)
    expect(gainLoss(sm, 0, pts.length - 1).gain).toBe(0)
  })

  it('cuenta una subida real', () => {
    const pts = line(100, i => 100 + i * 5) // +495 m
    const cum = cumulativeKm(pts)
    const { gain, loss } = gainLoss(smoothElevation(pts, cum), 0, 99)
    expect(gain).toBeGreaterThan(450)
    expect(gain).toBeLessThan(500)
    expect(loss).toBe(0)
  })

  it('interpola huecos y devuelve null si no hay altitud', () => {
    const noEle = line(5, () => null)
    expect(smoothElevation(noEle, cumulativeKm(noEle)).every(v => v === null)).toBe(true)
    const gaps = line(5, i => (i === 2 ? null : 100))
    expect(smoothElevation(gaps, cumulativeKm(gaps)).every(v => v === 100)).toBe(true)
  })
})

describe('etapas', () => {
  const pts = line(101) // ≈ 111 km
  const cum = cumulativeKm(pts)
  const sm = smoothElevation(pts, cum)

  it('indexAtKm encuentra el punto más cercano', () => {
    const i = indexAtKm(cum, 55.5)
    expect(Math.abs(cum[i] - 55.5)).toBeLessThan(0.6)
    expect(indexAtKm(cum, -5)).toBe(0)
    expect(indexAtKm(cum, 9999)).toBe(100)
  })

  it('autoSplit reparte en etapas iguales', () => {
    const cuts = autoSplit(cum, 37) // 111/37 = 3 etapas
    expect(cuts).toHaveLength(2)
    const stages = buildStages(cum, sm, cuts, i => `E${i + 1}`)
    expect(stages).toHaveLength(3)
    for (const s of stages) expect(s.distKm).toBeGreaterThan(36)
    expect(stages.map(s => s.name)).toEqual(['E1', 'E2', 'E3'])
  })

  it('autoSplit con km mayor que la ruta no corta', () => {
    expect(autoSplit(cum, 500)).toEqual([])
    expect(autoSplit(cum, 0)).toEqual([])
  })

  it('las etapas son contiguas y suman la distancia total', () => {
    const stages = buildStages(cum, sm, [{ index: 30 }, { index: 70 }], i => `E${i + 1}`)
    expect(stages[0].to).toBe(stages[1].from)
    expect(stages[1].to).toBe(stages[2].from)
    expect(stages.reduce((s, x) => s + x.distKm, 0)).toBeCloseTo(cum[100], 6)
  })

  it('el nombre de un corte se aplica a la etapa que abre', () => {
    const stages = buildStages(cum, sm, [{ index: 50, name: 'Segunda' }], i => `E${i + 1}`)
    expect(stages[1].name).toBe('Segunda')
  })

  it('normalizeCuts ordena, quita duplicados y fuera de rango', () => {
    expect(normalizeCuts([{ index: 70 }, { index: 30 }, { index: 30 }, { index: 0 }, { index: 100 }, { index: 500 }], 101))
      .toEqual([{ index: 30 }, { index: 70 }])
  })

  it('stageIndexOfPoint asigna los límites a la etapa siguiente salvo en el final', () => {
    const stages = buildStages(cum, sm, [{ index: 50 }], i => `E${i}`)
    expect(stageIndexOfPoint(stages, 10)).toBe(0)
    expect(stageIndexOfPoint(stages, 50)).toBe(1)
    expect(stageIndexOfPoint(stages, 100)).toBe(1)
  })
})

describe('etapas con alojamiento', () => {
  const pts = line(101)
  const cum = cumulativeKm(pts)
  const sm = smoothElevation(pts, cum)

  it('cada etapa expone si su corte final tiene alojamiento y cuánto se movió; la última no tiene corte', () => {
    const stages = buildStages(cum, sm, [{ index: 30, lodged: true, shiftKm: -3.2 }, { index: 70, lodged: false }, ], i => `E${i + 1}`)
    expect(stages).toHaveLength(3)
    expect(stages[0].endLodged).toBe(true)
    expect(stages[0].endShiftKm).toBe(-3.2)
    expect(stages[1].endLodged).toBe(false)
    expect(stages[2].endLodged).toBeUndefined()
  })

  it('las etapas que terminan en una población (sin alojamiento mapeado) lo indican, con su nombre', () => {
    const stages = buildStages(cum, sm, [{ index: 40, town: true, place: 'Béjar', shiftKm: 4.2, unchecked: true }, { index: 80, lodged: true, place: 'Guijuelo' }], i => `E${i + 1}`)
    expect(stages[0]).toMatchObject({ endTown: true, endPlace: 'Béjar', endShiftKm: 4.2, endUnchecked: true })
    expect(stages[1]).toMatchObject({ endLodged: true, endPlace: 'Guijuelo' })
    expect(stages[1].endTown).toBeUndefined()
  })

  it('los cortes sin comprobar no inventan información, y normalizeCuts conserva los flags', () => {
    const stages = buildStages(cum, sm, [{ index: 50 }], i => `E${i + 1}`)
    expect(stages[0].endLodged).toBeUndefined()
    expect(normalizeCuts([{ index: 70, lodged: true }, { index: 30, shiftKm: 2 }], 101)).toEqual([{ index: 30, shiftKm: 2 }, { index: 70, lodged: true }])
  })
})

describe('nearestOnRoute', () => {
  const pts = line(101)
  const cum = cumulativeKm(pts)
  it('encuentra el punto y la distancia lateral', () => {
    const r = nearestOnRoute(pts, cum, 40.5, -3 + 0.01) // ~850 m al este de lat 40.5
    expect(r.index).toBe(50)
    expect(r.distM).toBeGreaterThan(800)
    expect(r.distM).toBeLessThan(900)
    expect(r.km).toBeCloseTo(cum[50], 6)
  })
})

describe('GPX de salida', () => {
  const pts = line(101)
  const cum = cumulativeKm(pts)
  const sm = smoothElevation(pts, cum)
  const wps: PlannerWaypoint[] = [
    { id: 'a', name: 'Fuente <1>', lat: 40.1, lng: -3, ele: 123, type: 'water' },
    { id: 'b', name: 'Hotel', lat: 40.9, lng: -3, ele: null, type: 'hotel', note: 'Reservado "ya"' },
  ]

  it('escapa XML y se puede volver a leer', () => {
    const xml = buildGpx({ name: 'A & B', points: pts.slice(0, 5), waypoints: wps })
    expect(xml).toContain('A &amp; B')
    expect(xml).toContain('Fuente &lt;1&gt;')
    const back = parseRouteFile(xml, 'x.gpx')
    expect(back.points).toHaveLength(5)
    expect(back.waypoints.map(w => w.name)).toEqual(['Fuente <1>', 'Hotel'])
    expect(back.name).toBe('A & B')
  })

  it('reparte los waypoints por etapa', () => {
    const stages = buildStages(cum, sm, [{ index: 50 }], i => `E${i + 1}`)
    expect(waypointsForStage(pts, cum, stages, 0, wps).map(w => w.id)).toEqual(['a'])
    expect(waypointsForStage(pts, cum, stages, 1, wps).map(w => w.id)).toEqual(['b'])
    const xml = buildStageGpx('Ruta', pts, cum, stages, 1, wps)
    expect(parseRouteFile(xml, 'e.gpx').points).toHaveLength(stages[1].to - stages[1].from + 1)
    expect(xml).toContain('Ruta — E2')
  })

  it('helpers', () => {
    expect(xmlEscape(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;')
    expect(safeFileName('Camino de Santiago: etapa 1/3')).toBe('Camino_de_Santiago_etapa_1_3')
    expect(safeFileName('???')).toBe('ruta')
  })
})

describe('enlaces para comprobar el alojamiento', () => {
  it('Booking: busca la población (con tildes y espacios codificados) en el idioma del usuario', () => {
    expect(bookingSearchUrl('Béjar', 'es-ES')).toBe('https://www.booking.com/searchresults.html?ss=B%C3%A9jar&lang=es')
    expect(bookingSearchUrl('Ciudad Rodrigo & más', 'en')).toBe('https://www.booking.com/searchresults.html?ss=Ciudad%20Rodrigo%20%26%20m%C3%A1s&lang=en-gb')
    expect(bookingSearchUrl('X', 'fr')).toContain('lang=en-gb')
  })

  it('Google Maps: hoteles alrededor de las coordenadas del final de la etapa', () => {
    expect(googleMapsHotelsUrl(40.3861, -5.7571)).toBe('https://www.google.com/maps/search/hotel/@40.38610,-5.75710,14z')
  })

  it('la fuente del alojamiento llega a la etapa', () => {
    const pts = line(101), cum = cumulativeKm(pts), sm = smoothElevation(pts, cum)
    const st = buildStages(cum, sm, [{ index: 50, lodged: true, source: 'google' }], i => `E${i + 1}`)
    expect(st[0].endSource).toBe('google')
  })
})

describe('fechas de las noches para Booking', () => {
  it('addDaysIso suma días respetando meses y años, y rechaza fechas que no existen', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysIso('2026-02-30', 1)).toBeNull()
    expect(addDaysIso('12/10/2026', 1)).toBeNull()
    expect(addDaysIso('', 1)).toBeNull()
  })

  it('la noche de cada etapa: la 1ª termina el día de salida y se duerme esa noche', () => {
    expect(nightOfStage('2026-10-12', 0)).toEqual({ checkin: '2026-10-12', checkout: '2026-10-13' })
    expect(nightOfStage('2026-10-12', 3)).toEqual({ checkin: '2026-10-15', checkout: '2026-10-16' })
    expect(nightOfStage(undefined, 0)).toBeUndefined()
    expect(nightOfStage('no-es-fecha', 0)).toBeUndefined()
  })

  it('el enlace de Booking lleva las fechas solo cuando hay fecha de salida', () => {
    expect(bookingSearchUrl('Béjar', 'es', { checkin: '2026-10-12', checkout: '2026-10-13' }))
      .toBe('https://www.booking.com/searchresults.html?ss=B%C3%A9jar&lang=es&checkin=2026-10-12&checkout=2026-10-13&group_adults=1&no_rooms=1')
    expect(bookingSearchUrl('Béjar', 'es')).not.toContain('checkin')
  })
})

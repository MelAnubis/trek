import { describe, it, expect } from 'vitest'
import { localityFromPlace, dayLocality, parseBookingUrl, nightsBetween, kmBetween } from './lodgingLinks'
import { bookingSearchUrl } from './plannerRoute'

const place = (name: string, address: string | null) => ({ name, address } as any)
const assignment = (order_index: number, p: any) => ({ id: order_index, day_id: 1, order_index, notes: null, place: p } as any)

describe('localityFromPlace', () => {
  it('toma la población que lleva el código postal y conserva provincia y país para no confundirla', () => {
    expect(localityFromPlace(place('Alcaudete', '23660 Alcaudete, Jaén, España'))).toEqual({ name: 'Alcaudete', search: 'Alcaudete, Jaén, España' })
    expect(localityFromPlace(place('Bar Paco', 'Calle Real 12, 14850 Baena, Córdoba, España'))).toEqual({ name: 'Baena', search: 'Baena, Córdoba, España' })
  })

  it('direcciones sin código postal: la primera parte, o lo que sigue a una calle con número', () => {
    expect(localityFromPlace(place('Jaén', 'Jaén, España'))).toEqual({ name: 'Jaén', search: 'Jaén, España' })
    expect(localityFromPlace(place('Casa', 'Calle Mayor 3, Cabra, Córdoba'))).toEqual({ name: 'Cabra', search: 'Cabra, Córdoba' })
  })

  it('sin dirección usa el nombre; sin nada, null', () => {
    expect(localityFromPlace(place('  Zuheros ', null))).toEqual({ name: 'Zuheros', search: 'Zuheros' })
    expect(localityFromPlace(place('', ''))).toBeNull()
    expect(localityFromPlace(null)).toBeNull()
  })
})

describe('dayLocality', () => {
  it('con varios lugares en el día, la localidad es la del ÚLTIMO (por orden, no por posición en el array)', () => {
    const day = { title: 'Día 2', assignments: [
      assignment(2, place('Alcaudete', '23660 Alcaudete, Jaén, España')),
      assignment(1, place('Martos', '23600 Martos, Jaén, España')),
    ] }
    expect(dayLocality(day)?.name).toBe('Alcaudete')
  })

  it('si el último lugar no sirve se baja al anterior; sin lugares usa el título del día', () => {
    const day = { title: 'Día 3', assignments: [assignment(1, place('Zuheros', 'Zuheros, Córdoba, España')), assignment(2, place('', ''))] }
    expect(dayLocality(day)?.name).toBe('Zuheros')
    expect(dayLocality({ title: 'Priego de Córdoba', assignments: [] })).toEqual({ name: 'Priego de Córdoba', search: 'Priego de Córdoba' })
    expect(dayLocality({ title: null, assignments: [] })).toBeNull()
    expect(dayLocality(null)).toBeNull()
  })
})

describe('parseBookingUrl', () => {
  it('propone el nombre desde el texto de la URL y lee fechas y adultos si vienen', () => {
    const r = parseBookingUrl('https://www.booking.com/hotel/es/hotel-sercotel-alcaudete.es.html?checkin=2026-10-18&checkout=2026-10-19&group_adults=2&no_rooms=1')
    expect(r).toEqual({ valid: true, name: 'Hotel Sercotel Alcaudete', checkin: '2026-10-18', checkout: '2026-10-19', adults: 2 })
  })

  it('acepta variantes de idioma y de dominio de Booking, y respeta tildes codificadas', () => {
    expect(parseBookingUrl('https://secure.booking.com/hotel/es/casa-rural-el-olivo.en-gb.html').name).toBe('Casa Rural El Olivo')
    expect(parseBookingUrl('https://www.booking.com/hotel/es/posada-d%C3%A9-la-sierra.html').name).toBe('Posada Dé La Sierra')
  })

  it('un enlace corto o de búsqueda es válido pero no da nombre; otras webs o texto roto, no valen', () => {
    expect(parseBookingUrl('https://www.booking.com/Share-AbCdEf')).toEqual({ valid: true, name: null })
    expect(parseBookingUrl('https://www.booking.com/searchresults.html?ss=Baena')).toEqual({ valid: true, name: null })
    expect(parseBookingUrl('https://evil-booking.com/hotel/es/x.html').valid).toBe(false)
    expect(parseBookingUrl('https://www.booking.com.evil.org/hotel/es/x.html').valid).toBe(false)
    expect(parseBookingUrl('no es una url').valid).toBe(false)
    expect(parseBookingUrl('').valid).toBe(false)
  })

  it('ignora fechas mal formadas y adultos absurdos', () => {
    const r = parseBookingUrl('https://www.booking.com/hotel/es/x.html?checkin=12/10/2026&checkout=mañana&group_adults=99')
    expect(r.checkin).toBeUndefined(); expect(r.checkout).toBeUndefined(); expect(r.adults).toBeUndefined()
  })
})

describe('fechas y distancias', () => {
  it('nightsBetween cuenta noches y rechaza fechas imposibles o salidas anteriores', () => {
    expect(nightsBetween('2026-10-18', '2026-10-19')).toBe(1)
    expect(nightsBetween('2026-10-30', '2026-11-02')).toBe(3)
    expect(nightsBetween('2026-10-18', '2026-10-18')).toBeNull()
    expect(nightsBetween('2026-10-19', '2026-10-18')).toBeNull()
    expect(nightsBetween('x', '2026-10-18')).toBeNull()
  })

  it('kmBetween: Jaén–Córdoba ≈ 100 km', () => {
    const km = kmBetween({ lat: 37.7796, lng: -3.7849 }, { lat: 37.8882, lng: -4.7794 })
    expect(km).toBeGreaterThan(85); expect(km).toBeLessThan(100)
  })

  it('el enlace de Booking lleva el nº de viajeros', () => {
    expect(bookingSearchUrl('Baena, Córdoba, España', 'es', { checkin: '2026-10-22', checkout: '2026-10-23', adults: 3 }))
      .toBe('https://www.booking.com/searchresults.html?ss=Baena%2C%20C%C3%B3rdoba%2C%20Espa%C3%B1a&lang=es&checkin=2026-10-22&checkout=2026-10-23&group_adults=3&no_rooms=1')
    expect(bookingSearchUrl('X', 'es', { checkin: '2026-10-22', checkout: '2026-10-23' })).toContain('group_adults=1')
  })
})

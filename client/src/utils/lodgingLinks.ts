/**
 * lodgingLinks.ts — Localidad de cada día y enlaces para buscar alojamiento a mano.
 *
 * Booking no tiene API pública de búsqueda y no se hace scraping de su web: aquí solo se construyen enlaces que abre
 * el usuario y se lee la URL de un hotel que él mismo pega (para proponer el nombre y comprobar las fechas).
 */
import type { Assignment, Place } from '../types'

export interface Locality {
  /** Nombre corto de la población («Alcaudete»). */
  name: string
  /** Texto para buscar sin ambigüedad («Alcaudete, Jaén, España»). */
  search: string
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Población de un lugar a partir de su dirección: la parte que lleva el código postal («23660 Alcaudete») o, si la
 * dirección es corta («Jaén, España»), su primera parte. Sin dirección, el nombre del lugar.
 */
export function localityFromPlace(place: Pick<Place, 'name' | 'address'> | null | undefined): Locality | null {
  if (!place) return null
  const address = clean(place.address ?? '')
  if (address) {
    const parts = address.split(',').map(clean).filter(Boolean)
    const zipIdx = parts.findIndex(p => /^\d{4,6}\s+\S/.test(p))
    if (zipIdx >= 0) {
      const name = parts[zipIdx].replace(/^\d{4,6}\s+/, '')
      return { name, search: [name, ...parts.slice(zipIdx + 1)].join(', ') }
    }
    // Sin código postal: si la primera parte lleva un número es una calle («Calle Mayor 3»): se usa lo que sigue.
    const startsWithStreet = /\d/.test(parts[0]) && parts.length > 1
    const rest = startsWithStreet ? parts.slice(1) : parts
    return { name: rest[0], search: rest.join(', ') }
  }
  const name = clean(place.name ?? '')
  return name ? { name, search: name } : null
}

/** Localidad final de un día: la del último lugar de su lista; si no hay lugares, el título del día. */
export function dayLocality(day: { title?: string | null; assignments?: Assignment[] } | null | undefined): Locality | null {
  const list = [...(day?.assignments ?? [])].sort((a, b) => a.order_index - b.order_index)
  for (let i = list.length - 1; i >= 0; i--) {
    const loc = localityFromPlace(list[i].place)
    if (loc) return loc
  }
  const title = clean(day?.title ?? '')
  return title ? { name: title, search: title } : null
}

export interface ParsedBookingUrl {
  /** La URL es de Booking (dominio booking.com). */
  valid: boolean
  /** Nombre propuesto a partir del texto de la URL del hotel («hotel-sercotel-x» → «Hotel Sercotel X»). */
  name: string | null
  checkin?: string
  checkout?: string
  adults?: number
}

const isIso = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Lee una URL de un hotel de Booking que pega el usuario. No hace ninguna petición a Booking. */
export function parseBookingUrl(raw: string): ParsedBookingUrl {
  const none: ParsedBookingUrl = { valid: false, name: null }
  let u: URL
  try { u = new URL(raw.trim()) } catch { return none }
  if (!/(^|\.)booking\.com$/i.test(u.hostname)) return none
  const out: ParsedBookingUrl = { valid: true, name: null }
  // /hotel/es/nombre-del-hotel.es.html  →  nombre-del-hotel
  const m = u.pathname.match(/\/hotel\/[a-z]{2}\/([^/]+?)(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html$/i)
  if (m) {
    const words = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim()
    // Mayúscula inicial por palabra (con split: `\b` de JS trata las letras con tilde como separadores).
    if (words) out.name = words.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
  const ci = u.searchParams.get('checkin'), co = u.searchParams.get('checkout')
  if (isIso(ci)) out.checkin = ci
  if (isIso(co)) out.checkout = co
  const ad = Number(u.searchParams.get('group_adults'))
  if (Number.isInteger(ad) && ad > 0 && ad < 30) out.adults = ad
  return out
}

/** Noches entre dos fechas AAAA-MM-DD (null si alguna no es válida o la salida no es posterior). */
export function nightsBetween(checkin: string, checkout: string): number | null {
  if (!isIso(checkin) || !isIso(checkout)) return null
  const a = Date.parse(`${checkin}T00:00:00Z`), b = Date.parse(`${checkout}T00:00:00Z`)
  if (isNaN(a) || isNaN(b) || b <= a) return null
  return Math.round((b - a) / 86400000)
}

/** Distancia en km entre dos coordenadas (para comprobar que el hotel encontrado está en la población). */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, r = Math.PI / 180
  const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

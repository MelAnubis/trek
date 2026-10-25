// Tipos de liketrek/TREK v5.0.0 (client/src/types.ts y shared/src/tours/tours.schema.ts) que usa el enrutado de Tours.
export interface Waypoint {
  lat: number
  lng: number
}
export interface SnappedWaypoint {
  /** The coordinate that was asked for, unchanged. */
  asked: [number, number]
  /** The point on the road network the router actually used. */
  at: [number, number]
  /** Straight-line metres between the two. */
  meters: number
}
export type RouteAvoidClass = 'motorway' | 'toll' | 'ferry'

type LatLngTuple = [number, number]
/** A leg the router does not plan (see shared tours.schema.ts). This port draws free legs; the other kinds are read, never made. */
export type TourFixedLeg =
  | { kind: 'ferrata'; ref: string; name: string | null; geometry: LatLngTuple[] }
  | { kind: 'free'; geometry: LatLngTuple[] }
  | { kind: 'portage'; geometry: LatLngTuple[]; extra_minutes?: number | null }
  | { kind: 'horse_route'; ref: string; name: string | null; geometry: LatLngTuple[] }
  | { kind: 'ferry'; geometry: LatLngTuple[]; crossings: Array<[number, number]>; minutes: number | null; walk_minutes: number }

/** How far a router may move a point of a tour onto its way before the point counts as one no way of the tour's type reaches. */
export const TOUR_MAX_SNAP_M = 300
/** How far a fixed leg's ends may lie from the waypoints it joins, in metres. */
export const TOUR_FIXED_LEG_END_TOLERANCE_M = 60

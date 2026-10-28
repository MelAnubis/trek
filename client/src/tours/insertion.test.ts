import { describe, it, expect } from 'vitest'
import { bestInsertIndex } from './insertion'

// A line west to east: Segovia-ish → Sepúlveda-ish.
const route = [{ lat: 41.0, lng: -4.5 }, { lat: 41.1, lng: -4.2 }, { lat: 41.3, lng: -3.75 }]

describe('bestInsertIndex', () => {
  it('puts a place lying between two stops in that gap, not at the end', () => {
    expect(bestInsertIndex(route, { lat: 41.05, lng: -4.35 })).toBe(1)
    expect(bestInsertIndex(route, { lat: 41.2, lng: -4.0 })).toBe(2)
  })
  it('appends a place beyond the finish', () => {
    expect(bestInsertIndex(route, { lat: 41.4, lng: -3.5 })).toBe(3)
  })
  it('appends while there is no route yet', () => {
    expect(bestInsertIndex([], { lat: 41, lng: -4 })).toBe(0)
    expect(bestInsertIndex([route[0]], { lat: 41, lng: -4 })).toBe(1)
  })
})

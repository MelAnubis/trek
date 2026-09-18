/**
 * Ids for the things a book is made of. Ported from liketrek/trek's
 * client/src/components/Studio/bookIds.ts (same AGPLv3 license).
 *
 * `getRandomValues` rather than `Math.random`: a book document is shared
 * over a websocket and merged by whoever saves last, so two editors minting
 * the same id for two different elements is a collision that shows up as
 * one of them losing their work. Falls back to Math.random only where Web
 * Crypto is unavailable entirely (plain http on a LAN address).
 *
 * Seven characters: 36^7 is about 78 billion, against a document that holds
 * a few hundred elements.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function elementId(prefix: string): string {
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(7)
    c.getRandomValues(bytes)
    let out = ''
    for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
    return `${prefix}-${out}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

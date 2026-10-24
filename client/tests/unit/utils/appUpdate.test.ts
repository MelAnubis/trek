// FE-APP-UPDATE-001 …
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isStaleChunkError, entryFromHtml, newBuildAvailable, reloadForUpdate, loadedEntry } from '../../../src/utils/appUpdate'

const html = (entry: string) => `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script></head><body></body></html>`

describe('appUpdate', () => {
  beforeEach(() => {
    document.head.innerHTML = '<script type="module" crossorigin src="/assets/index-OLD111.js"></script>'
    sessionStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks(); document.head.innerHTML = '' })

  it('FE-APP-UPDATE-001: recognises the "module of an old build is gone" errors of every browser', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/JourneyBookPDF-DYRah0O1.js'))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)   // Firefox
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)           // Safari
    expect(isStaleChunkError(new Error('Network Error'))).toBe(false)
  })

  it('FE-APP-UPDATE-002: tells a new build from the same one by the entry script in index.html', async () => {
    expect(loadedEntry()).toBe('/assets/index-OLD111.js')
    expect(entryFromHtml(html('/assets/index-NEW222.js'))).toBe('/assets/index-NEW222.js')
    const fetchNew = vi.fn(async () => new Response(html('/assets/index-NEW222.js'))) as unknown as typeof fetch
    expect(await newBuildAvailable(fetchNew)).toBe(true)
    // asked past the service worker's cached copy
    expect(String((fetchNew as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toMatch(/^\/index\.html\?check=\d+/)
    const fetchSame = vi.fn(async () => new Response(html('/assets/index-OLD111.js'))) as unknown as typeof fetch
    expect(await newBuildAvailable(fetchSame)).toBe(false)
    const fetchDown = vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch
    expect(await newBuildAvailable(fetchDown)).toBeNull()
  })

  it('FE-APP-UPDATE-003: reloads once, not in a loop', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true, writable: true })
    expect(reloadForUpdate()).toBe(true)
    expect(reloadForUpdate()).toBe(false)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

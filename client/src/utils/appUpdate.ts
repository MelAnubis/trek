/**
 * Versión nueva desplegada con la app abierta.
 *
 * Cada build da nombres nuevos a sus archivos (/assets/index-XXXX.js,
 * JourneyBookPDF-YYYY.js…) y el servidor solo tiene los últimos. Una
 * pestaña o la app de Android abiertas desde antes siguen con la versión
 * vieja y, al cargar algo bajo demanda (el PDF, el Studio…), piden un
 * archivo que ya no existe: «Failed to fetch dynamically imported module».
 *
 * - isStaleChunkError(): reconoce ese error.
 * - reloadForUpdate(): borra cachés y service worker y recarga (una vez cada
 *   pocos segundos como mucho, para no entrar en bucle si el servidor cae).
 * - watchForNewBuild(): compara el index.html del servidor con el cargado y
 *   avisa (sin recargar: podrías estar escribiendo).
 */

const RELOAD_KEY = 'trek_update_reload_at'

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? '')
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk \S+ failed/i.test(msg)
}

/** Recarga con la versión nueva. Devuelve false si ya se intentó hace poco. */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < 20_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* sin sessionStorage: se recarga igual */ }
  ;(async () => {
    try {
      if ('caches' in window) await Promise.all((await caches.keys()).map(n => caches.delete(n)))
      if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()))
    } catch { /* lo importante es recargar */ }
    window.location.reload()
  })()
  return true
}

/** El script principal con el que arrancó esta página (/assets/index-XXXX.js). */
export function loadedEntry(doc: Document = document): string | null {
  const s = [...doc.querySelectorAll('script[type="module"][src]')].map(e => e.getAttribute('src') || '').find(src => /\/assets\/index-[^/]+\.js$/.test(src))
  return s || null
}

export function entryFromHtml(html: string): string | null {
  const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/) || html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"[^>]*type="module"/)
  return m ? m[1] : null
}

/** ¿El servidor tiene ya otra versión? (null si no se puede saber). */
export async function newBuildAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const mine = loadedEntry()
  if (!mine) return null                                  // desarrollo / tests
  try {
    // Con parámetro: así no lo sirve el index.html que guarda el service worker.
    const res = await fetchImpl(`/index.html?check=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return null
    const theirs = entryFromHtml(await res.text())
    return theirs ? theirs !== mine : null
  } catch {
    return null
  }
}

/** Mira de vez en cuando (al volver a la app y cada 10 min) y llama a onNew una vez. */
export function watchForNewBuild(onNew: () => void): () => void {
  let done = false
  const check = async () => {
    if (done || document.hidden || !navigator.onLine) return
    if (await newBuildAvailable()) { done = true; onNew() }
  }
  const vis = () => { if (!document.hidden) check() }
  document.addEventListener('visibilitychange', vis)
  const id = setInterval(check, 10 * 60 * 1000)
  const first = setTimeout(check, 30_000)
  return () => { document.removeEventListener('visibilitychange', vis); clearInterval(id); clearTimeout(first) }
}

/** Errores de carga diferida en cualquier parte: recargar con la versión nueva. */
export function installStaleChunkRecovery(): void {
  // Not preventDefault(): that makes the import resolve to undefined and the
  // caller crash on it instead of seeing the real error.
  window.addEventListener('vite:preloadError', (e: Event) => {
    if (isStaleChunkError((e as Event & { payload?: unknown }).payload)) reloadForUpdate()
  })
  window.addEventListener('unhandledrejection', e => {
    if (isStaleChunkError(e.reason) && reloadForUpdate()) e.preventDefault()
  })
}

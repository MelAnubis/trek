/**
 * plannerLibrary.ts — Lógica pura de la biblioteca de rutas (miniaturas, paginación, colores).
 */
export type PreviewPoint = [number, number]

export interface ThumbPath {
  /** Atributo `d` de un <path> en coordenadas del viewBox (0..w, 0..h). */
  d: string
  start: [number, number]
  end: [number, number]
}

/**
 * Proyecta la silueta de una ruta a un rectángulo w×h conservando la proporción
 * (con corrección de longitud por la latitud) y centrada. Sin teselas: es un
 * dibujo vectorial instantáneo.
 */
export function projectPreview(preview: PreviewPoint[], w: number, h: number, pad = 8): ThumbPath | null {
  if (!Array.isArray(preview) || preview.length < 2) return null
  let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity
  for (const [la, lo] of preview) {
    if (la < minLa) minLa = la
    if (la > maxLa) maxLa = la
    if (lo < minLo) minLo = lo
    if (lo > maxLo) maxLo = lo
  }
  const k = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180)
  const spanX = Math.max((maxLo - minLo) * k, 1e-6)
  const spanY = Math.max(maxLa - minLa, 1e-6)
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2
  const pts = preview.map(([la, lo]): [number, number] => [
    Math.round((offX + (lo - minLo) * k * scale) * 10) / 10,
    Math.round((offY + (maxLa - la) * scale) * 10) / 10,
  ])
  return {
    d: 'M' + pts.map(p => `${p[0]} ${p[1]}`).join('L'),
    start: pts[0],
    end: pts[pts.length - 1],
  }
}

/** Números de página a mostrar: 1 … 4 5 6 … 20 (con elipsis). */
export function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set<number>([1, pages, page - 1, page, page + 1])
  if (page <= 3) { set.add(2); set.add(3); set.add(4) }
  if (page >= pages - 2) { set.add(pages - 1); set.add(pages - 2); set.add(pages - 3) }
  const nums = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…')
    out.push(n)
  })
  return out
}

/** Color estable por nombre de carpeta; las rutas sin carpeta usan el acento. */
export function folderColor(name: string | null | undefined): string {
  if (!name) return '#e85d24'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 62% 45%)`
}

export const SORT_KEYS = ['recent', 'created', 'name', 'distance', 'ascent'] as const
export type SortKey = typeof SORT_KEYS[number]

export type LibraryFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; name: string }

/** Parámetros de consulta del servidor para un filtro de la barra lateral. */
export function filterParams(f: LibraryFilter): Record<string, string> {
  switch (f.kind) {
    case 'favorites': return { favorite: '1' }
    case 'unfiled': return { unfiled: '1' }
    case 'folder': return { folder: f.name }
    default: return {}
  }
}

/** Operaciones puras sobre la lista de bloques de un post (sin React). */
import type { BlogBlock, BlockType, PhotoRef } from './types'
import { newId } from './blogSync'

export function newBlock(type: BlockType, opts: { photos?: PhotoRef[]; entryId?: number; date?: string | null } = {}): BlogBlock {
  const id = newId()
  switch (type) {
    case 'paragraph': return { id, type, text: '' }
    case 'heading': return { id, type, text: '', level: 2 }
    case 'quote': return { id, type, text: '' }
    case 'photo': return { id, type, photo: opts.photos?.[0] ?? {}, layout: 'wide' }
    case 'gallery': return { id, type, photos: opts.photos ?? [], layout: 'grid' }
    case 'map': return { id, type, source: 'post', date: opts.date ?? null, showTrack: true, showPhotos: true }
    case 'sketch': return { id, type, aspect: 0.62, background: 'paper', strokes: [] }
    case 'divider': return { id, type }
    case 'entry': return { id, type, entryId: opts.entryId ?? 0 }
  }
}

const isEmptyParagraph = (b: BlogBlock | undefined) => b?.type === 'paragraph' && !b.text.trim()

/**
 * Inserta detrás de `afterId` (al final si no hay). Si ese bloque es un
 * párrafo vacío —la línea en la que estabas— lo sustituye en lugar de dejar
 * un hueco.
 */
export function insertAfter(blocks: BlogBlock[], afterId: string | null, add: BlogBlock[]): BlogBlock[] {
  const i = afterId ? blocks.findIndex(b => b.id === afterId) : -1
  if (i < 0) {
    const last = blocks[blocks.length - 1]
    if (isEmptyParagraph(last) && add[0]?.type !== 'paragraph') return [...blocks.slice(0, -1), ...add]
    return [...blocks, ...add]
  }
  if (isEmptyParagraph(blocks[i]) && add[0]?.type !== 'paragraph') return [...blocks.slice(0, i), ...add, ...blocks.slice(i + 1)]
  return [...blocks.slice(0, i + 1), ...add, ...blocks.slice(i + 1)]
}

export function updateBlock<T extends BlogBlock>(blocks: BlogBlock[], id: string, patch: Partial<T>): BlogBlock[] {
  return blocks.map(b => (b.id === id ? ({ ...b, ...patch } as BlogBlock) : b))
}

/** Quita un bloque; un post nunca se queda sin un párrafo donde escribir. */
export function removeBlock(blocks: BlogBlock[], id: string): BlogBlock[] {
  const next = blocks.filter(b => b.id !== id)
  return next.length ? next : [newBlock('paragraph')]
}

export function moveBlock(blocks: BlogBlock[], id: string, dir: -1 | 1): BlogBlock[] {
  const i = blocks.findIndex(b => b.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= blocks.length) return blocks
  const next = blocks.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Párrafo ↔ título ↔ cita, conservando el texto. */
export function convertText(block: BlogBlock, to: 'paragraph' | 'heading' | 'quote'): BlogBlock {
  const text = 'text' in block ? block.text : ''
  if (to === 'heading') return { id: block.id, type: 'heading', text: text.replace(/\n+/g, ' '), level: 2 }
  if (to === 'quote') return { id: block.id, type: 'quote', text }
  return { id: block.id, type: 'paragraph', text }
}

/** Una entrada de la travesía como bloques: su texto y sus fotos. */
export function blocksFromEntry(entry: { title: string | null; story: string | null; photo_ids: { galleryId: number; photoId: number }[] }): BlogBlock[] {
  const out: BlogBlock[] = []
  if (entry.title) out.push({ ...newBlock('heading'), text: entry.title } as BlogBlock)
  if (entry.story?.trim()) {
    for (const para of entry.story.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)) out.push({ ...newBlock('paragraph'), text: para } as BlogBlock)
  }
  if (entry.photo_ids.length === 1) out.push(newBlock('photo', { photos: entry.photo_ids }))
  else if (entry.photo_ids.length > 1) out.push(newBlock('gallery', { photos: entry.photo_ids }))
  return out
}

/** Todas las fotos de un post (para portada). */
export function photosOf(blocks: BlogBlock[]): PhotoRef[] {
  return blocks.flatMap(b => (b.type === 'photo' ? [b.photo] : b.type === 'gallery' ? b.photos : []))
}

/** ¿Hay algo escrito o puesto? (un post vacío no se guarda). */
export function hasContent(title: string, blocks: BlogBlock[]): boolean {
  if (title.trim()) return true
  return blocks.some(b => !isEmptyParagraph(b))
}

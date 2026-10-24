/**
 * Blog de la travesía — tipos compartidos por el editor, la vista y la
 * sincronización. Mismos bloques que valida el servidor
 * (server/src/services/blogService.ts); mantener a la par.
 *
 * Una foto puede estar aún en el teléfono (localId: subida pendiente) o ya
 * en la galería de la travesía (galleryId + photoId). La sincronización
 * sustituye la primera por la segunda antes de enviar el post.
 */

export interface PhotoRef {
  galleryId?: number
  photoId?: number
  /** Subida pendiente en este dispositivo (id de BlogUpload). */
  localId?: string
}

export type BlogStatus = 'draft' | 'private' | 'published'

export interface SketchStroke {
  /** #rrggbb */
  c: string
  /** Grosor base, en unidades de 1/1000 del ancho. */
  w: number
  tool: 'pen' | 'marker' | 'highlighter'
  /** x, y (0..1000 del ancho) y presión 0..1, aplanados. */
  p: number[]
}

export type BlogBlock =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'heading'; text: string; level: 2 | 3 }
  | { id: string; type: 'quote'; text: string; cite?: string }
  | { id: string; type: 'photo'; photo: PhotoRef; caption?: string; layout: 'inline' | 'wide' | 'full'; entryId?: number | null }
  | { id: string; type: 'gallery'; photos: PhotoRef[]; caption?: string; layout: 'grid' | 'mosaic' | 'carousel' }
  | { id: string; type: 'map'; source: 'post' | 'day' | 'journey'; date?: string | null; showTrack: boolean; showPhotos: boolean; caption?: string
      /** El mapa como imagen, para la entrada de la travesía (PDF, Studio). */
      image?: PhotoRef; imageKey?: string }
  | { id: string; type: 'sketch'; aspect: number; background: 'paper' | 'grid' | 'lines' | 'transparent'; strokes: SketchStroke[]; caption?: string
      /** El dibujo pasado a imagen, para la entrada de la travesía (PDF, Studio). */
      image?: PhotoRef; imageKey?: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'entry'; entryId: number }

export type BlockType = BlogBlock['type']

export interface MapContext {
  entries: { id: number; title: string | null; lat: number; lng: number; date: string }[]
  tracks: { id: number; name: string; points: [number, number][] }[]
  photos: { photoId: number; lat: number; lng: number }[]
}

export interface EntryCard {
  id: number
  title: string | null
  story: string | null
  entry_date: string
  location_name: string | null
  mood?: string | null
  weather?: string | null
  photo_id: number | null
}

/** Lo que devuelve el servidor por post (lista: sin blocks/maps/entries). */
export interface ServerPostSummary {
  id: string
  journey_id: number
  title: string
  slug: string
  excerpt: string | null
  cover_photo_id: number | null
  status: BlogStatus
  post_date: string | null
  published_at: number | null
  version: number
  created_at: number
  updated_at: number
  author: { id?: number; username: string } | null
  entry_ids?: number[]
}

export interface ServerPost extends ServerPostSummary {
  blocks: BlogBlock[]
  entry_ids: number[]
  own_entry_id?: number | null
  add_to_journey?: boolean
  entries: EntryCard[]
  maps: Record<string, MapContext>
}

/** Un post tal como vive en este dispositivo (Dexie). */
export interface LocalPost {
  id: string
  journeyId: number
  title: string
  blocks: BlogBlock[]
  status: BlogStatus
  post_date: string | null
  entry_ids: number[]
  cover_photo_id: number | null
  add_to_journey: boolean
  /** Versión del servidor sobre la que se editó (null: nunca enviado). */
  baseVersion: number | null
  /** Últimos datos derivados del servidor (slug, mapas, tarjetas de entradas…). */
  server: Omit<ServerPost, 'blocks'> | null
  /** 1 = hay cambios locales sin enviar. Número para poder indexarlo. */
  dirty: 0 | 1
  /** 1 = borrado en local, falta borrarlo en el servidor. */
  deleted: 0 | 1
  localUpdatedAt: number
  syncError: string | null
  /** El servidor tenía otra versión: su copia, para elegir. */
  conflict: ServerPost | null
}

export interface BlogUpload {
  /** client_id: hace idempotente la subida. */
  id: string
  journeyId: number
  postId: string | null
  /** Los bytes de la foto. ArrayBuffer y no Blob: se guarda igual en todos los navegadores y WebView. */
  data: ArrayBuffer
  name: string
  mime: string
  status: 'pending' | 'done' | 'failed'
  galleryId: number | null
  photoId: number | null
  width: number | null
  height: number | null
  attempts: number
  error: string | null
  createdAt: number
}

export const BLOCK_TYPES: BlockType[] = ['paragraph', 'heading', 'quote', 'photo', 'gallery', 'map', 'sketch', 'entry', 'divider']

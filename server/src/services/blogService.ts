import { z } from 'zod';
import { db } from '../db/database';
import { canAccessJourney, canEdit, createEntry, deleteEntry, linkPhotoToEntry, broadcastJourneyEvent } from './journeyService';

/**
 * Blog de la travesía (4.2).
 *
 * Un post vive dentro de una travesía y se escribe en bloques (texto, título,
 * cita, foto, galería, mapa, dibujo a mano, separador, entrada incrustada).
 * Se relaciona con la travesía de dos maneras, combinables:
 *  - enlaza 0..n entradas existentes (blog_post_entries);
 *  - opcionalmente crea y mantiene su propia entrada en la travesía
 *    (journey_entries.source_post_id), para un post escrito «suelto».
 *
 * Estados: draft (solo quien puede editar), private (todos los miembros de
 * la travesía) y published (además, el blog público si el enlace de la
 * travesía comparte el blog).
 *
 * El id lo genera el cliente (UUID): así el móvil puede crear un post sin
 * red y reenviar el mismo PUT las veces que haga falta sin duplicarlo.
 * `version` detecta que otro dispositivo guardó entre medias (409).
 */

export type BlogStatus = 'draft' | 'private' | 'published';
const STATUSES: BlogStatus[] = ['draft', 'private', 'published'];

const ID = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const photoRef = z.object({ galleryId: z.number().int().positive(), photoId: z.number().int().positive() });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const blockSchema = z.discriminatedUnion('type', [
  z.object({ id: ID, type: z.literal('paragraph'), text: z.string().max(20000) }),
  z.object({ id: ID, type: z.literal('heading'), text: z.string().max(300), level: z.union([z.literal(2), z.literal(3)]).default(2) }),
  z.object({ id: ID, type: z.literal('quote'), text: z.string().max(5000), cite: z.string().max(200).optional() }),
  z.object({
    id: ID, type: z.literal('photo'), photo: photoRef, caption: z.string().max(500).optional(),
    layout: z.enum(['inline', 'wide', 'full']).default('wide'), entryId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    id: ID, type: z.literal('gallery'), photos: z.array(photoRef).max(60), caption: z.string().max(500).optional(),
    layout: z.enum(['grid', 'mosaic', 'carousel']).default('grid'),
  }),
  z.object({
    id: ID, type: z.literal('map'), source: z.enum(['post', 'day', 'journey']).default('post'),
    date: DATE.nullable().optional(), showTrack: z.boolean().default(true), showPhotos: z.boolean().default(true),
    caption: z.string().max(500).optional(),
  }),
  z.object({
    id: ID, type: z.literal('sketch'),
    aspect: z.number().min(0.25).max(4).default(0.75),
    background: z.enum(['paper', 'grid', 'lines', 'transparent']).default('paper'),
    strokes: z.array(z.object({
      c: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      w: z.number().min(0.5).max(60),
      tool: z.enum(['pen', 'marker', 'highlighter']).default('pen'),
      // x, y (0..1000 del ancho) y presión (0..1), aplanados.
      p: z.array(z.number().finite()).max(30000),
    })).max(4000),
    caption: z.string().max(500).optional(),
  }),
  z.object({ id: ID, type: z.literal('divider') }),
  z.object({ id: ID, type: z.literal('entry'), entryId: z.number().int().positive() }),
]);
export type BlogBlock = z.infer<typeof blockSchema>;

export const savePostSchema = z.object({
  title: z.string().max(300).default(''),
  blocks: z.array(blockSchema).max(500).default([]),
  status: z.enum(['draft', 'private', 'published']).default('draft'),
  post_date: DATE.nullable().optional(),
  entry_ids: z.array(z.number().int().positive()).max(200).default([]),
  cover_photo_id: z.number().int().positive().nullable().optional(),
  add_to_journey: z.boolean().default(false),
  base_version: z.number().int().nullable().optional(),
  force: z.boolean().optional(),
}).superRefine((v, ctx) => {
  const points = v.blocks.reduce((n, b) => n + (b.type === 'sketch' ? b.strokes.reduce((m, s) => m + s.p.length, 0) : 0), 0);
  if (points > 600000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Sketches too large' });
});
export type SavePostInput = z.infer<typeof savePostSchema>;

interface PostRow {
  id: string; journey_id: number; author_id: number | null; title: string; slug: string; excerpt: string | null;
  blocks: string; cover_photo_id: number | null; status: BlogStatus; post_date: string | null;
  published_at: number | null; version: number; created_at: number; updated_at: number;
}

const now = () => Date.now();

/** 'edit' | 'view' | null — what this user may do with the journey's blog. */
export function blogAccess(journeyId: number, userId: number): 'edit' | 'view' | null {
  if (!canAccessJourney(journeyId, userId)) return null;
  return canEdit(journeyId, userId) ? 'edit' : 'view';
}

const visibleTo = (access: 'edit' | 'view', status: BlogStatus) => access === 'edit' || status !== 'draft';

export function slugify(title: string): string {
  const s = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  return s || 'post';
}

function uniqueSlug(journeyId: number, base: string, postId: string): string {
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM blog_posts WHERE journey_id = ? AND slug = ? AND id != ?').get(journeyId, slug, postId); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

/** Plain text of the writing blocks, for the excerpt and the journey entry. */
function textOf(blocks: BlogBlock[], markdown: boolean): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph' && b.text.trim()) parts.push(b.text.trim());
    else if (b.type === 'heading' && b.text.trim()) parts.push(markdown ? `${'#'.repeat(b.level)} ${b.text.trim()}` : b.text.trim());
    else if (b.type === 'quote' && b.text.trim()) parts.push(markdown ? `> ${b.text.trim()}` : b.text.trim());
  }
  return parts.join('\n\n');
}

export function stripMarkdown(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#]+/g, '').replace(/\s+/g, ' ').trim();
}

function excerptOf(blocks: BlogBlock[]): string | null {
  const first = blocks.find(b => b.type === 'paragraph' && b.text.trim()) as { text: string } | undefined;
  if (!first) return null;
  const plain = stripMarkdown(first.text);
  return plain.length > 220 ? `${plain.slice(0, 217).replace(/\s+\S*$/, '')}…` : plain;
}

function photoRefsOf(blocks: BlogBlock[]): { galleryId: number; photoId: number; entryId?: number | null }[] {
  const out: { galleryId: number; photoId: number; entryId?: number | null }[] = [];
  for (const b of blocks) {
    if (b.type === 'photo') out.push({ ...b.photo, entryId: b.entryId ?? null });
    else if (b.type === 'gallery') out.push(...b.photos);
  }
  return out;
}

function ownEntryId(postId: string): number | null {
  const r = db.prepare('SELECT id FROM journey_entries WHERE source_post_id = ?').get(postId) as { id: number } | undefined;
  return r?.id ?? null;
}

function linkedEntryIds(postId: string): number[] {
  return (db.prepare('SELECT entry_id FROM blog_post_entries WHERE post_id = ? ORDER BY sort_order, entry_id').all(postId) as { entry_id: number }[]).map(r => r.entry_id);
}

function summary(row: PostRow) {
  const author = row.author_id ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.author_id) as { id: number; username: string } | undefined : undefined;
  return {
    id: row.id, journey_id: row.journey_id, title: row.title, slug: row.slug, excerpt: row.excerpt,
    cover_photo_id: row.cover_photo_id, status: row.status, post_date: row.post_date,
    published_at: row.published_at, version: row.version, created_at: row.created_at, updated_at: row.updated_at,
    author: author ? { id: author.id, username: author.username } : null,
  };
}

// ── Map context ──────────────────────────────────────────────────────────────

interface MapContext {
  entries: { id: number; title: string | null; lat: number; lng: number; date: string }[];
  tracks: { id: number; name: string; points: [number, number][] }[];
  photos: { photoId: number; lat: number; lng: number }[];
}

function samplePoints(json: string | null, max = 400): [number, number][] {
  let pts: { lat?: number; lng?: number; lon?: number }[] = [];
  try { const v = JSON.parse(json || '[]'); if (Array.isArray(v)) pts = v; } catch { /* nada */ }
  const ok = pts.map(p => [Number(p.lat), Number(p.lng ?? p.lon)] as [number, number]).filter(([a, o]) => Number.isFinite(a) && Number.isFinite(o));
  if (ok.length <= max) return ok.map(([a, o]) => [Math.round(a * 1e5) / 1e5, Math.round(o * 1e5) / 1e5]);
  const step = (ok.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => ok[Math.round(i * step)]).map(([a, o]) => [Math.round(a * 1e5) / 1e5, Math.round(o * 1e5) / 1e5]);
}

function mapContexts(row: PostRow, blocks: BlogBlock[], entryIds: number[]): Record<string, MapContext> {
  const maps = blocks.filter((b): b is Extract<BlogBlock, { type: 'map' }> => b.type === 'map');
  if (!maps.length) return {};
  const tripIds = (db.prepare('SELECT trip_id FROM journey_trips WHERE journey_id = ?').all(row.journey_id) as { trip_id: number }[]).map(r => r.trip_id);
  const allEntries = db.prepare(`
    SELECT id, title, location_lat AS lat, location_lng AS lng, entry_date AS date FROM journey_entries
    WHERE journey_id = ? AND location_lat IS NOT NULL AND location_lng IS NOT NULL AND type != 'skeleton'
    ORDER BY entry_date, sort_order
  `).all(row.journey_id) as MapContext['entries'];
  const photoIds = [...new Set(photoRefsOf(blocks).map(p => p.photoId))];
  const photos = photoIds.length
    ? db.prepare(`SELECT id AS photoId, lat, lng FROM trek_photos WHERE id IN (${photoIds.map(() => '?').join(',')}) AND lat IS NOT NULL AND lng IS NOT NULL`).all(...photoIds) as MapContext['photos']
    : [];

  const out: Record<string, MapContext> = {};
  for (const m of maps) {
    let entries: MapContext['entries'];
    let dates: Set<string> | null;
    if (m.source === 'journey') { entries = allEntries; dates = null; }
    else if (m.source === 'day') {
      const d = m.date || row.post_date;
      entries = d ? allEntries.filter(e => e.date === d) : [];
      dates = new Set(d ? [d] : []);
    } else {
      const ids = new Set(entryIds);
      entries = allEntries.filter(e => ids.has(e.id));
      dates = new Set([...entries.map(e => e.date), ...(row.post_date ? [row.post_date] : [])]);
    }
    let tracks: MapContext['tracks'] = [];
    if (m.showTrack && tripIds.length && (dates === null || dates.size)) {
      const rows = db.prepare(`
        SELECT t.id, t.track_name, t.points_json, d.date FROM gpx_tracks t LEFT JOIN days d ON d.id = t.day_id
        WHERE t.trip_id IN (${tripIds.map(() => '?').join(',')}) ORDER BY t.sort_order, t.id
      `).all(...tripIds) as { id: number; track_name: string; points_json: string | null; date: string | null }[];
      tracks = rows.filter(t => dates === null || (t.date && dates.has(t.date)))
        .slice(0, 30)
        .map(t => ({ id: t.id, name: t.track_name, points: samplePoints(t.points_json, dates === null ? 250 : 500) }))
        .filter(t => t.points.length > 1);
    }
    out[m.id] = { entries, tracks, photos: m.showPhotos ? photos : [] };
  }
  return out;
}

/** The travesía entries a post shows: the linked ones plus any embedded with an entry block. */
function entryCards(journeyId: number, ids: number[]) {
  if (!ids.length) return [];
  const rows = db.prepare(`
    SELECT je.id, je.title, je.story, je.entry_date, je.location_name, je.mood, je.weather,
      (SELECT gp.photo_id FROM journey_entry_photos jep JOIN journey_photos gp ON gp.id = jep.journey_photo_id
        WHERE jep.entry_id = je.id ORDER BY jep.sort_order LIMIT 1) AS photo_id
    FROM journey_entries je WHERE je.journey_id = ? AND je.id IN (${ids.map(() => '?').join(',')})
  `).all(journeyId, ...ids) as { id: number; story: string | null }[];
  return rows.map(r => ({ ...r, story: r.story ? stripMarkdown(r.story).slice(0, 400) : null }));
}

function fullPost(row: PostRow) {
  let blocks: BlogBlock[] = [];
  try { blocks = JSON.parse(row.blocks); } catch { blocks = []; }
  const entryIds = linkedEntryIds(row.id);
  const own = ownEntryId(row.id);
  const embedded = blocks.filter((b): b is Extract<BlogBlock, { type: 'entry' }> => b.type === 'entry').map(b => b.entryId);
  return {
    ...summary(row),
    blocks,
    entry_ids: entryIds,
    own_entry_id: own,
    add_to_journey: own != null,
    entries: entryCards(row.journey_id, [...new Set([...entryIds, ...embedded])]),
    maps: mapContexts(row, blocks, entryIds),
  };
}
export type FullPost = ReturnType<typeof fullPost>;

// ── Reading ──────────────────────────────────────────────────────────────────

export function listPosts(journeyId: number, userId: number) {
  const access = blogAccess(journeyId, userId);
  if (!access) return null;
  const rows = db.prepare(`SELECT * FROM blog_posts WHERE journey_id = ? ORDER BY COALESCE(post_date, '') DESC, created_at DESC`).all(journeyId) as PostRow[];
  return {
    access,
    posts: rows.filter(r => visibleTo(access, r.status)).map(r => ({ ...summary(r), entry_ids: linkedEntryIds(r.id) })),
  };
}

export function getPost(journeyId: number, postId: string, userId: number) {
  const access = blogAccess(journeyId, userId);
  if (!access) return null;
  const row = db.prepare('SELECT * FROM blog_posts WHERE id = ? AND journey_id = ?').get(postId, journeyId) as PostRow | undefined;
  if (!row || !visibleTo(access, row.status)) return null;
  return fullPost(row);
}

// ── Writing ──────────────────────────────────────────────────────────────────

export type SaveResult =
  | { ok: true; post: FullPost; created: boolean }
  | { ok: false; status: 403 | 404 | 409 | 400; error: string; post?: FullPost };

export function savePost(journeyId: number, postId: string, userId: number, input: SavePostInput, sid?: string): SaveResult {
  if (!ID.safeParse(postId).success) return { ok: false, status: 400, error: 'Invalid post id' };
  if (!canEdit(journeyId, userId)) return { ok: false, status: 403, error: 'Not allowed' };
  const existing = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(postId) as PostRow | undefined;
  if (existing && existing.journey_id !== journeyId) return { ok: false, status: 404, error: 'Not found' };
  if (existing && !input.force && input.base_version != null && input.base_version !== existing.version) {
    return { ok: false, status: 409, error: 'Conflict', post: fullPost(existing) };
  }

  // Photos must be this journey's: the server is the one that knows which
  // trek photo each gallery row points at.
  const gallery = new Map((db.prepare('SELECT id, photo_id FROM journey_photos WHERE journey_id = ?').all(journeyId) as { id: number; photo_id: number }[]).map(r => [r.id, r.photo_id]));
  const badPhoto = photoRefsOf(input.blocks).find(p => gallery.get(p.galleryId) == null);
  if (badPhoto) return { ok: false, status: 400, error: `Photo ${badPhoto.galleryId} is not in this journey` };
  const blocks = input.blocks.map(b => {
    if (b.type === 'photo') return { ...b, photo: { galleryId: b.photo.galleryId, photoId: gallery.get(b.photo.galleryId)! } };
    if (b.type === 'gallery') return { ...b, photos: b.photos.map(p => ({ galleryId: p.galleryId, photoId: gallery.get(p.galleryId)! })) };
    return b;
  }) as BlogBlock[];

  const journeyEntries = new Set((db.prepare('SELECT id FROM journey_entries WHERE journey_id = ?').all(journeyId) as { id: number }[]).map(r => r.id));
  const entryIds = [...new Set(input.entry_ids)].filter(id => journeyEntries.has(id));
  const refs = photoRefsOf(blocks);
  const cover = input.cover_photo_id && refs.some(p => p.photoId === input.cover_photo_id) ? input.cover_photo_id : (refs[0]?.photoId ?? null);
  const status = STATUSES.includes(input.status) ? input.status : 'draft';
  const t = now();

  const result = db.transaction(() => {
    const title = input.title.trim();
    // A published post keeps its address: links already shared must not break.
    const slug = existing?.published_at ? existing.slug : uniqueSlug(journeyId, slugify(title), postId);
    const publishedAt = status === 'published' ? (existing?.published_at ?? t) : (existing?.published_at ?? null);
    if (existing) {
      db.prepare(`UPDATE blog_posts SET title = ?, slug = ?, excerpt = ?, blocks = ?, cover_photo_id = ?, status = ?, post_date = ?,
        published_at = ?, version = version + 1, updated_at = ? WHERE id = ?`)
        .run(title, slug, excerptOf(blocks), JSON.stringify(blocks), cover, status, input.post_date ?? null, publishedAt, t, postId);
    } else {
      db.prepare(`INSERT INTO blog_posts (id, journey_id, author_id, title, slug, excerpt, blocks, cover_photo_id, status, post_date, published_at, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(postId, journeyId, userId, title, slug, excerptOf(blocks), JSON.stringify(blocks), cover, status, input.post_date ?? null, publishedAt, t, t);
    }

    // The post's own journey entry («añadir también a la travesía»).
    let own = ownEntryId(postId);
    if (input.add_to_journey) {
      const story = textOf(blocks, true) || null;
      const date = input.post_date || new Date(t).toISOString().slice(0, 10);
      if (own == null) {
        const created = createEntry(journeyId, userId, { type: 'entry', title: title || undefined, story: story || undefined, entry_date: date }, sid);
        if (created) {
          db.prepare('UPDATE journey_entries SET source_post_id = ? WHERE id = ?').run(postId, created.id);
          own = (created as { id: number }).id;
        }
      } else {
        db.prepare('UPDATE journey_entries SET title = ?, story = ?, entry_date = ?, updated_at = ? WHERE id = ?').run(title || null, story, date, t, own);
      }
    } else if (own != null) {
      // Switched off: the entry stays in the journey (it is the user's
      // writing), it just stops following the post.
      db.prepare('UPDATE journey_entries SET source_post_id = NULL WHERE id = ?').run(own);
      own = null;
    }

    const links = own != null ? [own, ...entryIds.filter(id => id !== own)] : entryIds;
    db.prepare('DELETE FROM blog_post_entries WHERE post_id = ?').run(postId);
    const ins = db.prepare('INSERT INTO blog_post_entries (post_id, entry_id, sort_order) VALUES (?, ?, ?)');
    links.forEach((id, i) => ins.run(postId, id, i));

    // Photos follow into the travesía: the ones a photo block assigns to an
    // entry, and every photo of a post into the entry it created itself.
    for (const p of refs) {
      if (p.entryId && journeyEntries.has(p.entryId)) linkPhotoToEntry(p.entryId, p.galleryId, userId);
      if (own != null) linkPhotoToEntry(own, p.galleryId, userId);
    }
    return db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(postId) as PostRow;
  })();

  const post = fullPost(result);
  broadcastJourneyEvent(journeyId, 'journey:blog:updated', { postId, version: post.version }, sid);
  return { ok: true, post, created: !existing };
}

export function deletePost(journeyId: number, postId: string, userId: number, sid?: string): boolean | null {
  if (!canEdit(journeyId, userId)) return null;
  const row = db.prepare('SELECT id FROM blog_posts WHERE id = ? AND journey_id = ?').get(postId, journeyId);
  if (!row) return false;
  // La entrada que el post creó en la travesía se va con él (las fotos siguen
  // en la galería). Las entradas que solo enlazaba no se tocan.
  const own = (db.prepare('SELECT id FROM journey_entries WHERE source_post_id = ?').all(postId) as { id: number }[]).map(r => r.id);
  db.transaction(() => {
    for (const id of own) deleteEntry(id, userId, sid);
    db.prepare('DELETE FROM blog_posts WHERE id = ?').run(postId);
  })();
  broadcastJourneyEvent(journeyId, 'journey:blog:deleted', { postId }, sid);
  return true;
}

// ── Uploads (idempotent by client id) ────────────────────────────────────────

export function findUpload(clientId: string, journeyId: number) {
  const r = db.prepare(`
    SELECT bu.client_id, bu.journey_photo_id AS gallery_id, bu.photo_id, tp.width, tp.height, tp.lat, tp.lng, tp.taken_at
    FROM blog_uploads bu JOIN trek_photos tp ON tp.id = bu.photo_id
    WHERE bu.client_id = ? AND bu.journey_id = ?
  `).get(clientId, journeyId);
  return r ?? null;
}

export function recordUpload(clientId: string, journeyId: number, galleryId: number, photoId: number) {
  db.prepare('INSERT OR IGNORE INTO blog_uploads (client_id, journey_id, journey_photo_id, photo_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(clientId, journeyId, galleryId, photoId, now());
  return findUpload(clientId, journeyId);
}

// ── Public blog ──────────────────────────────────────────────────────────────

function publicJourneyFor(token: string): { journey_id: number } | null {
  const r = db.prepare('SELECT journey_id, share_blog FROM journey_share_tokens WHERE token = ?').get(token) as { journey_id: number; share_blog: number } | undefined;
  return r && r.share_blog ? { journey_id: r.journey_id } : null;
}

function publicShape<T extends { author: { id: number; username: string } | null }>(p: T) {
  return { ...p, author: p.author ? { username: p.author.username } : null };
}

export function getPublicBlog(token: string) {
  const share = publicJourneyFor(token);
  if (!share) return null;
  const journey = db.prepare('SELECT id, title, subtitle, cover_image FROM journeys WHERE id = ?').get(share.journey_id) as { title: string; subtitle: string | null; cover_image: string | null } | undefined;
  if (!journey) return null;
  const rows = db.prepare(`SELECT * FROM blog_posts WHERE journey_id = ? AND status = 'published' ORDER BY COALESCE(post_date, '') DESC, published_at DESC`).all(share.journey_id) as PostRow[];
  return {
    journey: { title: journey.title, subtitle: journey.subtitle, cover_image: journey.cover_image },
    posts: rows.map(r => publicShape(summary(r))),
  };
}

export function getPublicPost(token: string, slugOrId: string) {
  const share = publicJourneyFor(token);
  if (!share) return null;
  const row = db.prepare(`SELECT * FROM blog_posts WHERE journey_id = ? AND status = 'published' AND (slug = ? OR id = ?)`).get(share.journey_id, slugOrId, slugOrId) as PostRow | undefined;
  if (!row) return null;
  const all = db.prepare(`SELECT id, slug, title, post_date FROM blog_posts WHERE journey_id = ? AND status = 'published' ORDER BY COALESCE(post_date, '') ASC, published_at ASC`).all(share.journey_id) as { id: string; slug: string; title: string }[];
  const i = all.findIndex(p => p.id === row.id);
  const { own_entry_id: _own, add_to_journey: _add, ...post } = fullPost(row);
  return {
    post: publicShape(post),
    prev: i > 0 ? { slug: all[i - 1].slug, title: all[i - 1].title } : null,
    next: i >= 0 && i < all.length - 1 ? { slug: all[i + 1].slug, title: all[i + 1].title } : null,
  };
}

import type Database from 'better-sqlite3';

/**
 * Posts del blog que no estaban en la travesía (ni enlazaban entradas ni
 * tenían la suya): se les crea su entrada con su texto y fotos, marcada con
 * source_post_id para que el post la mantenga al día. Sin dependencias del
 * resto de servicios: la usa una migración.
 */
export function backfillBlogPostEntries(db: Database.Database): number {
  let created = 0
  const posts = db.prepare(`
    SELECT * FROM blog_posts bp
    WHERE NOT EXISTS (SELECT 1 FROM blog_post_entries bpe WHERE bpe.post_id = bp.id)
      AND NOT EXISTS (SELECT 1 FROM journey_entries je WHERE je.source_post_id = bp.id)
  `).all() as { id: string; journey_id: number; author_id: number | null; title: string; blocks: string; post_date: string | null; created_at: number }[];
  const owner = db.prepare('SELECT user_id FROM journeys WHERE id = ?');
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM journey_entries WHERE journey_id = ? AND entry_date = ?');
  const insEntry = db.prepare(`INSERT INTO journey_entries (journey_id, author_id, type, title, story, entry_date, visibility, sort_order, created_at, updated_at, source_post_id)
    VALUES (?, ?, 'entry', ?, ?, ?, 'private', ?, ?, ?, ?)`);
  const link = db.prepare('INSERT OR IGNORE INTO blog_post_entries (post_id, entry_id, sort_order) VALUES (?, ?, 0)');
  const photo = db.prepare('INSERT OR IGNORE INTO journey_entry_photos (entry_id, journey_photo_id, sort_order, created_at) VALUES (?, ?, ?, ?)');
  const inJourney = db.prepare('SELECT 1 FROM journey_photos WHERE id = ? AND journey_id = ?');
  for (const p of posts) {
    let blocks: any[] = [];
    try { blocks = JSON.parse(p.blocks || '[]'); } catch { blocks = []; }
    const parts: string[] = [];
    const photos: number[] = [];
    for (const b of blocks) {
      if (b?.type === 'paragraph' && b.text?.trim()) parts.push(b.text.trim());
      else if (b?.type === 'heading' && b.text?.trim()) parts.push(`${'#'.repeat(b.level === 3 ? 3 : 2)} ${b.text.trim()}`);
      else if (b?.type === 'quote' && b.text?.trim()) parts.push(`> ${b.text.trim()}`);
      else if (b?.type === 'photo' && b.photo?.galleryId) photos.push(b.photo.galleryId);
      else if (b?.type === 'gallery') for (const g of b.photos || []) if (g?.galleryId) photos.push(g.galleryId);
    }
    if (!p.title?.trim() && !parts.length && !photos.length) continue;
    const author = p.author_id ?? (owner.get(p.journey_id) as { user_id: number } | undefined)?.user_id;
    if (!author) continue;
    const date = p.post_date || new Date(p.created_at).toISOString().slice(0, 10);
    const now = Date.now();
    const order = ((maxOrder.get(p.journey_id, date) as { m: number | null }).m ?? -1) + 1;
    const r = insEntry.run(p.journey_id, author, p.title?.trim() || null, parts.join('\n\n') || null, date, order, now, now, p.id);
    const entryId = Number(r.lastInsertRowid);
    link.run(p.id, entryId);
    created++;
    [...new Set(photos)].forEach((gid, i) => { if (inJourney.get(gid, p.journey_id)) photo.run(entryId, gid, i, now); });
  }
  return created
}

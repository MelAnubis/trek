/**
 * La revista (4.5): una o varias travesías y relatos de la zona pública,
 * maquetados en formato bolsillo (estilo Far Ride) con el Studio de libros.
 *
 * Una revista es una travesía de kind = 'magazine': su «libro» del Studio es
 * la revista, y en su galería se enlazan las fotos que usa — así el Studio,
 * la exportación y el enlace público (share_book) la tratan como un libro
 * más, con permisos de foto que ya funcionan. La maqueta la hace el cliente
 * (Studio/magazineLayout.ts) con el mismo motor que el libro de una travesía.
 */
import { db } from '../db/database';
import { canAccessJourney, createJourney, listJourneys } from './journeyService';
import { getSitePostsFor } from './blogService';
import { siteJournals } from './siteService';

export function magazineSources(userId: number) {
  const journeys = listJourneys(userId)
    .filter(j => (j as { kind?: string }).kind !== 'magazine')
    .map(j => ({
      id: j.id, title: j.title, subtitle: (j as { subtitle?: string | null }).subtitle ?? null, cover_image: j.cover_image,
      entry_count: j.entry_count, photo_count: j.photo_count, date_min: j.trip_date_min, date_max: j.trip_date_max,
    }));
  const stories = getSitePostsFor(siteJournals());
  return { journeys, stories };
}

export function listMagazines(userId: number) {
  return listJourneys(userId).filter(j => (j as { kind?: string }).kind === 'magazine');
}

function photoIdsInBlocks(blocks: string): number[] {
  const ids = new Set<number>();
  for (const m of blocks.matchAll(/"photoId"\s*:\s*(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}

export interface CreateMagazineInput {
  title: string;
  subtitle?: string | null;
  journey_ids: number[];
  story_ids: string[];
}

export type CreateMagazineResult =
  | { ok: true; journeyId: number; volume: number }
  | { ok: false; status: number; error: string };

export function createMagazine(userId: number, input: CreateMagazineInput): CreateMagazineResult {
  const journeyIds = [...new Set(input.journey_ids)];
  const storyIds = [...new Set(input.story_ids)];
  if (!journeyIds.length && !storyIds.length) return { ok: false, status: 400, error: 'Pick at least one journey or story' };
  for (const id of journeyIds) {
    const j = canAccessJourney(id, userId) as { kind?: string } | null;
    if (!j || j.kind === 'magazine') return { ok: false, status: 404, error: 'Journey not found' };
  }
  const journals = siteJournals();
  const stories = storyIds.map(id => db.prepare(`SELECT id, journey_id, blocks, cover_photo_id FROM blog_posts WHERE id = ? AND status = 'published'`).get(id) as { id: string; journey_id: number; blocks: string; cover_photo_id: number | null } | undefined);
  if (stories.some(s => !s || !journals.includes(s.journey_id))) return { ok: false, status: 404, error: 'Story not found' };

  const volume = listMagazines(userId).length + 1;
  return db.transaction(() => {
    const mag = createJourney(userId, { title: input.title.trim() || `#ESTODOBAJADA Vol. ${volume}`, subtitle: input.subtitle ?? `Vol. ${volume}` });
    const magId = Number(mag.id);
    db.prepare("UPDATE journeys SET kind = 'magazine', magazine_meta = ? WHERE id = ?")
      .run(JSON.stringify({ volume, journeys: journeyIds, stories: storyIds }), magId);

    // The photos the magazine may use, linked into its own gallery.
    const link = db.prepare(`INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, caption, provider, asset_id, owner_id, created_at, sort_order)
      SELECT ?, photo_id, caption, provider, asset_id, owner_id, ?, sort_order FROM journey_photos WHERE journey_id = ? AND photo_id = ?`);
    const now = Date.now();
    for (const id of journeyIds) {
      const photos = db.prepare('SELECT photo_id FROM journey_photos WHERE journey_id = ?').all(id) as { photo_id: number }[];
      for (const p of photos) link.run(magId, now, id, p.photo_id);
    }
    for (const s of stories) {
      const ids = photoIdsInBlocks(s!.blocks);
      if (s!.cover_photo_id) ids.push(s!.cover_photo_id);
      for (const pid of ids) link.run(magId, now, s!.journey_id, pid);
    }
    return { ok: true as const, journeyId: magId, volume };
  })();
}

import { db, canAccessTrip } from '../db/database';
import { broadcastToUser } from '../websocket';
import type { Journey, JourneyEntry, JourneyPhoto, JourneyContributor } from '../types';
import { getOrCreateTrekPhoto, getOrCreateLocalTrekPhoto, setTrekPhotoProvider, deleteTrekPhotoIfOrphan } from './memories/photoResolverService';
import { getCountryFromCoords } from './atlasService';

function ts(): number {
  return Date.now();
}

// Per-entry photo view: join journey_entry_photos → journey_photos (gallery) → trek_photos.
// id = gp.id (gallery photo id) — used by clients for linkPhoto/updatePhoto/unlink/delete.
const JP_SELECT = `
  gp.id, jep.entry_id, gp.photo_id, gp.caption, jep.sort_order, gp.shared, gp.created_at,
  tp.provider, tp.asset_id, tp.owner_id, tp.file_path, tp.thumbnail_path, tp.width, tp.height, tp.taken_at, tp.lat, tp.lng
`;
const JP_JOIN = `journey_entry_photos jep
  JOIN journey_photos gp ON gp.id  = jep.journey_photo_id
  JOIN trek_photos    tp ON tp.id  = gp.photo_id`;

// Per-journey gallery view: journey_photos → trek_photos (no entry context).
// Sorted by when the photo was actually taken, not when it was linked into
// the journey — a photo pulled in from an old Immich album should land on
// the day it was shot, not at the end because that's when someone dragged
// it in. Falls back to the link date for a photo whose capture date isn't
// known yet (not yet resolved, or a provider/local file where it never will
// be) rather than dropping it out of order entirely.
const GALLERY_SELECT = `
  gp.id, gp.journey_id, gp.photo_id, gp.caption, gp.shared, gp.sort_order, gp.created_at,
  tp.provider, tp.asset_id, tp.owner_id, tp.file_path, tp.thumbnail_path, tp.width, tp.height, tp.taken_at, tp.lat, tp.lng
`;
const GALLERY_JOIN = 'journey_photos gp JOIN trek_photos tp ON tp.id = gp.photo_id';
const GALLERY_ORDER = 'ORDER BY COALESCE(tp.taken_at, gp.created_at) ASC, gp.id ASC';

export function broadcastJourneyEvent(journeyId: number, event: string, data: Record<string, unknown>, excludeSocketId?: string | number) {
  const contributors = db.prepare(
    'SELECT user_id FROM journey_contributors WHERE journey_id = ?'
  ).all(journeyId) as { user_id: number }[];
  const owner = db.prepare('SELECT user_id FROM journeys WHERE id = ?').get(journeyId) as { user_id: number } | undefined;

  const userIds = new Set(contributors.map(c => c.user_id));
  if (owner) userIds.add(owner.user_id);

  for (const uid of userIds) {
    broadcastToUser(uid, { type: event, journeyId, ...data }, excludeSocketId);
  }
}

// ── Access control ───────────────────────────────────────────────────────

export function canAccessJourney(journeyId: number, userId: number): Journey | null {
  const own = db.prepare('SELECT * FROM journeys WHERE id = ? AND user_id = ?').get(journeyId, userId) as Journey | undefined;
  if (own) return own;
  const contrib = db.prepare(
    'SELECT 1 FROM journey_contributors WHERE journey_id = ? AND user_id = ?'
  ).get(journeyId, userId);
  if (contrib) return db.prepare('SELECT * FROM journeys WHERE id = ?').get(journeyId) as Journey || null;
  return null;
}

export function isOwner(journeyId: number, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM journeys WHERE id = ? AND user_id = ?').get(journeyId, userId);
}

export function canEdit(journeyId: number, userId: number): boolean {
  if (isOwner(journeyId, userId)) return true;
  const c = db.prepare(
    "SELECT role FROM journey_contributors WHERE journey_id = ? AND user_id = ?"
  ).get(journeyId, userId) as { role: string } | undefined;
  return c?.role === 'editor' || c?.role === 'owner';
}

// ── Journey CRUD ─────────────────────────────────────────────────────────

export function listJourneys(userId: number) {
  return db.prepare(`
    SELECT DISTINCT j.*,
      (SELECT COUNT(*) FROM journey_entries je WHERE je.journey_id = j.id AND je.type != 'skeleton') as entry_count,
      (SELECT COUNT(*) FROM journey_photos jp WHERE jp.journey_id = j.id) as photo_count,
      (SELECT COUNT(DISTINCT je3.location_name) FROM journey_entries je3 WHERE je3.journey_id = j.id AND je3.location_name IS NOT NULL AND je3.location_name != '') as place_count,
      (SELECT MIN(t.start_date) FROM journey_trips jt JOIN trips t ON jt.trip_id = t.id WHERE jt.journey_id = j.id) as trip_date_min,
      (SELECT MAX(t.end_date) FROM journey_trips jt JOIN trips t ON jt.trip_id = t.id WHERE jt.journey_id = j.id) as trip_date_max
    FROM journeys j
    LEFT JOIN journey_contributors jc ON j.id = jc.journey_id AND jc.user_id = ?
    WHERE j.user_id = ? OR jc.user_id = ?
    ORDER BY j.updated_at DESC
  `).all(userId, userId, userId) as (Journey & { entry_count: number; photo_count: number; place_count: number; trip_date_min: string | null; trip_date_max: string | null })[];
}

export function createJourney(userId: number, data: {
  title: string;
  subtitle?: string;
  trip_ids?: number[];
}): Journey {
  const now = ts();
  const res = db.prepare(`
    INSERT INTO journeys (user_id, title, subtitle, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(userId, data.title, data.subtitle || null, now, now);

  const journeyId = Number(res.lastInsertRowid);

  // add owner as contributor
  db.prepare(
    'INSERT INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
  ).run(journeyId, userId, 'owner', now);

  // link trips and sync skeleton entries
  if (data.trip_ids?.length) {
    for (const tripId of data.trip_ids) {
      addTripToJourney(journeyId, tripId, userId);
    }

    // inherit cover image from first selected trip
    const firstTrip = db.prepare('SELECT cover_image FROM trips WHERE id = ?').get(data.trip_ids[0]) as { cover_image: string | null } | undefined;
    if (firstTrip?.cover_image) {
      // trip stores full path (/uploads/covers/x.jpg), journey stores relative (covers/x.jpg)
      const relativePath = firstTrip.cover_image.replace(/^\/uploads\//, '');
      db.prepare('UPDATE journeys SET cover_image = ? WHERE id = ?').run(relativePath, journeyId);
    }
  }

  return db.prepare('SELECT * FROM journeys WHERE id = ?').get(journeyId) as Journey;
}

export function getJourneyFull(journeyId: number, userId: number) {
  const journey = canAccessJourney(journeyId, userId);
  if (!journey) return null;

  // Whatever changed in the linked trips since the last look (days, places,
  // dates — from any screen, import or tool) is brought in before reading.
  const linkedTripIds = (db.prepare('SELECT trip_id FROM journey_trips WHERE journey_id = ?').all(journeyId) as { trip_id: number }[]).map(r => r.trip_id);
  for (const tid of linkedTripIds) {
    try { reconcileTripEntries(journeyId, tid); } catch (err) { console.error('[journey] reconcile failed', journeyId, tid, err); }
  }

  const entries = db.prepare(
    'SELECT * FROM journey_entries WHERE journey_id = ? ORDER BY entry_date ASC, sort_order ASC, id ASC'
  ).all(journeyId) as JourneyEntry[];

  const photos = db.prepare(
    `SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE jep.entry_id IN (SELECT id FROM journey_entries WHERE journey_id = ?) ORDER BY jep.sort_order ASC`
  ).all(journeyId) as JourneyPhoto[];

  // group photos by entry
  const photosByEntry: Record<number, JourneyPhoto[]> = {};
  for (const p of photos) {
    (photosByEntry[p.entry_id] ||= []).push(p);
  }

  const gallery = db.prepare(
    `SELECT ${GALLERY_SELECT} FROM ${GALLERY_JOIN} WHERE gp.journey_id = ? ${GALLERY_ORDER}`
  ).all(journeyId);

  const enrichedEntries = entries
    .map(e => ({
      ...e,
      tags: e.tags ? JSON.parse(e.tags) : [],
      pros_cons: e.pros_cons ? JSON.parse(e.pros_cons) : null,
      photos: photosByEntry[e.id] || [],
      source_trip_name: e.source_trip_id
        ? (db.prepare('SELECT title FROM trips WHERE id = ?').get(e.source_trip_id) as { title: string } | undefined)?.title || null
        : null,
    }));

  // linked trips
  const trips = db.prepare(`
    SELECT jt.trip_id, jt.added_at, t.title, t.start_date, t.end_date, t.cover_image, t.currency,
      (SELECT COUNT(*) FROM places WHERE trip_id = t.id) as place_count
    FROM journey_trips jt JOIN trips t ON jt.trip_id = t.id
    WHERE jt.journey_id = ? ORDER BY t.start_date ASC
  `).all(journeyId);

  // contributors
  const contributorsRaw = db.prepare(`
    SELECT jc.journey_id, jc.user_id, jc.role, jc.added_at, u.username, u.avatar
    FROM journey_contributors jc JOIN users u ON jc.user_id = u.id
    WHERE jc.journey_id = ? ORDER BY jc.added_at
  `).all(journeyId) as any[];
  const contributors = contributorsRaw.map(c => ({
    ...c,
    avatar_url: c.avatar ? `/uploads/avatars/${c.avatar}` : null,
  }));

  // stats
  const entryCount = entries.filter(e => e.type === 'entry').length;
  const photoCount = (gallery as any[]).length;
  const places = [...new Set(entries.map(e => e.location_name).filter(Boolean))];

  // Distinct countries, resolved offline from each entry's own lat/lng via
  // atlasService's bounding-box lookup (same one the Atlas feature uses) —
  // no geocoding network call, so this stays cheap even for a journey with
  // many entries. An entry with no coordinates just doesn't vote.
  const countrySet = new Set<string>();
  // Also kept per entry and in visit order (entries are date-sorted), for the
  // book's country page and its per-entry flag marks.
  const entryCountry = new Map<number, string>();
  for (const e of entries) {
    if (e.location_lat != null && e.location_lng != null) {
      const code = getCountryFromCoords(e.location_lat, e.location_lng);
      if (code) { countrySet.add(code); entryCountry.set(e.id, code); }
    }
  }
  for (const e of enrichedEntries) (e as typeof e & { country_code: string | null }).country_code = entryCountry.get(e.id) ?? null;

  // Budget total, in the earliest-linked trip's own currency — summed across
  // every linked trip's expenses in that same currency (an item's own
  // currency wins over its trip's, same fallback the legacy PDF export
  // already uses). A multi-trip journey mixing currencies still only
  // surfaces one figure here (this is a single stat tile, not a
  // breakdown) — the legacy export's per-currency pill list is still the
  // place for the full picture.
  const tripsList = trips as { trip_id: number; currency: string | null }[];
  const primaryCurrency = (tripsList[0]?.currency || 'EUR').toUpperCase();
  let budgetTotal = 0;
  if (tripsList.length > 0) {
    const tripIds = tripsList.map(t => t.trip_id);
    const placeholders = tripIds.map(() => '?').join(',');
    const budgetRows = db.prepare(
      `SELECT total_price, currency, trip_id FROM budget_items WHERE trip_id IN (${placeholders})`
    ).all(...tripIds) as { total_price: number; currency: string | null; trip_id: number }[];
    const currencyByTrip = new Map(tripsList.map(t => [t.trip_id, (t.currency || 'EUR').toUpperCase()]));
    for (const row of budgetRows) {
      const cur = (row.currency || currencyByTrip.get(row.trip_id) || 'EUR').toUpperCase();
      if (cur === primaryCurrency) budgetTotal += row.total_price || 0;
    }
  }

  const userPrefs = db.prepare(
    'SELECT hide_skeletons FROM journey_contributors WHERE journey_id = ? AND user_id = ?'
  ).get(journeyId, userId) as { hide_skeletons: number } | undefined;

  // Only trips this viewer can open themselves: a journey contributor who is
  // not on the trip must not read its notes (they hold booking codes, etc.).
  const plannerNotes = plannerNotesByDate(
    journeyId,
    (trips as { trip_id: number }[]).map(t => t.trip_id).filter(id => !!canAccessTrip(id, userId)),
  );

  // Determine the viewer's role on this journey so the UI can gate edit/settings
  // actions. 'owner' = creator, 'editor' | 'viewer' = from journey_contributors.
  const journeyRow = journey as unknown as { user_id?: number };
  let myRole: 'owner' | 'editor' | 'viewer' | null = null;
  if (journeyRow.user_id === userId) {
    myRole = 'owner';
  } else {
    const contribRow = db.prepare(
      'SELECT role FROM journey_contributors WHERE journey_id = ? AND user_id = ?'
    ).get(journeyId, userId) as { role: 'editor' | 'viewer' } | undefined;
    myRole = contribRow?.role ?? null;
  }

  return {
    ...journey,
    entries: enrichedEntries,
    gallery,
    trips,
    contributors,
    stats: { entries: entryCount, photos: photoCount, places: places.length, countries: countrySet.size, countryCodes: [...countrySet], budgetTotal, budgetCurrency: primaryCurrency },
    hide_skeletons: !!(userPrefs?.hide_skeletons),
    my_role: myRole,
    planner_notes: plannerNotes,
  };
}

export interface PlannerNote {
  id: number;
  trip_id: number;
  day_number: number;
  day_title: string | null;
  text: string;
  /** The note's description (the planner stores it in `time`). */
  description: string | null;
  icon: string | null;
  color: string | null;
}

/**
 * The linked trips' day notes ("notas del día"), keyed by the journey date
 * each day lands on — placeEntryDate, the same rule the trip's places use,
 * so a note sits on the same day as that day's stops, dated trip or not.
 * Read live, not copied: editing a note in the planner shows here at once.
 */
export function plannerNotesByDate(journeyId: number, tripIds: number[]): Record<string, PlannerNote[]> {
  const out: Record<string, PlannerNote[]> = {};
  for (const tripId of tripIds) {
    const rows = db.prepare(`
      SELECT n.id, n.text, n.time, n.icon, n.color, d.day_number, d.date, d.title
      FROM day_notes n JOIN days d ON d.id = n.day_id
      WHERE n.trip_id = ?
      ORDER BY d.day_number ASC, n.sort_order ASC, n.id ASC
    `).all(tripId) as { id: number; text: string; time: string | null; icon: string | null; color: string | null; day_number: number; date: string | null; title: string | null }[];
    for (const r of rows) {
      const date = placeEntryDate(journeyId, tripId, { day_date: r.date, day_number: r.day_number });
      (out[date] ||= []).push({
        id: r.id, trip_id: tripId, day_number: r.day_number, day_title: r.title || null,
        text: r.text, description: r.time || null, icon: r.icon || null, color: r.color || null,
      });
    }
  }
  return out;
}

export function updateJourney(journeyId: number, userId: number, data: Partial<{
  title: string;
  subtitle: string;
  cover_gradient: string;
  cover_image: string;
  status: string;
}>): Journey | null {
  // Journey-level settings (title, cover, status) are owner-only — editors
  // may only edit entries and photos, not reshape the journey itself.
  if (!isOwner(journeyId, userId)) return null;

  const ALLOWED_STATUSES = ['draft', 'active', 'completed', 'archived'];
  const allowed = ['title', 'subtitle', 'cover_gradient', 'cover_image', 'status'];
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && allowed.includes(key)) {
      if (key === 'status' && !ALLOWED_STATUSES.includes(val as string)) continue;
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return db.prepare('SELECT * FROM journeys WHERE id = ?').get(journeyId) as Journey;

  fields.push('updated_at = ?');
  values.push(ts());
  values.push(journeyId);
  db.prepare(`UPDATE journeys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM journeys WHERE id = ?').get(journeyId) as Journey;
}

export function updateJourneyPreferences(journeyId: number, userId: number, data: { hide_skeletons?: boolean }) {
  if (!canAccessJourney(journeyId, userId)) return null;
  if (data.hide_skeletons !== undefined) {
    db.prepare(
      'UPDATE journey_contributors SET hide_skeletons = ? WHERE journey_id = ? AND user_id = ?'
    ).run(data.hide_skeletons ? 1 : 0, journeyId, userId);
  }
  const row = db.prepare(
    'SELECT hide_skeletons FROM journey_contributors WHERE journey_id = ? AND user_id = ?'
  ).get(journeyId, userId) as { hide_skeletons: number };
  return { hide_skeletons: !!row.hide_skeletons };
}

export function deleteJourney(journeyId: number, userId: number): boolean {
  if (!isOwner(journeyId, userId)) return false;
  db.prepare('DELETE FROM journeys WHERE id = ?').run(journeyId);
  return true;
}

// ── Trip management ──────────────────────────────────────────────────────

export function addTripToJourney(journeyId: number, tripId: number, userId: number): boolean {
  const now = ts();
  try {
    db.prepare(
      'INSERT OR IGNORE INTO journey_trips (journey_id, trip_id, added_at) VALUES (?, ?, ?)'
    ).run(journeyId, tripId, now);
  } catch { return false; }

  // sync skeleton entries for all places in this trip
  syncTripPlaces(journeyId, tripId, userId);
  // import existing trip photos (Immich/Synology) with sharing settings
  syncTripPhotos(journeyId, tripId);
  broadcastJourneyEvent(journeyId, 'journey:trip:synced', { tripId });
  return true;
}

export function removeTripFromJourney(journeyId: number, tripId: number, userId: number): boolean {
  if (!isOwner(journeyId, userId)) return false;

  // remove skeleton entries that haven't been filled in
  db.prepare(`
    DELETE FROM journey_entries
    WHERE journey_id = ? AND source_trip_id = ? AND type = 'skeleton'
  `).run(journeyId, tripId);

  // detach filled entries from this trip
  db.prepare(`
    UPDATE journey_entries SET source_trip_id = NULL, source_place_id = NULL
    WHERE journey_id = ? AND source_trip_id = ? AND type != 'skeleton'
  `).run(journeyId, tripId);

  db.prepare('DELETE FROM journey_trips WHERE journey_id = ? AND trip_id = ?').run(journeyId, tripId);
  return true;
}

// ── Sync engine ──────────────────────────────────────────────────────────

/**
 * The date a trip place's skeleton entry goes on.
 *
 * A dated trip day gives it directly. An undated one used to fall back to
 * *today* for every place, so a 7-day trip without dates landed entirely on
 * one day of the journey. Instead the day keeps its position: the trip's
 * start date (if it has one) or, failing that, the day the journey was
 * created, plus (day number - 1) days. The anchor is stored data, not the
 * clock, so places added later land on the same days as the first sync.
 */
function placeEntryDate(journeyId: number, tripId: number, place: { day_date?: string | null; day_number?: number | null }): string {
  if (place.day_date && /^\d{4}-\d{2}-\d{2}/.test(place.day_date)) return place.day_date.slice(0, 10);
  const trip = db.prepare('SELECT start_date FROM trips WHERE id = ?').get(tripId) as { start_date: string | null } | undefined;
  let anchor = trip?.start_date && /^\d{4}-\d{2}-\d{2}/.test(trip.start_date) ? trip.start_date.slice(0, 10) : null;
  if (!anchor) {
    const j = db.prepare('SELECT created_at FROM journeys WHERE id = ?').get(journeyId) as { created_at: number } | undefined;
    anchor = new Date(j?.created_at ?? Date.now()).toISOString().slice(0, 10);
  }
  const offset = Math.max(0, (Number(place.day_number) || 1) - 1);
  const d = new Date(`${anchor}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function syncTripPlaces(journeyId: number, tripId: number, authorId: number) {
  reconcileTripEntries(journeyId, tripId, authorId);
}

interface DesiredEntry {
  placeId: number | null;
  dayId: number;
  title: string | null;
  date: string;
  time: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Bring a journey's suggested entries ("skeletons") in line with its linked
 * trip, as the trip is now. Run when a trip is linked, when a place changes,
 * and every time the journey is opened — so anything done in the planner
 * (a place assigned, moved to another day or taken off one, a day added or
 * deleted, the trip's dates changed) shows in the journey, whichever screen,
 * import or MCP tool made the change.
 *
 * - One entry per place PER DAY: a loop route that starts and ends in the
 *   same town has that town on its first and last day.
 * - A day with no places but a name or a recorded track still gets its day.
 * - Skeletons follow the trip completely (title, day, time, place). An entry
 *   somebody has written in follows only the place's location — its words
 *   and its date are theirs.
 * - A skeleton the trip no longer has is removed; one with photos or text is
 *   kept and detached rather than lost.
 */
export function reconcileTripEntries(journeyId: number, tripId: number, authorId?: number): void {
  const assignments = db.prepare(`
    SELECT p.id AS place_id, p.name, p.address, p.lat, p.lng, p.place_time,
           da.day_id, da.assignment_time, d.date AS day_date, d.day_number
    FROM day_assignments da
    JOIN places p ON p.id = da.place_id
    JOIN days d ON d.id = da.day_id
    WHERE p.trip_id = ? AND d.trip_id = ?
    ORDER BY d.day_number ASC, da.order_index ASC, da.id ASC
  `).all(tripId, tripId) as any[];
  const days = db.prepare(`
    SELECT d.id, d.date, d.day_number, d.title,
           EXISTS (SELECT 1 FROM gpx_tracks g WHERE g.day_id = d.id) AS has_track
    FROM days d WHERE d.trip_id = ? ORDER BY d.day_number ASC
  `).all(tripId) as { id: number; date: string | null; day_number: number; title: string | null; has_track: number }[];

  const desired: DesiredEntry[] = [];
  const seen = new Set<string>();
  for (const a of assignments) {
    const key = `${a.place_id}:${a.day_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    desired.push({
      placeId: a.place_id, dayId: a.day_id, title: a.name,
      date: placeEntryDate(journeyId, tripId, { day_date: a.day_date, day_number: a.day_number }),
      time: a.assignment_time || a.place_time || null,
      location: a.address || a.name, lat: a.lat ?? null, lng: a.lng ?? null,
    });
  }
  const daysWithPlaces = new Set(assignments.map(a => a.day_id));
  for (const d of days) {
    if (daysWithPlaces.has(d.id) || (!d.title?.trim() && !d.has_track)) continue;
    desired.push({
      placeId: null, dayId: d.id, title: d.title?.trim() || null,
      date: placeEntryDate(journeyId, tripId, { day_date: d.date, day_number: d.day_number }),
      time: null, location: null, lat: null, lng: null,
    });
  }

  const existing = db.prepare(
    'SELECT * FROM journey_entries WHERE journey_id = ? AND source_trip_id = ? ORDER BY id ASC'
  ).all(journeyId, tripId) as JourneyEntry[];
  const keyOf = (placeId: number | null | undefined, dayId: number | null | undefined) => `${placeId ?? '-'}:${dayId ?? '?'}`;
  const byKey = new Map<string, JourneyEntry>();
  const loose: JourneyEntry[] = [];
  for (const e of existing) {
    if (e.source_day_id == null && e.source_place_id != null) { loose.push(e); continue; }
    if (e.source_day_id == null) continue;
    const k = keyOf(e.source_place_id, e.source_day_id);
    if (byKey.has(k)) loose.push(e); else byKey.set(k, e);
  }

  const now = ts();
  const owner = authorId ?? (db.prepare('SELECT user_id FROM journeys WHERE id = ?').get(journeyId) as { user_id: number } | undefined)?.user_id;
  const maxOrder = new Map<string, number>();
  for (const r of db.prepare(
    'SELECT entry_date, COALESCE(MAX(sort_order), -1) AS m FROM journey_entries WHERE journey_id = ? GROUP BY entry_date'
  ).all(journeyId) as { entry_date: string; m: number }[]) maxOrder.set(r.entry_date, r.m);

  const kept = new Set<number>();
  const insert = db.prepare(`
    INSERT INTO journey_entries (journey_id, source_trip_id, source_place_id, source_day_id, author_id, type, title, entry_date, entry_time, location_name, location_lat, location_lng, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'skeleton', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSkeleton = db.prepare(`
    UPDATE journey_entries SET source_day_id = ?, title = ?, entry_date = ?, entry_time = ?, location_name = ?, location_lat = ?, location_lng = ?, updated_at = ?
    WHERE id = ?
  `);
  const updateFilled = db.prepare('UPDATE journey_entries SET source_day_id = ?, location_name = ?, location_lat = ?, location_lng = ?, updated_at = ? WHERE id = ?');

  for (const want of desired) {
    let row = byKey.get(keyOf(want.placeId, want.dayId));
    if (!row && want.placeId != null) {
      // A row from before entries knew their day: claim it for this place.
      const i = loose.findIndex(e => e.source_place_id === want.placeId);
      if (i >= 0) row = loose.splice(i, 1)[0];
    }
    if (row) {
      kept.add(row.id);
      if (row.type === 'skeleton') {
        const changed = row.title !== want.title || row.entry_date !== want.date || (row.entry_time ?? null) !== want.time
          || (row.location_name ?? null) !== want.location || (row.location_lat ?? null) !== want.lat || (row.location_lng ?? null) !== want.lng
          || row.source_day_id !== want.dayId;
        if (changed) updateSkeleton.run(want.dayId, want.title, want.date, want.time, want.location, want.lat, want.lng, now, row.id);
      } else if (want.placeId != null) {
        const changed = (row.location_name ?? null) !== want.location || (row.location_lat ?? null) !== want.lat
          || (row.location_lng ?? null) !== want.lng || row.source_day_id !== want.dayId;
        if (changed) updateFilled.run(want.dayId, want.location, want.lat, want.lng, now, row.id);
      }
      continue;
    }
    if (owner == null) continue;
    const order = (maxOrder.get(want.date) ?? -1) + 1;
    maxOrder.set(want.date, order);
    insert.run(journeyId, tripId, want.placeId, want.dayId, owner, want.title, want.date, want.time, want.location, want.lat, want.lng, order, now, now);
  }

  // What the trip no longer has.
  for (const e of existing) {
    if (kept.has(e.id) || e.type !== 'skeleton') continue;
    const hasPhotos = db.prepare('SELECT 1 FROM journey_entry_photos WHERE entry_id = ?').get(e.id);
    if (!hasPhotos && !(e.story || '').trim()) {
      db.prepare('DELETE FROM journey_entries WHERE id = ?').run(e.id);
    } else {
      db.prepare("UPDATE journey_entries SET type = 'entry', source_place_id = NULL, source_day_id = NULL, source_trip_id = NULL, updated_at = ? WHERE id = ?").run(now, e.id);
    }
  }
}

/** Every journey a trip is linked to, reconciled with it. */
export function reconcileTripJourneys(tripId: number): void {
  const links = db.prepare('SELECT journey_id FROM journey_trips WHERE trip_id = ?').all(tripId) as { journey_id: number }[];
  for (const l of links) {
    try { reconcileTripEntries(l.journey_id, tripId); } catch (err) { console.error('[journey] reconcile failed', l.journey_id, tripId, err); }
  }
}

// import trip_photos into journey gallery when a trip is linked
function syncTripPhotos(journeyId: number, tripId: number) {
  const tripPhotos = db.prepare(
    'SELECT tp.photo_id, tp.shared FROM trip_photos tp WHERE tp.trip_id = ?'
  ).all(tripId) as { photo_id: number; shared: number }[];
  if (!tripPhotos.length) return;

  const now = ts();
  const maxOrderRow = db.prepare('SELECT MAX(sort_order) as m FROM journey_photos WHERE journey_id = ?').get(journeyId) as { m: number | null };
  let nextOrder = (maxOrderRow?.m ?? -1) + 1;

  for (const tp of tripPhotos) {
    db.prepare(`
      INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, shared, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(journeyId, tp.photo_id, tp.shared, nextOrder++, now);
  }
}

// called when a trip place is created
export function onPlaceCreated(tripId: number, _placeId?: number) {
  reconcileTripJourneys(tripId);
}

// called when a trip place is updated (or moved to another day)
export function onPlaceUpdated(placeId: number) {
  const row = db.prepare('SELECT trip_id FROM places WHERE id = ?').get(placeId) as { trip_id: number } | undefined;
  if (row) reconcileTripJourneys(row.trip_id);
}

// called when a trip place is deleted
export function onPlaceDeleted(placeId: number) {
  const entries = db.prepare(
    'SELECT * FROM journey_entries WHERE source_place_id = ?'
  ).all(placeId) as JourneyEntry[];

  for (const entry of entries) {
    if (entry.type === 'skeleton') {
      // no content: just delete
      const hasPhotos = db.prepare('SELECT 1 FROM journey_entry_photos WHERE entry_id = ?').get(entry.id);
      if (!hasPhotos && !entry.story) {
        db.prepare('DELETE FROM journey_entries WHERE id = ?').run(entry.id);
        continue;
      }
    }
    // entry has content: keep it, detach, add note
    const note = '\n\n> _Note: the original trip place was removed from the trip plan_';
    const newStory = (entry.story || '') + note;
    db.prepare(
      'UPDATE journey_entries SET source_place_id = NULL, source_trip_id = NULL, type = ?, story = ?, updated_at = ? WHERE id = ?'
    ).run(entry.type === 'skeleton' ? 'entry' : entry.type, newStory, ts(), entry.id);
  }
}

// ── Entries ──────────────────────────────────────────────────────────────

export function listEntries(journeyId: number, userId: number) {
  if (!canAccessJourney(journeyId, userId)) return null;

  const entries = db.prepare(
    'SELECT * FROM journey_entries WHERE journey_id = ? ORDER BY entry_date ASC, sort_order ASC, id ASC'
  ).all(journeyId) as JourneyEntry[];

  const photos = db.prepare(
    `SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE jep.entry_id IN (SELECT id FROM journey_entries WHERE journey_id = ?) ORDER BY jep.sort_order ASC`
  ).all(journeyId) as JourneyPhoto[];

  const photosByEntry: Record<number, JourneyPhoto[]> = {};
  for (const p of photos) {
    (photosByEntry[p.entry_id] ||= []).push(p);
  }

  return entries.map(e => ({
    ...e,
    tags: e.tags ? JSON.parse(e.tags) : [],
    pros_cons: e.pros_cons ? JSON.parse(e.pros_cons) : null,
    photos: photosByEntry[e.id] || [],
    source_trip_name: e.source_trip_id
      ? (db.prepare('SELECT title FROM trips WHERE id = ?').get(e.source_trip_id) as { title: string } | undefined)?.title || null
      : null,
  }));
}

export function createEntry(journeyId: number, userId: number, data: {
  type?: string;
  title?: string;
  story?: string;
  entry_date: string;
  entry_time?: string;
  location_name?: string;
  location_lat?: number;
  location_lng?: number;
  mood?: string;
  weather?: string;
  tags?: string[];
  pros_cons?: { pros: string[]; cons: string[] };
  visibility?: string;
  /** Position within its day. Omitted: after the day's last entry. */
  sort_order?: number;
}, sid?: string): JourneyEntry | null {
  if (!canEdit(journeyId, userId)) return null;

  const now = ts();
  const maxOrder = db.prepare(
    'SELECT MAX(sort_order) as m FROM journey_entries WHERE journey_id = ? AND entry_date = ?'
  ).get(journeyId, data.entry_date) as { m: number | null };

  const prosConsJson = data.pros_cons && (data.pros_cons.pros.length || data.pros_cons.cons.length)
    ? JSON.stringify(data.pros_cons) : null;

  const res = db.prepare(`
    INSERT INTO journey_entries (journey_id, author_id, type, title, story, entry_date, entry_time, location_name, location_lat, location_lng, mood, weather, tags, pros_cons, visibility, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    journeyId, userId,
    data.type || 'entry',
    data.title || null,
    data.story || null,
    data.entry_date,
    data.entry_time || null,
    data.location_name || null,
    data.location_lat ?? null,
    data.location_lng ?? null,
    data.mood || null,
    data.weather || null,
    data.tags?.length ? JSON.stringify(data.tags) : null,
    prosConsJson,
    data.visibility || 'private',
    // The MCP create_journey_entry tool takes a sort_order; it used to be
    // dropped here, so every entry it created landed last regardless.
    Number.isInteger(data.sort_order) && (data.sort_order as number) >= 0 ? data.sort_order : (maxOrder?.m ?? -1) + 1,
    now, now
  );

  const created = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(Number(res.lastInsertRowid)) as JourneyEntry;
  broadcastJourneyEvent(journeyId, 'journey:entry:created', { entry: created }, sid);
  return created;
}

export function updateEntry(entryId: number, userId: number, data: Partial<{
  type: string;
  title: string;
  story: string;
  entry_date: string;
  entry_time: string;
  location_name: string;
  location_lat: number;
  location_lng: number;
  mood: string;
  weather: string;
  tags: string[];
  pros_cons: { pros: string[]; cons: string[] };
  visibility: string;
  sort_order: number;
}>, sid?: string): JourneyEntry | null {
  const entry = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry | undefined;
  if (!entry) return null;
  if (!canEdit(entry.journey_id, userId)) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue;
    if (key === 'tags') {
      fields.push('tags = ?');
      values.push(Array.isArray(val) ? JSON.stringify(val) : val);
    } else if (key === 'pros_cons') {
      fields.push('pros_cons = ?');
      values.push(val && typeof val === 'object' ? JSON.stringify(val) : val);
    } else {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  // if adding story to a skeleton, promote to entry
  if (entry.type === 'skeleton' && data.story && data.story.trim()) {
    fields.push('type = ?');
    values.push('entry');
  }

  if (fields.length === 0) return entry;

  fields.push('updated_at = ?');
  values.push(ts());
  values.push(entryId);
  db.prepare(`UPDATE journey_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // touch the journey
  db.prepare('UPDATE journeys SET updated_at = ? WHERE id = ?').run(ts(), entry.journey_id);

  const updated = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry;
  broadcastJourneyEvent(entry.journey_id, 'journey:entry:updated', { entry: updated }, sid);
  return updated;
}

// Reorder entries (typically within a single day). Caller passes the new
// desired order of ids; each entry's sort_order is set to its index in the
// array. Only entries owned by this journey are accepted.
export function reorderEntries(journeyId: number, userId: number, orderedIds: number[], sid?: string): boolean {
  if (!canEdit(journeyId, userId)) return false;
  if (!orderedIds.length) return true;

  const placeholders = orderedIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id FROM journey_entries WHERE id IN (${placeholders}) AND journey_id = ?`)
    .all(...orderedIds, journeyId) as { id: number }[];
  if (rows.length !== orderedIds.length) return false;

  const now = ts();
  const update = db.prepare('UPDATE journey_entries SET sort_order = ?, updated_at = ? WHERE id = ?');
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => update.run(index, now, id));
    db.prepare('UPDATE journeys SET updated_at = ? WHERE id = ?').run(now, journeyId);
  });
  tx();

  broadcastJourneyEvent(journeyId, 'journey:entries:reordered', { orderedIds }, sid);
  return true;
}

export function deleteEntry(entryId: number, userId: number, sid?: string): boolean {
  const entry = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry | undefined;
  if (!entry) return false;
  if (!canEdit(entry.journey_id, userId)) return false;

  if (entry.source_trip_id && entry.source_place_id && entry.type !== 'skeleton') {
    // Revert filled entry back to skeleton instead of deleting
    db.prepare(`
      UPDATE journey_entries
      SET type = 'skeleton', story = NULL, mood = NULL, weather = NULL, pros_cons = NULL,
          visibility = 'private', updated_at = ?
      WHERE id = ?
    `).run(ts(), entryId);
    broadcastJourneyEvent(entry.journey_id, 'journey:entry:updated', { entryId }, sid);
  } else {
    db.prepare('DELETE FROM journey_entries WHERE id = ?').run(entryId);
    broadcastJourneyEvent(entry.journey_id, 'journey:entry:deleted', { entryId }, sid);
  }

  return true;
}

// ── Photos ───────────────────────────────────────────────────────────────

// Promote a skeleton suggestion to a concrete entry. Called whenever the user
// adds content (photo upload, provider photo, gallery link) — a suggestion
// with photos is no longer just a suggestion.
function promoteSkeletonIfNeeded(entry: JourneyEntry): void {
  if (entry.type !== 'skeleton') return;
  db.prepare('UPDATE journey_entries SET type = ?, updated_at = ? WHERE id = ?').run('entry', ts(), entry.id);
}

// Ensure a trek_photo_id is in the journey gallery; return its gallery row id.
function ensureInGallery(journeyId: number, trekPhotoId: number, caption?: string, shared?: number): number {
  const now = ts();
  const maxOrderRow = db.prepare('SELECT MAX(sort_order) as m FROM journey_photos WHERE journey_id = ?').get(journeyId) as { m: number | null };
  db.prepare(`
    INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, caption, shared, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(journeyId, trekPhotoId, caption || null, shared ?? 0, (maxOrderRow?.m ?? -1) + 1, now);
  const row = db.prepare('SELECT id FROM journey_photos WHERE journey_id = ? AND photo_id = ?').get(journeyId, trekPhotoId) as { id: number };
  return row.id;
}

// Link a gallery photo to an entry (idempotent). Returns the junction JP_SELECT row.
function linkGalleryPhotoToEntry(galleryId: number, entryId: number): JourneyPhoto | null {
  const now = ts();
  const maxOrderRow = db.prepare('SELECT MAX(sort_order) as m FROM journey_entry_photos WHERE entry_id = ?').get(entryId) as { m: number | null };
  db.prepare(`
    INSERT OR IGNORE INTO journey_entry_photos (entry_id, journey_photo_id, sort_order, created_at)
    VALUES (?, ?, ?, ?)
  `).run(entryId, galleryId, (maxOrderRow?.m ?? -1) + 1, now);
  return db.prepare(`SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE jep.entry_id = ? AND jep.journey_photo_id = ?`)
    .get(entryId, galleryId) as JourneyPhoto | null;
}

export function addPhoto(entryId: number, userId: number, filePath: string, thumbnailPath?: string, caption?: string): JourneyPhoto | null {
  const entry = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry | undefined;
  if (!entry) return null;
  if (!canEdit(entry.journey_id, userId)) return null;

  const trekPhotoId = getOrCreateLocalTrekPhoto(filePath, thumbnailPath);
  const galleryId = db.transaction(() => ensureInGallery(entry.journey_id, trekPhotoId, caption))();
  const result = linkGalleryPhotoToEntry(galleryId, entryId);
  promoteSkeletonIfNeeded(entry);
  return result;
}

export function addProviderPhoto(entryId: number, userId: number, provider: string, assetId: string, caption?: string, passphrase?: string): JourneyPhoto | null {
  const entry = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry | undefined;
  if (!entry) return null;
  if (!canEdit(entry.journey_id, userId)) return null;

  const trekPhotoId = getOrCreateTrekPhoto(provider, assetId, userId, passphrase);

  // skip if this photo is already linked to this entry
  const alreadyLinked = db.prepare(`
    SELECT 1 FROM journey_entry_photos jep
    JOIN journey_photos gp ON gp.id = jep.journey_photo_id
    WHERE jep.entry_id = ? AND gp.photo_id = ?
  `).get(entryId, trekPhotoId);
  if (alreadyLinked) return null;

  const galleryId = db.transaction(() => ensureInGallery(entry.journey_id, trekPhotoId, caption))();
  const result = linkGalleryPhotoToEntry(galleryId, entryId);
  promoteSkeletonIfNeeded(entry);
  return result;
}

// Link a gallery photo (by its journey_photos.id) to an entry — idempotent.
export function linkPhotoToEntry(entryId: number, journeyPhotoId: number, userId: number): JourneyPhoto | null {
  const entry = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry | undefined;
  if (!entry) return null;
  if (!canEdit(entry.journey_id, userId)) return null;

  // Verify the gallery photo belongs to this journey
  const galleryRow = db.prepare('SELECT id, journey_id FROM journey_photos WHERE id = ?').get(journeyPhotoId) as { id: number; journey_id: number } | undefined;
  if (!galleryRow || galleryRow.journey_id !== entry.journey_id) return null;

  const result = linkGalleryPhotoToEntry(galleryRow.id, entryId);
  promoteSkeletonIfNeeded(entry);
  return result;
}

// Upload photos to the journey gallery only (no entry association).
export function uploadGalleryPhotos(journeyId: number, userId: number, filePaths: { path: string; thumbnail?: string }[]): JourneyPhoto[] {
  if (!canEdit(journeyId, userId)) return [];
  const results: any[] = [];
  const now = ts();
  const maxOrderRow = db.prepare('SELECT MAX(sort_order) as m FROM journey_photos WHERE journey_id = ?').get(journeyId) as { m: number | null };
  let nextOrder = (maxOrderRow?.m ?? -1) + 1;

  for (const f of filePaths) {
    const trekPhotoId = getOrCreateLocalTrekPhoto(f.path, f.thumbnail);
    db.prepare(`
      INSERT OR IGNORE INTO journey_photos (journey_id, photo_id, shared, sort_order, created_at)
      VALUES (?, ?, 0, ?, ?)
    `).run(journeyId, trekPhotoId, nextOrder++, now);
    const row = db.prepare(`SELECT ${GALLERY_SELECT} FROM ${GALLERY_JOIN} WHERE gp.journey_id = ? AND gp.photo_id = ?`).get(journeyId, trekPhotoId);
    if (row) results.push(row);
  }
  return results;
}

// Add a provider photo to the gallery only (no entry link).
export function addProviderPhotoToGallery(journeyId: number, userId: number, provider: string, assetId: string, caption?: string, passphrase?: string): any | null {
  if (!canEdit(journeyId, userId)) return null;
  const trekPhotoId = getOrCreateTrekPhoto(provider, assetId, userId, passphrase);
  const galleryId = db.transaction(() => ensureInGallery(journeyId, trekPhotoId, caption))();
  return db.prepare(`SELECT ${GALLERY_SELECT} FROM ${GALLERY_JOIN} WHERE gp.id = ?`).get(galleryId) ?? null;
}

// Unlink a photo from a specific entry; gallery row is preserved.
export function unlinkPhotoFromEntry(entryId: number, journeyPhotoId: number, userId: number): boolean {
  const entry = db.prepare('SELECT * FROM journey_entries WHERE id = ?').get(entryId) as JourneyEntry | undefined;
  if (!entry) return false;
  if (!canEdit(entry.journey_id, userId)) return false;

  const result = db.prepare('DELETE FROM journey_entry_photos WHERE entry_id = ? AND journey_photo_id = ?').run(entryId, journeyPhotoId);
  return result.changes > 0;
}

// Hard-delete a gallery photo (removes from all entries and the gallery).
export function deleteGalleryPhoto(journeyPhotoId: number, userId: number): { photo_id: number; file_path?: string | null } | null {
  const row = db.prepare('SELECT * FROM journey_photos WHERE id = ?').get(journeyPhotoId) as { id: number; journey_id: number; photo_id: number } | undefined;
  if (!row) return null;
  if (!canEdit(row.journey_id, userId)) return null;

  const trekRow = db.prepare('SELECT file_path, provider FROM trek_photos WHERE id = ?').get(row.photo_id) as { file_path?: string; provider?: string } | undefined;

  // cascade on journey_entry_photos.journey_photo_id handles junction cleanup
  db.prepare('DELETE FROM journey_photos WHERE id = ?').run(journeyPhotoId);
  deleteTrekPhotoIfOrphan(row.photo_id);

  return { photo_id: row.photo_id, file_path: trekRow?.file_path ?? null };
}

export function setPhotoProvider(photoId: number, provider: string, assetId: string, ownerId: number) {
  // photoId = journey_photos.id (gallery row); look up the trek_photo_id
  const jp = db.prepare('SELECT photo_id FROM journey_photos WHERE id = ?').get(photoId) as { photo_id: number } | undefined;
  if (!jp) return;
  setTrekPhotoProvider(jp.photo_id, provider, assetId, ownerId);
  // also denorm on gallery row for fast reads
  db.prepare('UPDATE journey_photos SET provider = ?, asset_id = ?, owner_id = ? WHERE id = ?').run(provider, assetId, ownerId, photoId);
}

export function updatePhoto(photoId: number, userId: number, data: { caption?: string; sort_order?: number }): JourneyPhoto | null {
  // photoId = journey_photos.id (gallery row)
  const row = db.prepare('SELECT id, journey_id FROM journey_photos WHERE id = ?').get(photoId) as { id: number; journey_id: number } | undefined;
  if (!row) return null;
  if (!canEdit(row.journey_id, userId)) return null;

  // caption lives on the gallery row; sort_order lives on the junction table
  // (JP_SELECT reads jep.sort_order, so updating journey_photos.sort_order
  // would not be reflected in the returned row).
  if (data.caption !== undefined) {
    db.prepare('UPDATE journey_photos SET caption = ? WHERE id = ?').run(data.caption, photoId);
  }
  if (data.sort_order !== undefined) {
    db.prepare('UPDATE journey_entry_photos SET sort_order = ? WHERE journey_photo_id = ?').run(data.sort_order, photoId);
  }
  return db.prepare(`SELECT ${JP_SELECT} FROM ${JP_JOIN} WHERE gp.id = ? LIMIT 1`).get(photoId) as JourneyPhoto | null;
}

// deletePhoto: hard-delete (backwards compat name used by old route).
export function deletePhoto(photoId: number, userId: number): { id: number; photo_id: number; file_path?: string | null; journey_id: number } | null {
  const row = db.prepare('SELECT id, journey_id, photo_id FROM journey_photos WHERE id = ?').get(photoId) as { id: number; journey_id: number; photo_id: number } | undefined;
  if (!row) return null;
  if (!canEdit(row.journey_id, userId)) return null;

  const trekRow = db.prepare('SELECT file_path, provider FROM trek_photos WHERE id = ?').get(row.photo_id) as { file_path?: string; provider?: string } | undefined;

  db.prepare('DELETE FROM journey_photos WHERE id = ?').run(photoId);
  deleteTrekPhotoIfOrphan(row.photo_id);

  return { id: row.id, photo_id: row.photo_id, file_path: trekRow?.file_path ?? null, journey_id: row.journey_id };
}

// ── Contributors ─────────────────────────────────────────────────────────

export function addContributor(journeyId: number, userId: number, targetUserId: number, role: 'editor' | 'viewer'): boolean {
  if (!isOwner(journeyId, userId)) return false;
  if (targetUserId === userId) return false;
  try {
    db.prepare(
      'INSERT OR REPLACE INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
    ).run(journeyId, targetUserId, role, ts());
    broadcastJourneyEvent(journeyId, 'journey:contributor:changed', { targetUserId, role });
    return true;
  } catch { return false; }
}

export function updateContributorRole(journeyId: number, userId: number, targetUserId: number, role: 'editor' | 'viewer'): boolean {
  if (!isOwner(journeyId, userId)) return false;
  db.prepare(
    'UPDATE journey_contributors SET role = ? WHERE journey_id = ? AND user_id = ?'
  ).run(role, journeyId, targetUserId);
  broadcastJourneyEvent(journeyId, 'journey:contributor:changed', { targetUserId, role });
  return true;
}

export function removeContributor(journeyId: number, userId: number, targetUserId: number): boolean {
  if (!isOwner(journeyId, userId)) return false;
  db.prepare(
    "DELETE FROM journey_contributors WHERE journey_id = ? AND user_id = ? AND role != 'owner'"
  ).run(journeyId, targetUserId);
  return true;
}

// ── Suggestions ──────────────────────────────────────────────────────────

export function getSuggestions(userId: number) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT t.id, t.title, t.start_date, t.end_date, t.cover_image,
      (SELECT COUNT(*) FROM places p INNER JOIN day_assignments da ON da.place_id = p.id WHERE p.trip_id = t.id) as place_count
    FROM trips t
    LEFT JOIN trip_members tm ON t.id = tm.trip_id AND tm.user_id = ?
    WHERE (t.user_id = ? OR tm.user_id = ?)
      AND t.end_date IS NOT NULL
      AND t.end_date >= ?
      AND t.end_date <= date('now')
      AND t.id NOT IN (SELECT trip_id FROM journey_trips)
    ORDER BY t.end_date DESC
  `).all(userId, userId, userId, thirtyDaysAgo);
}

// ── User trips (for trip picker) ─────────────────────────────────────────

export function listUserTrips(userId: number) {
  return db.prepare(`
    SELECT t.id, t.title, t.start_date, t.end_date, t.cover_image,
      (SELECT COUNT(*) FROM places p INNER JOIN day_assignments da ON da.place_id = p.id WHERE p.trip_id = t.id) as place_count
    FROM trips t
    LEFT JOIN trip_members tm ON t.id = tm.trip_id AND tm.user_id = ?
    WHERE t.user_id = ? OR tm.user_id = ?
    ORDER BY t.start_date DESC
  `).all(userId, userId, userId);
}

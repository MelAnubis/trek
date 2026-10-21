import { db } from '../db/database';

/**
 * A whole trip as one GPX 1.1 file: every place with coordinates as a
 * waypoint, each planned day as a route through its places in order, and
 * every recorded track as a track — what a Garmin, OsmAnd, Komoot or
 * Organic Maps import expects, in the schema's own element order
 * (metadata, wpt*, rte*, trk*).
 *
 * The per-track download (gpxTracks.ts) stays for "just this track"; this
 * is the trip, the way upstream liketrek/TREK exports it.
 */

interface PlaceRow {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
}

interface DayRow { id: number; day_number: number; date: string | null; title: string | null }
interface AssignmentRow { day_id: number; place_id: number }
interface TrackRow {
  track_name: string | null;
  transport_mode: string | null;
  points_json: string | null;
  waypoints_json: string | null;
  day_number: number | null;
}

export function escapeXml(s: string): string {
  // Control characters other than tab/newline are not allowed in XML 1.0 at all.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const validCoord = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Seven decimals: about a centimetre, and no float noise like 40.416775000000001. */
const coord = (n: number) => String(Math.round(n * 1e7) / 1e7);

function parseList<T>(json: string | null): T[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function dayName(d: DayRow): string {
  const label = d.title?.trim() || d.date || '';
  return label ? `${d.day_number}. ${label}` : `#${d.day_number}`;
}

/** Null when the trip does not exist. */
export function buildTripGpx(tripId: number | string): { title: string; xml: string } | null {
  const trip = db.prepare('SELECT title, description FROM trips WHERE id = ?').get(tripId) as { title: string; description: string | null } | undefined;
  if (!trip) return null;

  const places = db.prepare(`
    SELECT p.id, p.name, p.description, p.address, p.lat, p.lng, c.name AS category
    FROM places p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.trip_id = ?
    ORDER BY p.id ASC
  `).all(tripId) as PlaceRow[];
  const days = db.prepare('SELECT id, day_number, date, title FROM days WHERE trip_id = ? ORDER BY day_number ASC').all(tripId) as DayRow[];
  const assignments = db.prepare(`
    SELECT da.day_id, da.place_id FROM day_assignments da
    JOIN days d ON d.id = da.day_id
    WHERE d.trip_id = ?
    ORDER BY da.day_id ASC, da.order_index ASC, da.id ASC
  `).all(tripId) as AssignmentRow[];
  const tracks = db.prepare(`
    SELECT t.track_name, t.transport_mode, t.points_json, t.waypoints_json, d.day_number
    FROM gpx_tracks t LEFT JOIN days d ON d.id = t.day_id
    WHERE t.trip_id = ?
    ORDER BY t.sort_order ASC, t.id ASC
  `).all(tripId) as TrackRow[];

  const located = places.filter(p => validCoord(p.lat, p.lng));
  const byId = new Map(located.map(p => [p.id, p]));
  const firstDayOf = new Map<number, DayRow>();
  const dayById = new Map(days.map(d => [d.id, d]));
  for (const a of assignments) {
    const d = dayById.get(a.day_id);
    if (d && !firstDayOf.has(a.place_id)) firstDayOf.set(a.place_id, d);
  }

  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trek" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXml(trip.title || 'Trip')}</name>`,
    ...(trip.description?.trim() ? [`    <desc>${escapeXml(trip.description.trim())}</desc>`] : []),
    '  </metadata>',
  ];

  // ── waypoints: the places, then the named points the tracks carried ──
  for (const p of located) {
    const desc = [p.description?.trim(), p.address?.trim()].filter(Boolean).join('\n');
    const day = firstDayOf.get(p.id);
    out.push(`  <wpt lat="${coord(p.lat!)}" lon="${coord(p.lng!)}">`);
    out.push(`    <name>${escapeXml(p.name)}</name>`);
    if (desc) out.push(`    <desc>${escapeXml(desc)}</desc>`);
    if (day) out.push(`    <cmt>${escapeXml(dayName(day))}</cmt>`);
    if (p.category) out.push(`    <type>${escapeXml(p.category)}</type>`);
    out.push('  </wpt>');
  }
  for (const t of tracks) {
    for (const w of parseList<{ lat: number; lng: number; name?: string }>(t.waypoints_json)) {
      if (!validCoord(w.lat, w.lng)) continue;
      out.push(`  <wpt lat="${coord(w.lat)}" lon="${coord(w.lng)}"><name>${escapeXml(w.name || '')}</name></wpt>`);
    }
  }

  // ── routes: each day through its places, in the planner's order ──
  for (const d of days) {
    const stops = assignments.filter(a => a.day_id === d.id).map(a => byId.get(a.place_id)).filter((p): p is PlaceRow => !!p);
    if (stops.length < 2) continue;
    out.push('  <rte>');
    out.push(`    <name>${escapeXml(dayName(d))}</name>`);
    out.push(`    <number>${d.day_number}</number>`);
    for (const p of stops) out.push(`    <rtept lat="${coord(p.lat!)}" lon="${coord(p.lng!)}"><name>${escapeXml(p.name)}</name></rtept>`);
    out.push('  </rte>');
  }

  // ── tracks: what was actually recorded or imported ──
  for (const t of tracks) {
    const points = parseList<{ lat: number; lng: number; ele?: number | null; time?: string | null }>(t.points_json).filter(p => validCoord(p.lat, p.lng));
    if (!points.length) continue;
    out.push('  <trk>');
    out.push(`    <name>${escapeXml(t.track_name || 'Track')}</name>`);
    if (t.day_number != null) out.push(`    <number>${t.day_number}</number>`);
    if (t.transport_mode) out.push(`    <type>${escapeXml(t.transport_mode)}</type>`);
    out.push('    <trkseg>');
    for (const p of points) {
      const ele = typeof p.ele === 'number' && Number.isFinite(p.ele) ? `<ele>${Math.round(p.ele * 10) / 10}</ele>` : '';
      const time = p.time && !Number.isNaN(Date.parse(p.time)) ? `<time>${escapeXml(new Date(p.time).toISOString())}</time>` : '';
      out.push(`      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lng)}">${ele}${time}</trkpt>`);
    }
    out.push('    </trkseg>');
    out.push('  </trk>');
  }

  out.push('</gpx>');
  return { title: trip.title || 'Trip', xml: out.join('\n') };
}

/** A filename that survives every OS and an HTTP header: ASCII, no quotes. */
export function gpxFilename(title: string): string {
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return `${base || 'trip'}.gpx`;
}

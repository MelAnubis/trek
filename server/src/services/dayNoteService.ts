import { db, canAccessTrip } from '../db/database';
import { DayNote } from '../types';

/** The note colours on offer (upstream's palette). Anything else is refused; null is "no colour". */
export const NOTE_COLORS = ['#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#9333ea'] as const;

/** undefined: not given. null: clear it. A string: must be one of NOTE_COLORS (case-insensitive). */
export function parseNoteColor(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return (NOTE_COLORS as readonly string[]).includes(v) ? v : false;
}

export function verifyTripAccess(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

export function listNotes(dayId: string | number, tripId: string | number) {
  return db.prepare(
    'SELECT * FROM day_notes WHERE day_id = ? AND trip_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(dayId, tripId);
}

export function dayExists(dayId: string | number, tripId: string | number) {
  return db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
}

export function createNote(dayId: string | number, tripId: string | number, text: string, time?: string, icon?: string, sort_order?: number, color?: string | null) {
  const result = db.prepare(
    'INSERT INTO day_notes (day_id, trip_id, text, time, icon, sort_order, color) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(dayId, tripId, text.trim(), time || null, icon || '\uD83D\uDCDD', sort_order ?? 9999, color ?? null);
  return db.prepare('SELECT * FROM day_notes WHERE id = ?').get(result.lastInsertRowid);
}

export function getNote(id: string | number, dayId: string | number, tripId: string | number) {
  return db.prepare('SELECT * FROM day_notes WHERE id = ? AND day_id = ? AND trip_id = ?').get(id, dayId, tripId) as DayNote | undefined;
}

export function updateNote(id: string | number, current: DayNote, fields: { text?: string; time?: string; icon?: string; sort_order?: number; color?: string | null }) {
  db.prepare(
    'UPDATE day_notes SET text = ?, time = ?, icon = ?, sort_order = ?, color = ? WHERE id = ?'
  ).run(
    fields.text !== undefined ? fields.text.trim() : current.text,
    fields.time !== undefined ? fields.time : current.time,
    fields.icon !== undefined ? fields.icon : current.icon,
    fields.sort_order !== undefined ? fields.sort_order : current.sort_order,
    fields.color !== undefined ? fields.color : current.color ?? null,
    id
  );
  return db.prepare('SELECT * FROM day_notes WHERE id = ?').get(id);
}

export function deleteNote(id: string | number) {
  db.prepare('DELETE FROM day_notes WHERE id = ?').run(id);
}

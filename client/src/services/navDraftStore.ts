/**
 * Keeps the recording in progress on the phone while it is being made, so a
 * recording survives Android closing the app, the phone switching off or the
 * WebView reloading. Without it the points only lived in memory until
 * "Detener", and losing the app meant losing the whole ride.
 *
 * One draft at a time, in its own small IndexedDB database (not offlineDb:
 * adding a table there means a schema bump of the trip cache).
 */
import Dexie, { type Table } from 'dexie'
import type { RecordedPoint } from './gpxRecorderService'

export interface NavDraft {
  key: 'current'
  /** When the recording started (ms). */
  startedAt: number
  /** Last time the draft was written (ms). */
  updatedAt: number
  points: RecordedPoint[]
  /** Time spent paused so far (ms), so moving time stays right after a recovery. */
  pausedMs: number
  elevationGainM: number
  elevationLossM: number
  /** The page the recording was made on, to come back to it (route, tour). */
  path: string
  trackName: string
  tripId: number | null
  /** True when it was recorded while following a route. */
  following: boolean
}

class NavDraftDb extends Dexie {
  drafts!: Table<NavDraft, string>
  constructor() {
    super('trek-nav-draft')
    this.version(1).stores({ drafts: 'key' })
  }
}

let db: NavDraftDb | null = null
function getDb(): NavDraftDb | null {
  if (db) return db
  try { db = new NavDraftDb(); return db } catch { return null }
}

export async function saveNavDraft(draft: Omit<NavDraft, 'key' | 'updatedAt'>): Promise<void> {
  try { await getDb()?.drafts.put({ ...draft, key: 'current', updatedAt: Date.now() }) } catch { /* storage full or blocked */ }
}

/** The unfinished recording, if any worth keeping (at least two points). */
export async function loadNavDraft(): Promise<NavDraft | null> {
  try {
    const d = await getDb()?.drafts.get('current')
    return d && d.points.length > 1 ? d : null
  } catch {
    return null
  }
}

export async function clearNavDraft(): Promise<void> {
  try { await getDb()?.drafts.delete('current') } catch { /* noop */ }
}

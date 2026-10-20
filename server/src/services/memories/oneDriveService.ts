/**
 * oneDriveService.ts
 * OneDrive/Microsoft Photos integration for Trek Memories
 * Uses Microsoft Graph API with OAuth 2.0
 */
import { Response } from 'express';
import { db } from '../../db/database';
import { encrypt_api_key, decrypt_api_key } from '../apiKeyCrypto';
import { addTripPhotos } from './unifiedService';
import { Selection, pipeAsset } from './helpersService';


const ONEDRIVE_PROVIDER = 'onedrive';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';

// ── Config from env ──────────────────────────────────────────────────────────
export function getOAuthConfig() {
  return {
    clientId:     process.env.ONEDRIVE_CLIENT_ID     || '',
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET || '',
    // Must match where the callback route is actually mounted
    // (app.ts: app.use('/api/integrations/memories', memoriesRoutes)).
    redirectUri:  process.env.ONEDRIVE_REDIRECT_URI  || `${process.env.APP_URL || ''}/api/integrations/memories/onedrive/callback`,
  };
}

// ── OAuth URL ────────────────────────────────────────────────────────────────
export function getAuthUrl(userId: number): string {
  const { clientId, redirectUri } = getOAuthConfig();
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64url');
  const scopes = 'offline_access Files.Read Files.Read.All User.Read';
  return `${AUTH_BASE}/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&prompt=consent`;
}

// ── Token exchange ───────────────────────────────────────────────────────────
export async function exchangeCode(code: string, userId: number): Promise<{ success: boolean; error?: string }> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  try {
    const r = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    const data = await r.json() as any;
    if (!data.access_token) return { success: false, error: data.error_description || 'Token exchange failed' };

    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
    db.prepare(`
      UPDATE users SET
        onedrive_access_token  = ?,
        onedrive_refresh_token = ?,
        onedrive_token_expiry  = ?
      WHERE id = ?
    `).run(
      encrypt_api_key(data.access_token),
      encrypt_api_key(data.refresh_token),
      expiresAt,
      userId,
    );
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ── Token refresh ────────────────────────────────────────────────────────────
async function refreshToken(userId: number): Promise<string | null> {
  const user = db.prepare('SELECT onedrive_refresh_token FROM users WHERE id = ?').get(userId) as any;
  if (!user?.onedrive_refresh_token) return null;
  const refreshTk = decrypt_api_key(user.onedrive_refresh_token);
  if (!refreshTk) return null;

  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  try {
    const r = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshTk,
        redirect_uri:  redirectUri,
        grant_type:    'refresh_token',
      }),
    });
    const data = await r.json() as any;
    if (!data.access_token) return null;

    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
    db.prepare(`
      UPDATE users SET
        onedrive_access_token = ?,
        onedrive_token_expiry = ?
        ${data.refresh_token ? ', onedrive_refresh_token = ?' : ''}
      WHERE id = ?
    `).run(
      encrypt_api_key(data.access_token),
      expiresAt,
      ...(data.refresh_token ? [encrypt_api_key(data.refresh_token)] : []),
      userId,
    );
    return data.access_token;
  } catch {
    return null;
  }
}

// ── Get valid access token ───────────────────────────────────────────────────
async function getAccessToken(userId: number): Promise<string | null> {
  const user = db.prepare('SELECT onedrive_access_token, onedrive_token_expiry FROM users WHERE id = ?').get(userId) as any;
  if (!user?.onedrive_access_token) return null;

  const expiry = user.onedrive_token_expiry || 0;
  if (Math.floor(Date.now() / 1000) < expiry - 60) {
    return decrypt_api_key(user.onedrive_access_token);
  }
  // One refresh at a time per user. The picker fires dozens of thumbnail
  // requests at once; each used to refresh on its own, and since Microsoft
  // rotates the refresh token on every use, all but the first raced against
  // a token that had just been replaced — and those thumbnails came back
  // broken.
  const running = refreshInFlight.get(userId);
  if (running) return running;
  const job = refreshToken(userId).finally(() => refreshInFlight.delete(userId));
  refreshInFlight.set(userId, job);
  return job;
}
const refreshInFlight = new Map<number, Promise<string | null>>();

// ── Graph API helper ─────────────────────────────────────────────────────────
const GRAPH_TIMEOUT_MS = 20_000;

async function graphGet(userId: number, path: string, attempt = 0): Promise<{ data?: any; error?: string; status?: number }> {
  const token = await getAccessToken(userId);
  if (!token) return { error: 'Not connected to OneDrive', status: 401 };
  let r: Awaited<ReturnType<typeof fetch>>;
  try {
    // A Graph call that never answers used to hang the picker forever (no
    // timeout at all); now it fails like any other error.
    r = await fetch(`${GRAPH_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) as any,
    });
  } catch (e: any) {
    return { error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'OneDrive did not answer in time' : (e?.message || 'Network error'), status: 504 };
  }
  // Throttled: Graph says how long to wait. Honour it once (capped), then give up.
  if ((r.status === 429 || r.status === 503) && attempt === 0) {
    const wait = Math.min(5, Number(r.headers?.get?.('Retry-After')) || 2);
    await new Promise(res => setTimeout(res, wait * 1000));
    return graphGet(userId, path, 1);
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as any;
    return { error: e?.error?.message || r.statusText, status: r.status };
  }
  return { data: await r.json() };
}

// Follows @odata.nextLink until exhausted, concatenating `value` across pages.
// Several Graph endpoints here (album/folder children, bundles) silently cap
// at one page (usually 200 items) without this — large albums/folders were
// getting truncated.
async function graphGetAllPages(userId: number, initialPath: string): Promise<{ items: any[]; error?: string }> {
  const items: any[] = [];
  let url: string | null = initialPath;
  while (url) {
    const result: { data?: any; error?: string; status?: number } = await graphGet(userId, url);
    if (result.error) return { items, error: result.error };
    items.push(...(result.data?.value || []));
    const next = result.data?.['@odata.nextLink'];
    if (!next) { url = null; break; }
    try { const u = new URL(next); url = u.pathname.replace('/v1.0', '') + u.search; }
    catch { url = null; }
  }
  return { items };
}

// The best available "when was this actually taken" signal for a driveItem.
// `photo.takenDateTime` (EXIF) is the most trustworthy but is often missing
// for screenshots, downloads, or images without EXIF. `fileSystemInfo` mirrors
// the original file's created/modified dates as preserved by the sync client,
// which still tracks the real capture date in that case. The top-level
// `createdDateTime` is when the item was created *in OneDrive* (i.e. upload
// time) — using it as the primary fallback is what let trip date-range
// filtering pull in unrelated photos that merely happened to be uploaded
// during the trip's date window, so it's now the last resort only.
function resolveTakenDate(item: any): string {
  return item.photo?.takenDateTime
    || item.fileSystemInfo?.createdDateTime
    || item.fileSystemInfo?.lastModifiedDateTime
    || item.createdDateTime;
}

// Turns a trip's from/to into UTC day-boundary instants for comparison
// against Graph's ISO 8601 date-time strings. Plain "YYYY-MM-DD" dates (what
// trips store) are anchored to the *start* of `from` and the *end* of `to`
// so the whole last day of the trip is included — mirrors the convention
// already used for Immich search (see immichService.searchAssets).
function dayStart(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : new Date(date).toISOString();
}
function dayEnd(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.999Z` : new Date(date).toISOString();
}

// ── Photo index (one pass over the drive, cached) ──────────────────────────
//
// Both the date search and the album list used to walk the drive folder by
// folder — up to 500 (search) and 600 (albums) sequential Graph calls, each
// waiting on the last, and the search redid the whole walk for every "load
// more" page. On a real photo library that is minutes, which in the picker
// looked like a spinner that never ends.
//
// Instead: one `delta` query per scope, which Graph answers with every item
// under it in a handful of large pages (no recursion), kept for a few
// minutes per user. Two scopes, matching what each feature always covered:
// 'photos' (the Photos special folder) for the date search, 'drive' (the
// whole drive) for the album list. Photos carry their capture date and parent folder, so the
// same index answers "photos between these dates" and "folders that hold
// photos" (the album fallback). If delta isn't available, the old breadth-
// first walk runs instead — now in parallel and against a time budget.

export interface IndexedPhoto { id: string; name: string; taken: string | null; parentId: string | null }
interface PhotoIndex {
  photos: IndexedPhoto[]
  folders: Map<string, { name: string; parentId: string | null }>
  builtAt: number
  /** Stopped early (time budget or errors) — results may be incomplete. */
  partial: boolean
  source: 'delta' | 'walk'
}

const INDEX_TTL_MS = 10 * 60_000;
const PARTIAL_INDEX_TTL_MS = 60_000;
const INDEX_BUDGET_MS = 60_000;
const WALK_CONCURRENCY = 6;
const INDEX_SELECT = 'id,name,folder,file,photo,image,fileSystemInfo,createdDateTime,parentReference,deleted';

export type IndexScope = 'photos' | 'drive';
const SCOPE_ROOT: Record<IndexScope, string> = { photos: '/me/drive/special/photos', drive: '/me/drive/root' };
const indexCache = new Map<string, PhotoIndex>();
const indexInFlight = new Map<string, Promise<PhotoIndex>>();

/** Tests only: forget cached indexes (user ids repeat across a reset test DB). */
export function __resetOneDriveIndexCache(): void { indexCache.clear(); indexInFlight.clear(); }

function isImageItem(item: any): boolean {
  return !!(item.photo || item.image || item.file?.mimeType?.startsWith('image/'));
}

/** A capture date we trust for date filtering — never the upload time alone. */
function trustedTakenDate(item: any): string | null {
  if (!item.photo?.takenDateTime && !item.fileSystemInfo?.createdDateTime && !item.fileSystemInfo?.lastModifiedDateTime) return null;
  return resolveTakenDate(item);
}

function addToIndex(idx: Pick<PhotoIndex, 'photos' | 'folders'>, item: any, seen: Set<string>): void {
  if (!item?.id || item.deleted || seen.has(item.id)) return;
  seen.add(item.id);
  const parentId = item.parentReference?.id ?? null;
  if (item.folder) { idx.folders.set(item.id, { name: item.name || '', parentId }); return; }
  if (isImageItem(item)) idx.photos.push({ id: item.id, name: item.name || '', taken: trustedTakenDate(item), parentId });
}

function nextLinkPath(next: string | undefined): string | null {
  if (!next) return null;
  try { const u = new URL(next); return u.pathname.replace('/v1.0', '') + u.search; } catch { return null; }
}

async function buildIndexViaDelta(userId: number, scope: IndexScope, deadline: number): Promise<PhotoIndex | null> {
  const idx: PhotoIndex = { photos: [], folders: new Map(), builtAt: Date.now(), partial: false, source: 'delta' };
  const seen = new Set<string>();
  let url: string | null = `${SCOPE_ROOT[scope]}/delta?$select=${INDEX_SELECT}`;
  let pages = 0;
  while (url) {
    if (Date.now() > deadline) { idx.partial = true; break; }
    const result = await graphGet(userId, url);
    if (result.error) {
      if (pages === 0) { console.warn('[oneDrive] delta unavailable, falling back to folder walk:', result.status, result.error); return null; }
      console.error('[oneDrive] delta page failed, index is partial:', result.status, result.error);
      idx.partial = true;
      break;
    }
    pages++;
    for (const item of result.data?.value || []) addToIndex(idx, item, seen);
    url = nextLinkPath(result.data?.['@odata.nextLink']);
  }
  console.log(`[oneDrive] ${scope} index via delta: ${idx.photos.length} photo(s), ${idx.folders.size} folder(s), ${pages} page(s)${idx.partial ? ' (partial)' : ''}`);
  return idx;
}

async function buildIndexViaWalk(userId: number, scope: IndexScope, deadline: number): Promise<PhotoIndex> {
  const idx: PhotoIndex = { photos: [], folders: new Map(), builtAt: Date.now(), partial: false, source: 'walk' };
  const seen = new Set<string>();
  const query = `$select=${INDEX_SELECT}&$top=200`;
  const queue: string[] = [`${SCOPE_ROOT[scope]}/children?${query}`];
  const MAX_FOLDERS = 1500;
  let visited = 0;
  let busy = 0;
  // A small pool over one shared queue. A worker that finds the queue empty
  // waits while others are still reading folders (they may add subfolders),
  // and stops once nobody is.
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline || visited >= MAX_FOLDERS) { if (queue.length) idx.partial = true; return; }
      const first = queue.shift();
      if (!first) {
        if (busy === 0) return;
        await new Promise(r => setTimeout(r, 25));
        continue;
      }
      busy++;
      visited++;
      try {
        let url: string | null = first;
        while (url) {
          const result = await graphGet(userId, url);
          if (result.error) { idx.partial = true; console.error('[oneDrive] walk folder failed:', url, result.status, result.error); break; }
          for (const item of result.data?.value || []) {
            addToIndex(idx, item, seen);
            if (item.folder) queue.push(`/me/drive/items/${item.id}/children?${query}`);
          }
          url = nextLinkPath(result.data?.['@odata.nextLink']);
        }
      } finally {
        busy--;
      }
    }
  };
  await Promise.all(Array.from({ length: WALK_CONCURRENCY }, worker));
  console.log(`[oneDrive] ${scope} index via folder walk: ${idx.photos.length} photo(s), ${idx.folders.size} folder(s), ${visited} folder(s) visited${idx.partial ? ' (partial)' : ''}`);
  return idx;
}

export async function getPhotoIndex(userId: number, scope: IndexScope = 'photos'): Promise<PhotoIndex> {
  const key = `${userId}:${scope}`;
  const cached = indexCache.get(key);
  if (cached && Date.now() - cached.builtAt < (cached.partial ? PARTIAL_INDEX_TTL_MS : INDEX_TTL_MS)) return cached;
  const running = indexInFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const deadline = Date.now() + INDEX_BUDGET_MS;
    const idx = (await buildIndexViaDelta(userId, scope, deadline)) ?? (await buildIndexViaWalk(userId, scope, deadline));
    indexCache.set(key, idx);
    return idx;
  })().finally(() => indexInFlight.delete(key));
  indexInFlight.set(key, job);
  return job;
}

// ── Connection status ────────────────────────────────────────────────────────
export function getConnectionSettings(userId: number) {
  const user = db.prepare('SELECT onedrive_access_token FROM users WHERE id = ?').get(userId) as any;
  return {
    connected: !!(user?.onedrive_access_token),
    authUrl: getAuthUrl(userId),
  };
}

export async function getConnectionStatus(userId: number) {
  const token = await getAccessToken(userId);
  if (!token) return { connected: false };
  const result = await graphGet(userId, '/me');
  if (result.error) return { connected: false };
  return {
    connected: true,
    user: {
      name:  result.data?.displayName,
      email: result.data?.mail || result.data?.userPrincipalName,
    },
  };
}

export function disconnect(userId: number): void {
  db.prepare(`
    UPDATE users SET
      onedrive_access_token  = NULL,
      onedrive_refresh_token = NULL,
      onedrive_token_expiry  = NULL
    WHERE id = ?
  `).run(userId);
}

// A bare year ("2026") or 1-2 digit month ("09", "9") is almost certainly an
// auto-organized Camera Roll date folder, not something the user named
// themselves — filtered out so listAlbums() approximates "user-created"
// without depending on the bundles/Album API (see comment below).
function looksAutoGenerated(name: string): boolean {
  return /^\d{4}$/.test(name) || /^\d{1,2}$/.test(name);
}

// ── List albums (best-effort: real Albums, falling back to named folders) ────
export async function listAlbums(userId: number) {
  const seen = new Set<string>();
  const albums: { id: string; name: string; count: number }[] = [];

  // Real OneDrive Albums (created via "New album") are exposed by Graph as
  // "bundles" with an `album` facet — in principle the precise match for
  // "only what the user created". In practice this has come back empty for
  // at least one personal Microsoft account even right after creating an
  // album, which suggests Graph's bundles/Album API is unreliable (possibly
  // deprecated) for that account type. Kept as a best-effort first source —
  // it's a no-op, not a regression, when it returns nothing.
  const bundlesResult = await graphGetAllPages(
    userId,
    "/me/drive/bundles?$filter=bundle/album ne null&$select=id,name,bundle&$top=200",
  );
  if (bundlesResult.error) {
    console.error('[oneDrive] listAlbums bundles fetch failed:', bundlesResult.error);
  }
  for (const b of bundlesResult.items) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    albums.push({ id: b.id, name: b.name, count: b.bundle?.album?.count ?? b.bundle?.childCount ?? 0 });
  }
  const bundleAlbumCount = albums.length;

  // Fallback / complement: every folder that directly holds photos, from the
  // drive-wide index (Photos library and anything outside it alike) — see
  // getPhotoIndex. Same rules as before: named folders only, not Camera
  // Roll's bare year/month folders, each listed once.
  const idx = await getPhotoIndex(userId, 'drive');
  const perFolder = new Map<string, number>();
  for (const p of idx.photos) if (p.parentId) perFolder.set(p.parentId, (perFolder.get(p.parentId) || 0) + 1);
  for (const [folderId, count] of perFolder) {
    const folder = idx.folders.get(folderId);
    if (!folder || !folder.name || looksAutoGenerated(folder.name) || seen.has(folderId)) continue;
    // A drive root ("root") has no name worth showing; anything with a
    // parent is a real folder.
    if (!folder.parentId) continue;
    seen.add(folderId);
    albums.push({ id: folderId, name: folder.name, count });
  }

  console.log(`[oneDrive] listAlbums: ${bundleAlbumCount} real album(s) + ${albums.length - bundleAlbumCount} named folder(s) with photos (index: ${idx.source}${idx.partial ? ', partial' : ''})`);
  return { albums, partial: idx.partial };
}

// ── Single-item capture date lookup ─────────────────────────────────────────
// Used when linking a photo into a journey and by the trek_photos.taken_at
// backfill — the picker endpoints above already resolve this per item, but
// neither the client's add-photo call nor an already-linked row carries it.
export async function getAssetTakenAt(userId: number, assetId: string): Promise<string | null> {
  const result = await graphGet(userId, `/me/drive/items/${assetId}?$select=photo,fileSystemInfo,createdDateTime`);
  if (result.error || !result.data) return null;
  const taken = resolveTakenDate(result.data);
  return taken || null;
}

// ── Get photos in a folder/album ─────────────────────────────────────────────
export async function getAlbumPhotos(userId: number, albumId: string) {
  // Paginated — a single 200-item page used to silently drop the rest of
  // any bigger album/folder.
  const result = await graphGetAllPages(
    userId,
    `/me/drive/items/${albumId}/children?$select=id,name,photo,image,thumbnails,createdDateTime,fileSystemInfo&$top=200&$expand=thumbnails`,
  );
  if (result.error) return { error: result.error, status: 500 };

  const photos = result.items.filter((i: any) => i.photo || i.image);
  return {
    assets: photos.map((p: any) => ({
      id:          p.id,
      name:        p.name,
      takenAt:     resolveTakenDate(p),
      thumbnail:   p.thumbnails?.[0]?.large?.url || p.thumbnails?.[0]?.medium?.url || p.thumbnails?.[0]?.small?.url,
      width:       p.image?.width,
      height:      p.image?.height,
    })),
  };
}

// ── Browse timeline (recent photos) ─────────────────────────────────────────
export async function browseTimeline(userId: number) {
  const result = await graphGet(userId, '/me/drive/special/photos/children?$select=id,name,photo,image,thumbnails,createdDateTime,fileSystemInfo&$top=100&$expand=thumbnails&$orderby=lastModifiedDateTime+desc');
  if (result.error) return { error: result.error, status: result.status };

  const photos = (result.data?.value || []).filter((i: any) => i.photo || i.image);
  return {
    assets: photos.map((p: any) => ({
      id:        p.id,
      name:      p.name,
      takenAt:   resolveTakenDate(p),
      thumbnail: p.thumbnails?.[0]?.large?.url || p.thumbnails?.[0]?.medium?.url || p.thumbnails?.[0]?.small?.url,
    })),
  };
}

// ── Search photos by date range ──────────────────────────────────────────────
export async function searchPhotos(userId: number, from?: string, to?: string, page = 1, size = 50) {
  // Anchored to UTC day boundaries (start of `from`, end of `to`) rather than
  // `new Date(x).toISOString()`, which turned a plain "YYYY-MM-DD" `to` into
  // *midnight* of that day — silently cutting the entire last day of the
  // trip out of the results.
  const from_ = from ? dayStart(from) : undefined;
  const to_   = to   ? dayEnd(to)     : undefined;

  // One cached drive-wide index instead of a fresh folder walk per request
  // (and per page) — see getPhotoIndex. Same scope the search always had.
  const idx = await getPhotoIndex(userId, 'photos');

  const collected = idx.photos.filter(p => {
    // Only an actual EXIF/filesystem capture date counts for a date range —
    // the OneDrive upload time alone let unrelated photos match a trip just
    // because they were uploaded during it.
    if (from_ || to_) {
      if (!p.taken) return false;
      if (from_ && p.taken < from_) return false;
      if (to_ && p.taken > to_) return false;
    }
    return true;
  });
  collected.sort((a, b) => (b.taken || '').localeCompare(a.taken || ''));

  if (page === 1) {
    console.log(`[oneDrive] searchPhotos: ${collected.length} photo(s) in range of ${idx.photos.length} indexed (${idx.source}${idx.partial ? ', partial' : ''})`, { from, to });
  }

  const start = (page - 1) * size;
  return {
    assets: collected.slice(start, start + size).map(p => ({
      id:      p.id,
      name:    p.name,
      takenAt: p.taken,
    })),
    hasMore: collected.length > start + size,
    partial: idx.partial,
  };
}

// ── Stream/proxy a OneDrive photo ────────────────────────────────────────────
// Thumbnails: each costs two Graph round trips (look up the pre-signed URL,
// then fetch it), and the picker asks for ~50 at once. Unbounded, that is
// exactly what gets an account throttled (429) — and every throttled one was
// a broken image with nothing in the log. So: at most a few lookups at a
// time per process, a short in-memory cache of the bytes (scrolling back up,
// switching tabs, the gallery after adding), and a log line on failure.
const THUMB_CONCURRENCY = 4;
const THUMB_CACHE_MAX = 400;
const THUMB_CACHE_TTL_MS = 60 * 60_000;
const thumbCache = new Map<string, { buf: Buffer; type: string; at: number }>();
let thumbSlots = THUMB_CONCURRENCY;
const thumbWaiters: Array<() => void> = [];

async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbSlots > 0) thumbSlots--;
  else await new Promise<void>(resolve => thumbWaiters.push(resolve));
  try { return await fn(); }
  finally {
    const next = thumbWaiters.shift();
    if (next) next(); else thumbSlots++;
  }
}

/** Tests only. */
export function __resetOneDriveThumbCache(): void { thumbCache.clear(); }

async function fetchThumbnailBytes(userId: number, assetId: string, size: 'thumbnail' | 'original'): Promise<{ buf: Buffer; type: string } | { status: number; error: string }> {
  // 'original' has always been the large thumbnail too (already JPEG — no
  // HEIC for the browser to choke on); both go through the same lookup.
  const meta = await graphGet(userId, `/me/drive/items/${encodeURIComponent(assetId)}/thumbnails`);
  if (meta.error) return { status: meta.status || 502, error: meta.error };
  const set = meta.data?.value?.[0];
  const url: string | undefined = set?.large?.url || set?.medium?.url || set?.small?.url;
  if (!url) return { status: 404, error: 'no thumbnail for this item' };
  // Pre-signed URL: no auth header, but still bounded in time.
  const r = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) as any });
  if (!r.ok) return { status: r.status, error: `thumbnail download ${r.status}` };
  return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
}

export async function streamOneDriveAsset(
  res: Response,
  userId: number,
  assetId: string,
  size: 'thumbnail' | 'original' = 'thumbnail',
): Promise<void> {
  const token = await getAccessToken(userId);
  if (!token) { res.status(401).json({ error: 'Not connected' }); return; }

  const key = `${userId}:${assetId}:${size}`;
  const hit = thumbCache.get(key);
  if (hit && Date.now() - hit.at < THUMB_CACHE_TTL_MS) {
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(hit.buf);
    return;
  }

  try {
    const got = await withThumbSlot(() => fetchThumbnailBytes(userId, assetId, size));
    if ('error' in got) {
      console.warn(`[oneDrive] ${size} failed for ${assetId}: ${got.status} ${got.error}`);
      res.status(got.status === 429 ? 503 : got.status).json({ error: got.error });
      return;
    }
    thumbCache.set(key, { ...got, at: Date.now() });
    if (thumbCache.size > THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value as string);
    res.setHeader('Content-Type', got.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(got.buf);
  } catch (e: any) {
    console.warn(`[oneDrive] ${size} failed for ${assetId}:`, e?.message || e);
    if (!res.headersSent) res.status(502).json({ error: e?.message || 'thumbnail failed' });
  }
}

// ── Sync album photos to a trip ──────────────────────────────────────────────
export async function syncAlbumAssets(
  userId: number,
  tripId: string,
  albumId: string,
  shared: boolean,
  socketId: string | undefined,
): Promise<{ success: boolean; added?: number; error?: string }> {
  const result = await getAlbumPhotos(userId, albumId);
  if ('error' in result && result.error) return { success: false, error: result.error };

  const assets = (result as any).assets || [];
  if (!assets.length) return { success: true, added: 0 };

  // A single Selection groups all asset_ids under one provider — the shape
  // addTripPhotos() actually iterates (`selection.asset_ids`). Building one
  // Selection per photo with an `assetId` field (mismatched key, and the
  // wrong shape entirely) meant every sync silently added nothing: the
  // `for (const raw of selection.asset_ids)` loop in addTripPhotos() saw
  // `asset_ids` as undefined and skipped straight past it.
  const selection: Selection = {
    provider: ONEDRIVE_PROVIDER,
    asset_ids: assets.map((a: any) => a.id),
  };

  const addResult = await addTripPhotos(tripId, userId, shared, [selection], socketId);
  if ('error' in addResult) return { success: false, error: addResult.error.message };
  return { success: true, added: addResult.data.added };
}

export function isValidAssetId(id: string): boolean {
  return /^[a-zA-Z0-9_!%-]+$/.test(id) && id.length <= 200;
}

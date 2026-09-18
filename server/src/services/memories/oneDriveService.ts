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
  return refreshToken(userId);
}

// ── Graph API helper ─────────────────────────────────────────────────────────
async function graphGet(userId: number, path: string): Promise<{ data?: any; error?: string; status?: number }> {
  const token = await getAccessToken(userId);
  if (!token) return { error: 'Not connected to OneDrive', status: 401 };
  const r = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
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

// Walks a folder tree breadth-first, fully paginating each folder's children
// (a single 200-item page used to silently truncate large folders — both the
// subfolder discovery and the photo count were wrong for anything bigger).
// Only folders that actually contain at least one photo/image are surfaced
// as albums — previously *any* named folder qualified, which polluted the
// album picker with non-photo folders (Documents, work files, etc.) that
// happened to live under the walked root.
async function walkFoldersForAlbums(
  userId: number,
  rootPath: string,
  seen: Set<string>,
  albums: { id: string; name: string; count: number }[],
  maxFolders: number,
): Promise<number> {
  const childrenQuery = '$select=id,name,folder,photo,image&$top=200';
  const queue: { id: string | null; name: string; path: string }[] = [
    { id: null, name: '', path: rootPath },
  ];
  let foldersVisited = 0;

  while (queue.length > 0 && foldersVisited < maxFolders) {
    const node = queue.shift()!;
    foldersVisited++;
    const result = await graphGetAllPages(userId, `${node.path}?${childrenQuery}`);
    if (result.error) {
      console.error('[oneDrive] listAlbums folder fetch failed:', node.path, result.error);
      continue;
    }

    let photoCount = 0;
    for (const item of result.items) {
      if (item.folder) {
        queue.push({ id: item.id, name: item.name, path: `/me/drive/items/${item.id}/children` });
        continue;
      }
      if (item.photo || item.image) photoCount++;
    }

    if (node.id && photoCount > 0 && !looksAutoGenerated(node.name) && !seen.has(node.id)) {
      seen.add(node.id);
      albums.push({ id: node.id, name: node.name, count: photoCount });
    }
  }

  return foldersVisited;
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

  // Fallback / complement: walk the Photos folder tree and, additionally,
  // the whole drive root — a personal OneDrive doesn't guarantee every
  // manually-named photo folder lives under the "Photos" special folder
  // (e.g. folders created from the OneDrive web UI or synced from a PC
  // outside the Pictures library land under the drive root instead). Both
  // walks share `seen` so a folder reachable from either root is only
  // listed once, and each gets its own folder budget so a large non-photo
  // drive tree can't starve out the Photos walk.
  const MAX_FOLDERS_PER_SOURCE = 300;
  const photosVisited = await walkFoldersForAlbums(userId, '/me/drive/special/photos/children', seen, albums, MAX_FOLDERS_PER_SOURCE);
  const rootVisited = await walkFoldersForAlbums(userId, '/me/drive/root/children', seen, albums, MAX_FOLDERS_PER_SOURCE);

  console.log(`[oneDrive] listAlbums: ${bundleAlbumCount} real album(s) + ${albums.length - bundleAlbumCount} named folder(s) with photos, ${photosVisited + rootVisited} folder(s) visited`);
  return { albums };
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
  const collected: any[] = [];

  // Walk the special "photos" folder — the same root browseTimeline()/listAlbums()
  // already use successfully — recursively, instead of assuming a fixed
  // "Fotos/<year>/<month>" layout. Most accounts don't have that exact folder
  // structure (different name, no year/month subfolders, deeper nesting, etc.),
  // which made date-range search come back empty even when photos existed.
  // Date filtering still happens per-item below, same as before.
  const MAX_FOLDERS = 500;
  const childrenQuery = '$select=id,name,folder,photo,image,file,thumbnails,createdDateTime,fileSystemInfo&$top=200&$expand=thumbnails';
  const queue: string[] = [`/me/drive/special/photos/children?${childrenQuery}`];
  let foldersVisited = 0;

  while (queue.length > 0 && foldersVisited < MAX_FOLDERS) {
    let url: string | null = queue.shift()!;
    foldersVisited++;
    while (url) {
      const result = await graphGet(userId, url);
      if (result.error) {
        console.error('[oneDrive] searchPhotos folder fetch failed:', url, result.status, result.error);
        break;
      }
      const items = result.data?.value || [];
      for (const item of items) {
        if (item.folder) {
          queue.push(`/me/drive/items/${item.id}/children?${childrenQuery}`);
          continue;
        }
        if (!(item.photo || item.image || item.file?.mimeType?.startsWith('image/'))) continue;
        // Only trust an actual EXIF/filesystem capture date for date-range
        // filtering — falling back to the OneDrive upload timestamp (the old
        // behavior) meant photos taken well outside the trip could still
        // match just because they happened to be uploaded during it.
        if ((from_ || to_) && !item.photo?.takenDateTime && !item.fileSystemInfo?.createdDateTime && !item.fileSystemInfo?.lastModifiedDateTime) {
          continue;
        }
        const taken = resolveTakenDate(item);
        if (from_ && taken < from_) continue;
        if (to_   && taken > to_)   continue;
        collected.push(item);
      }
      const next = result.data?.['@odata.nextLink'];
      if (!next) { url = null; break; }
      try { const u = new URL(next); url = u.pathname.replace('/v1.0', '') + u.search; }
      catch { url = null; }
    }
  }

  collected.sort((a, b) => resolveTakenDate(b).localeCompare(resolveTakenDate(a)));

  if (page === 1) {
    console.log(`[oneDrive] searchPhotos: visited ${foldersVisited} folder(s), matched ${collected.length} photo(s) in range`, { from, to });
  }

  const start = (page - 1) * size;
  return {
    assets: collected.slice(start, start + size).map((p: any) => ({
      id:        p.id,
      name:      p.name,
      takenAt:   resolveTakenDate(p),
      thumbnail: p.thumbnails?.[0]?.large?.url || p.thumbnails?.[0]?.medium?.url || p.thumbnails?.[0]?.small?.url,
    })),
    hasMore: collected.length > start + size,
  };
}

// ── Stream/proxy a OneDrive photo ────────────────────────────────────────────
export async function streamOneDriveAsset(
  res: Response,
  userId: number,
  assetId: string,
  size: 'thumbnail' | 'original' = 'thumbnail',
): Promise<void> {
  const token = await getAccessToken(userId);
  if (!token) { res.status(401).json({ error: 'Not connected' }); return; }

  try {
    let url: string;
    if (size === 'thumbnail') {
      const meta = await graphGet(userId, `/me/drive/items/${assetId}/thumbnails`);
      if (meta.error || !meta.data?.value?.length) {
        res.status(404).json({ error: 'Thumbnail not found' }); return;
      }
      url = meta.data.value[0]?.large?.url || meta.data.value[0]?.medium?.url || meta.data.value[0]?.small?.url;
      if (!url) { res.status(404).json({ error: 'Thumbnail URL not found' }); return; }
      // Thumbnails from Graph are pre-signed URLs, no auth needed
      const r = await fetch(url);
      if (!r.ok) { res.status(r.status).end(); return; }
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const buf = await r.arrayBuffer();
      res.end(Buffer.from(buf));
    } else {
      // Use large thumbnail from Graph (already JPEG, no HEIC issues)
      const meta = await graphGet(userId, `/me/drive/items/${assetId}/thumbnails/0`);
      if (meta.error || !meta.data) { res.status(404).json({ error: 'Not found' }); return; }
      const url = meta.data.large?.url || meta.data.medium?.url || meta.data.small?.url;
      if (!url) { res.status(404).json({ error: 'Thumbnail URL not found' }); return; }
      const r = await fetch(url);
      if (!r.ok) { res.status(r.status).end(); return; }
      res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const buf = await r.arrayBuffer();
      res.end(Buffer.from(buf));
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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

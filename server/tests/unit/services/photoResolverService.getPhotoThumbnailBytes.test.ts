/**
 * Unit tests for photoResolverService.getPhotoThumbnailBytes —
 * PHOTORESOLVER-001 through PHOTORESOLVER-008.
 *
 * Only this one function is covered here (the rest of
 * photoResolverService.ts has no existing test file, and standing that up
 * is out of scope for this change) — the byte-returning helper added for
 * journeyCoverSuggestService.ts's vision AI call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  return { testDb: db, dbMock: { db, closeDb: () => {}, reinitialize: () => {} } };
});
vi.mock('../../../src/db/database', () => dbMock);

const { existsSync, readFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));
vi.mock('fs', () => ({
  default: { existsSync, readFileSync },
  existsSync,
  readFileSync,
}));

const { ensureLocalThumbnail } = vi.hoisted(() => ({ ensureLocalThumbnail: vi.fn() }));
vi.mock('../../../src/services/memories/thumbnailService', () => ({ ensureLocalThumbnail }));

const { fetchImmichThumbnailBytes } = vi.hoisted(() => ({ fetchImmichThumbnailBytes: vi.fn() }));
vi.mock('../../../src/services/memories/immichService', () => ({
  fetchImmichThumbnailBytes,
  streamImmichAsset: vi.fn(),
  getAssetInfo: vi.fn(),
}));

const { fetchSynologyThumbnailBytes } = vi.hoisted(() => ({ fetchSynologyThumbnailBytes: vi.fn() }));
vi.mock('../../../src/services/memories/synologyService', () => ({
  fetchSynologyThumbnailBytes,
  streamSynologyAsset: vi.fn(),
  getSynologyAssetInfo: vi.fn(),
}));

vi.mock('../../../src/services/apiKeyCrypto', () => ({
  encrypt_api_key: (s: string) => s,
  decrypt_api_key: (s: string) => s,
}));

import { getPhotoThumbnailBytes } from '../../../src/services/memories/photoResolverService';

/** Minimal trek_photos table — just the columns getPhotoThumbnailBytes reads. */
testDb.exec(`
  CREATE TABLE trek_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT,
    asset_id TEXT,
    owner_id INTEGER,
    file_path TEXT,
    thumbnail_path TEXT,
    passphrase TEXT,
    width INTEGER,
    height INTEGER
  )
`);

beforeEach(() => {
  testDb.exec('DELETE FROM trek_photos');
  vi.clearAllMocks();
});

function insertPhoto(row: Partial<{ provider: string; asset_id: string; owner_id: number; file_path: string; thumbnail_path: string }>) {
  const result = testDb.prepare(`
    INSERT INTO trek_photos (provider, asset_id, owner_id, file_path, thumbnail_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.provider ?? null, row.asset_id ?? null, row.owner_id ?? null, row.file_path ?? null, row.thumbnail_path ?? null);
  return result.lastInsertRowid as number;
}

describe('getPhotoThumbnailBytes', () => {
  it('PHOTORESOLVER-001: returns null when the photo does not exist', async () => {
    const result = await getPhotoThumbnailBytes(1, 999999);
    expect(result).toBeNull();
  });

  it('PHOTORESOLVER-002: local photo with an existing thumbnail_path reads it directly', async () => {
    const id = insertPhoto({ provider: 'local', file_path: 'journey/photo.jpg', thumbnail_path: 'journey/thumbs/abc.jpg' });
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(Buffer.from('thumb-bytes'));

    const result = await getPhotoThumbnailBytes(1, id);

    expect(result).toEqual({ bytes: Buffer.from('thumb-bytes'), contentType: 'image/jpeg' });
    expect(ensureLocalThumbnail).not.toHaveBeenCalled();
  });

  it('PHOTORESOLVER-003: local photo with no thumbnail_path generates one via ensureLocalThumbnail', async () => {
    const id = insertPhoto({ provider: 'local', file_path: 'journey/photo.jpg' });
    ensureLocalThumbnail.mockResolvedValue({ thumbnailRelPath: 'journey/thumbs/xyz.jpg', width: 800, height: 600 });
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(Buffer.from('generated-thumb'));

    const result = await getPhotoThumbnailBytes(1, id);

    expect(ensureLocalThumbnail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ bytes: Buffer.from('generated-thumb'), contentType: 'image/jpeg' });
  });

  it('PHOTORESOLVER-004: returns null for a local photo when ensureLocalThumbnail fails to produce one (e.g. the Journey addon is disabled, or the original is missing)', async () => {
    const id = insertPhoto({ provider: 'local', file_path: 'journey/missing.jpg' });
    ensureLocalThumbnail.mockResolvedValue(null);

    const result = await getPhotoThumbnailBytes(1, id);

    expect(result).toBeNull();
  });

  it('PHOTORESOLVER-004b: returns null when a thumbnail path is known/generated but the file is missing on disk', async () => {
    const id = insertPhoto({ provider: 'local', file_path: 'journey/photo.jpg', thumbnail_path: 'journey/thumbs/gone.jpg' });
    existsSync.mockReturnValue(false);

    const result = await getPhotoThumbnailBytes(1, id);

    expect(result).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('PHOTORESOLVER-005: delegates to fetchImmichThumbnailBytes for an immich photo', async () => {
    const id = insertPhoto({ provider: 'immich', asset_id: 'asset-1', owner_id: 42 });
    fetchImmichThumbnailBytes.mockResolvedValue({ bytes: Buffer.from('immich-bytes'), contentType: 'image/webp' });

    const result = await getPhotoThumbnailBytes(1, id);

    expect(fetchImmichThumbnailBytes).toHaveBeenCalledWith(1, 'asset-1', 42);
    expect(result).toEqual({ bytes: Buffer.from('immich-bytes'), contentType: 'image/webp' });
  });

  it('PHOTORESOLVER-006: returns null when fetchImmichThumbnailBytes errors', async () => {
    const id = insertPhoto({ provider: 'immich', asset_id: 'asset-1', owner_id: 42 });
    fetchImmichThumbnailBytes.mockResolvedValue({ error: 'Not found', status: 404 });

    const result = await getPhotoThumbnailBytes(1, id);

    expect(result).toBeNull();
  });

  it('PHOTORESOLVER-007: delegates to fetchSynologyThumbnailBytes for a synologyphotos photo', async () => {
    const id = insertPhoto({ provider: 'synologyphotos', asset_id: 'asset-2', owner_id: 7 });
    fetchSynologyThumbnailBytes.mockResolvedValue({ bytes: Buffer.from('synology-bytes'), contentType: 'image/jpeg' });

    const result = await getPhotoThumbnailBytes(1, id);

    expect(fetchSynologyThumbnailBytes).toHaveBeenCalledWith(1, 7, 'asset-2', undefined);
    expect(result).toEqual({ bytes: Buffer.from('synology-bytes'), contentType: 'image/jpeg' });
  });

  it('PHOTORESOLVER-008: returns null for an onedrive photo (no byte-returning fetch exists for that provider)', async () => {
    const id = insertPhoto({ provider: 'onedrive', asset_id: 'asset-3', owner_id: 7 });

    const result = await getPhotoThumbnailBytes(1, id);

    expect(result).toBeNull();
  });
});

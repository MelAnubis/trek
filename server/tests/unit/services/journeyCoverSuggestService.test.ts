/**
 * Unit tests for journeyCoverSuggestService — COVER-001 through COVER-012.
 * Uses a real in-memory SQLite DB (for gallery sampling + applying the
 * result) and mocks getPhotoThumbnailBytes + global fetch so no network
 * call or provider credential is needed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: () => null,
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

const { getPhotoThumbnailBytes } = vi.hoisted(() => ({ getPhotoThumbnailBytes: vi.fn() }));
vi.mock('../../../src/services/memories/photoResolverService', () => ({ getPhotoThumbnailBytes }));

// The service writes the chosen cover to disk (uploads/journey/<uuid>.jpg) —
// stub node:fs so this test never touches the real filesystem.
const { fsWriteFileSync } = vi.hoisted(() => ({ fsWriteFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  default: { existsSync: () => true, mkdirSync: () => {}, writeFileSync: fsWriteFileSync },
  existsSync: () => true,
  mkdirSync: () => {},
  writeFileSync: fsWriteFileSync,
}));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createJourney } from '../../helpers/factories';
import { suggestAndApplyCover } from '../../../src/services/journeyCoverSuggestService';

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  getPhotoThumbnailBytes.mockReset();
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  testDb.close();
});

/** Inserts a trek_photos + journey_photos row and returns the trek_photos id. */
function insertGalleryPhoto(journeyId: number, opts: { provider?: string; filePath?: string } = {}): number {
  const provider = opts.provider ?? 'local';
  const trekResult = testDb.prepare(`
    INSERT INTO trek_photos (provider, asset_id, file_path, owner_id, created_at)
    VALUES (?, NULL, ?, NULL, ?)
  `).run(provider, opts.filePath ?? '/photos/test.jpg', Date.now());
  const trekId = trekResult.lastInsertRowid as number;
  testDb.prepare(`
    INSERT INTO journey_photos (journey_id, photo_id, caption, sort_order, created_at)
    VALUES (?, ?, NULL, 0, ?)
  `).run(journeyId, trekId, Date.now());
  return trekId;
}

const FAKE_BYTES = { bytes: Buffer.from('fake-jpeg-bytes'), contentType: 'image/jpeg' };

describe('suggestAndApplyCover', () => {
  it('COVER-001: returns null when the journey does not exist', async () => {
    const { user } = createUser(testDb);
    const result = await suggestAndApplyCover(999999, user.id);
    expect(result).toBeNull();
  });

  it('COVER-002: returns null when the caller is not the journey owner', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);
    insertGalleryPhoto(journey.id);

    const result = await suggestAndApplyCover(journey.id, stranger.id);

    expect(result).toBeNull();
  });

  it('COVER-003: throws NO_ELIGIBLE_PHOTOS when the gallery is empty', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await expect(suggestAndApplyCover(journey.id, user.id)).rejects.toThrow(/NO_ELIGIBLE_PHOTOS/);
  });

  it('COVER-004: throws NO_ELIGIBLE_PHOTOS when every candidate photo\'s bytes fail to fetch', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(null);

    await expect(suggestAndApplyCover(journey.id, user.id)).rejects.toThrow(/NO_ELIGIBLE_PHOTOS/);
  });

  it('COVER-005: skips onedrive photos when sampling candidates', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id, { provider: 'onedrive' });
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);

    await expect(suggestAndApplyCover(journey.id, user.id)).rejects.toThrow(/NO_ELIGIBLE_PHOTOS/);
    expect(getPhotoThumbnailBytes).not.toHaveBeenCalled();
  });

  it('COVER-006: throws NO_AI_KEY when no vision provider is configured', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);

    await expect(suggestAndApplyCover(journey.id, user.id)).rejects.toThrow(/NO_AI_KEY/);
  });

  it('COVER-007: applies the AI-chosen photo as cover_image and returns the updated journey', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id, { title: 'Alps Trip' });
    insertGalleryPhoto(journey.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"best": 2}' }] } }] }),
      text: async () => '',
    }));

    const result = await suggestAndApplyCover(journey.id, user.id);

    expect(result).not.toBeNull();
    expect(result!.cover_image).toMatch(/^journey\/[0-9a-f-]+\.jpg$/);
  });

  it('COVER-008: falls back to the first candidate when the AI response is unparsable', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
      text: async () => '',
    }));

    const result = await suggestAndApplyCover(journey.id, user.id);

    expect(result).not.toBeNull();
  });

  it('COVER-009: sends every candidate as a base64 inline image in a single Gemini request', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id);
    insertGalleryPhoto(journey.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"best": 1}' }] } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await suggestAndApplyCover(journey.id, user.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const inlineParts = body.contents[0].parts.filter((p: any) => p.inline_data);
    expect(inlineParts).toHaveLength(3);
    expect(inlineParts[0].inline_data.data).toBe(FAKE_BYTES.bytes.toString('base64'));
  });

  it('COVER-010: caps candidates at 12 even when the gallery has more photos', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    for (let i = 0; i < 20; i++) insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"best": 1}' }] } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await suggestAndApplyCover(journey.id, user.id);

    expect(getPhotoThumbnailBytes).toHaveBeenCalledTimes(12);
  });

  it('COVER-011: falls back to Claude when only ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"best": 1}' }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await suggestAndApplyCover(journey.id, user.id);

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
  });

  it('COVER-012: throws a provider error with status when the vision API responds non-ok', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    insertGalleryPhoto(journey.id);
    getPhotoThumbnailBytes.mockResolvedValue(FAKE_BYTES);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }));

    await expect(suggestAndApplyCover(journey.id, user.id)).rejects.toThrow(/Gemini 429/);
  });
});

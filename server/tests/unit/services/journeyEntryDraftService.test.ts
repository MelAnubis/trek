/**
 * Unit tests for journeyEntryDraftService — DRAFT-001 through DRAFT-009.
 * Uses a real in-memory SQLite DB (for the access check) and mocks
 * aiTextService.askAIText so no network call is made.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

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
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

const { askAIText } = vi.hoisted(() => ({ askAIText: vi.fn() }));
vi.mock('../../../src/services/aiTextService', () => ({ askAIText }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createJourney } from '../../helpers/factories';
import { draftEntryStory } from '../../../src/services/journeyEntryDraftService';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  askAIText.mockReset();
  askAIText.mockResolvedValue('A lovely day exploring the old town.');
});

afterAll(() => {
  testDb.close();
});

describe('draftEntryStory', () => {
  it('DRAFT-001: returns null when the journey does not exist', async () => {
    const { user } = createUser(testDb);
    const result = await draftEntryStory(999999, user.id, {});
    expect(result).toBeNull();
    expect(askAIText).not.toHaveBeenCalled();
  });

  it('DRAFT-002: returns null when the caller cannot access the journey', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);

    const result = await draftEntryStory(journey.id, stranger.id, {});

    expect(result).toBeNull();
    expect(askAIText).not.toHaveBeenCalled();
  });

  it('DRAFT-003: returns the AI-generated story for an accessible journey', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const result = await draftEntryStory(journey.id, user.id, { location_name: 'Kyoto' });

    expect(result).toEqual({ story: 'A lovely day exploring the old town.' });
  });

  it('DRAFT-004: includes the journey title and supplied facts in the prompt', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id, { title: 'Japan Spring Trip' });

    await draftEntryStory(journey.id, user.id, {
      location_name: 'Kyoto',
      entry_date: '2026-03-20',
      mood: 'peaceful',
      weather: 'sunny',
      pros: ['great food'],
      cons: ['crowded'],
      photoCaptions: ['Bamboo grove at dusk'],
    });

    expect(askAIText).toHaveBeenCalledTimes(1);
    const [system, user_] = askAIText.mock.calls[0];
    expect(system).toContain('Japan Spring Trip');
    expect(user_).toContain('Kyoto');
    expect(user_).toContain('peaceful');
    expect(user_).toContain('sunny');
    expect(user_).toContain('great food');
    expect(user_).toContain('crowded');
    expect(user_).toContain('Bamboo grove at dusk');
  });

  it('DRAFT-005: passes the requested language through to the system prompt', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await draftEntryStory(journey.id, user.id, {}, 'es');

    const [system] = askAIText.mock.calls[0];
    expect(system).toContain('es');
  });

  it('DRAFT-006: when notes are already present, asks the AI to expand them rather than invent an entry', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await draftEntryStory(journey.id, user.id, { notes: 'saw a temple, ate ramen' });

    const [, userPrompt] = askAIText.mock.calls[0];
    expect(userPrompt).toContain('saw a temple, ate ramen');
    expect(userPrompt).toMatch(/expand/i);
  });

  it('DRAFT-007: strips a wrapping quote pair the AI sometimes adds', async () => {
    askAIText.mockResolvedValue('"A day full of surprises."');
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const result = await draftEntryStory(journey.id, user.id, {});

    expect(result!.story).toBe('A day full of surprises.');
  });

  it('DRAFT-008: strips a markdown code fence the AI sometimes adds', async () => {
    askAIText.mockResolvedValue('```\nA day full of surprises.\n```');
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const result = await draftEntryStory(journey.id, user.id, {});

    expect(result!.story).toBe('A day full of surprises.');
  });

  it('DRAFT-009: propagates a NO_AI_KEY error from askAIText so the route can turn it into a 503', async () => {
    askAIText.mockRejectedValue(new Error('NO_AI_KEY: nothing configured'));
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await expect(draftEntryStory(journey.id, user.id, {})).rejects.toThrow(/NO_AI_KEY/);
  });
});

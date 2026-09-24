/**
 * Unit tests for journeyTitleSuggestService — TITLESUGGEST-001 through
 * TITLESUGGEST-011. Uses a real in-memory SQLite DB (getJourneyFull's
 * queries run for real) and mocks aiTextService.askAIText so no network
 * call is made.
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
import { createUser, createJourney, createJourneyEntry } from '../../helpers/factories';
import { suggestJourneyTitle } from '../../../src/services/journeyTitleSuggestService';

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  askAIText.mockReset();
  askAIText.mockResolvedValue('{"title": "Alpine Wanderings", "subtitle": "Ten days chasing summits across the Alps."}');
});

afterAll(() => {
  testDb.close();
});

describe('suggestJourneyTitle', () => {
  it('TITLESUGGEST-001: returns null when the journey does not exist', async () => {
    const { user } = createUser(testDb);
    const result = await suggestJourneyTitle(999999, user.id);
    expect(result).toBeNull();
    expect(askAIText).not.toHaveBeenCalled();
  });

  it('TITLESUGGEST-002: returns null when the caller is not the journey owner', async () => {
    const { user: owner } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);

    const result = await suggestJourneyTitle(journey.id, stranger.id);

    expect(result).toBeNull();
    expect(askAIText).not.toHaveBeenCalled();
  });

  it('TITLESUGGEST-003: returns the AI-generated title and subtitle for an accessible journey', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const result = await suggestJourneyTitle(journey.id, user.id);

    expect(result).toEqual({ title: 'Alpine Wanderings', subtitle: 'Ten days chasing summits across the Alps.' });
  });

  it('TITLESUGGEST-004: includes real entries (location, title, mood, story snippet) in the prompt, but skips skeleton entries', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id, { title: 'Untitled' });
    createJourneyEntry(testDb, journey.id, user.id, {
      entry_date: '2026-03-20', location_name: 'Kyoto', title: 'Temple Day', mood: 'peaceful',
      story: 'Walked through the bamboo grove at dawn, hardly anyone else around.',
    });
    createJourneyEntry(testDb, journey.id, user.id, { type: 'skeleton', entry_date: '2026-03-21', location_name: 'Osaka' });

    await suggestJourneyTitle(journey.id, user.id);

    const [, userPrompt] = askAIText.mock.calls[0];
    expect(userPrompt).toContain('Kyoto');
    expect(userPrompt).toContain('Temple Day');
    expect(userPrompt).toContain('peaceful');
    expect(userPrompt).toContain('bamboo grove');
    expect(userPrompt).not.toContain('Osaka');
  });

  it('TITLESUGGEST-005: includes linked trip title and dates in the prompt', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const tripResult = testDb.prepare(
      "INSERT INTO trips (user_id, title, start_date, end_date, currency) VALUES (?, 'Pyrenees Trek', '2026-07-01', '2026-07-10', 'EUR')"
    ).run(user.id);
    testDb.prepare('INSERT INTO journey_trips (journey_id, trip_id, added_at) VALUES (?, ?, ?)')
      .run(journey.id, tripResult.lastInsertRowid, Date.now());

    await suggestJourneyTitle(journey.id, user.id);

    const [, userPrompt] = askAIText.mock.calls[0];
    expect(userPrompt).toContain('Pyrenees Trek');
    expect(userPrompt).toContain('2026-07-01');
  });

  it('TITLESUGGEST-006: notes that there are no entries yet when the journey is empty', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await suggestJourneyTitle(journey.id, user.id);

    const [, userPrompt] = askAIText.mock.calls[0];
    expect(userPrompt).toMatch(/no journal entries/i);
  });

  it('TITLESUGGEST-007: passes the requested language through to the system prompt', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await suggestJourneyTitle(journey.id, user.id, 'es');

    const [system] = askAIText.mock.calls[0];
    expect(system).toContain('es');
  });

  it('TITLESUGGEST-008: strips a markdown code fence the AI sometimes adds', async () => {
    askAIText.mockResolvedValue('```json\n{"title": "Coastal Drift", "subtitle": "A slow week along the coast."}\n```');
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    const result = await suggestJourneyTitle(journey.id, user.id);

    expect(result).toEqual({ title: 'Coastal Drift', subtitle: 'A slow week along the coast.' });
  });

  it('TITLESUGGEST-009: throws when the AI response is not valid JSON', async () => {
    askAIText.mockResolvedValue('Sorry, I cannot help with that.');
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await expect(suggestJourneyTitle(journey.id, user.id)).rejects.toThrow(/could not be parsed/i);
  });

  it('TITLESUGGEST-010: throws when the AI response has no usable title', async () => {
    askAIText.mockResolvedValue('{"title": "", "subtitle": "Something"}');
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await expect(suggestJourneyTitle(journey.id, user.id)).rejects.toThrow(/could not be parsed/i);
  });

  it('TITLESUGGEST-011: propagates a NO_AI_KEY error so the route can turn it into a 503', async () => {
    askAIText.mockRejectedValue(new Error('NO_AI_KEY: nothing configured'));
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);

    await expect(suggestJourneyTitle(journey.id, user.id)).rejects.toThrow(/NO_AI_KEY/);
  });
});

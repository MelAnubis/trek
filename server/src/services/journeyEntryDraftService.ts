// ─────────────────────────────────────────────────────────────────────────────
// journeyEntryDraftService.ts
//
// "Draft with AI" for a journal entry's story text — given whatever the
// traveler has already filled in (place, date, mood, weather, pros/cons,
// photo captions, and any notes they've started typing), asks an AI
// provider (via aiTextService.ts) to write a short first-person diary
// paragraph, in the traveler's own language, that they can then edit.
//
// Deliberately entry-agnostic rather than reading a saved journey_entries
// row: the "new entry" form (entry.id === 0) has the same fields in memory
// before the first save, and — like weatherService's suggestion endpoint —
// there is no reason to force a save first just to draft text.
// ─────────────────────────────────────────────────────────────────────────────

import { canAccessJourney } from './journeyService';
import { askAIText } from './aiTextService';

export interface DraftEntryInput {
  location_name?: string | null;
  entry_date?: string | null;
  mood?: string | null;
  weather?: string | null;
  pros?: string[];
  cons?: string[];
  photoCaptions?: string[];
  notes?: string | null;
}

function buildPrompt(journeyTitle: string, input: DraftEntryInput, lang: string): { system: string; user: string } {
  const system =
    `You are helping a traveler write a personal journal entry for their trip "${journeyTitle}". ` +
    `Write in the first person, in a warm, natural, unpretentious voice — like a real travel diary, not marketing copy. ` +
    `Write in this language: ${lang}. ` +
    `Respond with ONLY the diary paragraph text — no title, no markdown, no quotation marks around it, no preamble.`;

  const facts: string[] = [];
  if (input.location_name) facts.push(`Place: ${input.location_name}`);
  if (input.entry_date) facts.push(`Date: ${input.entry_date}`);
  if (input.mood) facts.push(`Overall mood that day: ${input.mood}`);
  if (input.weather) facts.push(`Weather: ${input.weather}`);
  if (input.pros?.length) facts.push(`Things that went well: ${input.pros.join('; ')}`);
  if (input.cons?.length) facts.push(`Things that were difficult or disappointing: ${input.cons.join('; ')}`);
  if (input.photoCaptions?.length) facts.push(`Captions from photos taken that day: ${input.photoCaptions.join('; ')}`);

  const user =
    (facts.length ? `Known details about this day:\n${facts.join('\n')}\n\n` : '') +
    (input.notes?.trim()
      ? `The traveler already jotted down these rough notes — expand them into full prose, keeping their voice and facts, don't invent unrelated events:\n${input.notes.trim()}\n\n`
      : `The traveler hasn't written anything yet — write an original 2-4 sentence entry grounded only in the known details above. If there is almost nothing to go on, keep it short and simple rather than inventing specifics.\n\n`) +
    'Write the diary entry now.';

  return { system, user };
}

/** Strips a wrapping quote pair or markdown fence an AI sometimes adds despite instructions not to. */
function cleanDraft(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/**
 * Returns null when the journey doesn't exist or the caller can't reach it —
 * same "null means not found/not allowed" convention the rest of
 * journeyService.ts's functions use, so the route can turn it into a 404
 * without this function needing to know about HTTP.
 */
export async function draftEntryStory(
  journeyId: number,
  userId: number,
  input: DraftEntryInput,
  lang = 'en',
): Promise<{ story: string } | null> {
  const journey = canAccessJourney(journeyId, userId);
  if (!journey) return null;

  const { system, user } = buildPrompt(journey.title, input, lang);
  const raw = await askAIText(system, user, { maxTokens: 500, temperature: 0.8 });
  return { story: cleanDraft(raw) };
}

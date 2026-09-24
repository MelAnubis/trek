// ─────────────────────────────────────────────────────────────────────────────
// journeyTitleSuggestService.ts
//
// "Suggest with AI" for a journey's title + subtitle — reads the journey's
// own content (entries, linked trips, stats) via getJourneyFull() and asks
// aiTextService for a short title and one-sentence subtitle.
//
// Suggest-only, deliberately: unlike task #21's cover suggestion (a photo
// has nothing to "review" before it's applied), a title is text the
// traveler already wrote themselves — this returns a suggestion for the
// settings dialog's own title/subtitle fields to be filled with, the same
// way task #20's entry-draft endpoint fills a story box, and the existing
// Save button in that dialog is what actually persists it (or Cancel
// discards it) exactly like every other edit made there.
// ─────────────────────────────────────────────────────────────────────────────

import { isOwner, getJourneyFull } from './journeyService';
import { askAIText } from './aiTextService';

/** Bounds the prompt's size for a journey with a very large number of entries. */
const MAX_ENTRIES_IN_PROMPT = 40;
const MAX_TITLE_LENGTH = 80;
const MAX_SUBTITLE_LENGTH = 200;

function summarizeEntry(e: { entry_date: string; location_name: string | null; title: string | null; story: string | null; mood: string | null }): string {
  const bits = [e.entry_date];
  if (e.location_name) bits.push(e.location_name);
  if (e.title) bits.push(`"${e.title}"`);
  if (e.mood) bits.push(`mood: ${e.mood}`);
  const snippet = e.story?.trim().slice(0, 150);
  const line = bits.join(' — ');
  return snippet ? `${line}: ${snippet}` : line;
}

function buildPrompt(full: ReturnType<typeof getJourneyFull>, lang: string): { system: string; user: string } {
  const system =
    `You are helping name a personal travel journal. Given details about a trip, write: ` +
    `(1) a short, evocative title — 2 to 6 words, no generic phrases like "My Trip" or "Vacation", ` +
    `and (2) a one-sentence subtitle capturing the essence of the journey. ` +
    `Write in this language: ${lang}. ` +
    `Respond with ONLY a raw JSON object: {"title": string, "subtitle": string}.`;

  const realEntries = (full!.entries as any[])
    .filter(e => e.type !== 'skeleton' && (e.story || e.title || e.location_name))
    .slice(0, MAX_ENTRIES_IN_PROMPT);

  const facts: string[] = [];
  const trips = full!.trips as { title: string; start_date: string | null; end_date: string | null }[];
  if (trips.length) {
    facts.push(`Trip(s): ${trips.map(t => `${t.title}${t.start_date ? ` (${t.start_date} to ${t.end_date ?? '?'})` : ''}`).join('; ')}`);
  }
  const stats = full!.stats;
  facts.push(`${stats.entries} journal entries, ${stats.places} places, ${stats.countries} countries.`);
  if (realEntries.length) {
    facts.push('Entries:\n' + realEntries.map(summarizeEntry).join('\n'));
  } else {
    facts.push('No journal entries have been written yet — keep the title and subtitle short and generic based only on the trip info above, if any.');
  }

  const user = facts.join('\n\n') + '\n\nWrite the title and subtitle now.';
  return { system, user };
}

function parseSuggestion(raw: string): { title: string; subtitle: string } | null {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(clean) as { title?: string; subtitle?: string };
    const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
    const subtitle = typeof parsed.subtitle === 'string' ? parsed.subtitle.trim().slice(0, MAX_SUBTITLE_LENGTH) : '';
    return title ? { title, subtitle } : null;
  } catch {
    return null;
  }
}

/**
 * Returns null when the journey doesn't exist or the caller isn't its
 * owner — title/subtitle are owner-only edits (see journeyService.ts's
 * updateJourney), so generating a suggestion for fields the caller
 * couldn't save anyway isn't useful.
 */
export async function suggestJourneyTitle(
  journeyId: number,
  userId: number,
  lang = 'en',
): Promise<{ title: string; subtitle: string } | null> {
  if (!isOwner(journeyId, userId)) return null;
  const full = getJourneyFull(journeyId, userId);
  if (!full) return null;

  const { system, user } = buildPrompt(full, lang);
  const raw = await askAIText(system, user, { maxTokens: 200, temperature: 0.8 });
  const parsed = parseSuggestion(raw);
  if (!parsed) throw new Error('AI response could not be parsed into a title/subtitle');
  return parsed;
}

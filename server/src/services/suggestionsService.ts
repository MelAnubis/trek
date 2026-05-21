// ─────────────────────────────────────────────────────────────────────────────
// suggestionsService.ts
//
// "Must See Places" — uses Claude claude-haiku-4-5 to suggest unmissable spots
// for a trip, then geocodes them via Nominatim (or Google Places if the user
// has a key) to get coordinates + a photo URL.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '../db/database';
import { getMapsKey, searchNominatim, fetchWikimediaPhoto } from './mapsService';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface TripContext {
  id: number;
  title: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface Suggestion {
  name: string;
  description: string;        // 1-2 sentence "why visit" blurb from Claude
  category: string;           // e.g. "Nature", "Museum", "Food", "Viewpoint"
  lat: number | null;
  lng: number | null;
  address: string | null;
  photo_url?: string | null;
}

// ── Claude call ──────────────────────────────────────────────────────────────

async function askClaude(tripCtx: TripContext, existingPlaceNames: string[], lang: string): Promise<Array<{ name: string; description: string; category: string }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const dateRange = [tripCtx.start_date, tripCtx.end_date].filter(Boolean).join(' → ');
  const existing = existingPlaceNames.length
    ? `\nAlready in itinerary (skip these): ${existingPlaceNames.join(', ')}`
    : '';

  const systemPrompt = `You are a world-class travel expert. When asked for must-see places for a trip, you respond ONLY with valid JSON — no markdown, no explanation. Language for names and descriptions: ${lang}.`;

  const userPrompt = `Trip: "${tripCtx.title}"${tripCtx.description ? `\nDetails: ${tripCtx.description}` : ''}${dateRange ? `\nDates: ${dateRange}` : ''}${existing}

List the top 8 must-see places or experiences for this trip. Focus on iconic, unique, or highly recommended spots that define the destination.

Respond ONLY with a JSON array, no other text:
[
  {
    "name": "exact place name in the local language or English",
    "description": "1-2 sentences on why this is unmissable",
    "category": "one of: Nature, Museum, Monument, Viewpoint, Food, Market, Beach, Architecture, Park, Religious, Entertainment, Other"
  }
]`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Claude API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  const raw = data.content?.find(c => c.type === 'text')?.text ?? '';

  // Strip possible markdown fences
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(clean) as Array<{ name: string; description: string; category: string }>;
  if (!Array.isArray(parsed)) throw new Error('Claude returned non-array response');

  return parsed.filter(p => p.name && p.description && p.category).slice(0, 10);
}

// ── Geocode a single suggestion ───────────────────────────────────────────────

async function geocode(name: string, tripTitle: string, userId: number): Promise<{ lat: number | null; lng: number | null; address: string | null }> {
  // Build a query combining place name and trip destination
  const query = `${name}, ${tripTitle}`;

  try {
    // Try Google Places first if user has a key
    const mapsKey = getMapsKey(userId);
    if (mapsKey) {
      const googleRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${mapsKey}&fields=geometry,formatted_address`,
      );
      if (googleRes.ok) {
        const gdata = await googleRes.json() as {
          results: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address: string }>;
        };
        const first = gdata.results?.[0];
        if (first) {
          return {
            lat: first.geometry.location.lat,
            lng: first.geometry.location.lng,
            address: first.formatted_address ?? null,
          };
        }
      }
    }
  } catch { /* fall through to Nominatim */ }

  try {
    const nResults = await searchNominatim(query);
    const first = nResults[0];
    if (first && first.lat != null && first.lng != null) {
      return { lat: first.lat, lng: first.lng, address: first.address ?? null };
    }
  } catch { /* fall through */ }

  return { lat: null, lng: null, address: null };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getMustSeeSuggestions(tripId: number, userId: number, lang = 'en'): Promise<Suggestion[]> {
  // 1. Load trip context from DB
  const trip = db.prepare('SELECT id, title, description, start_date, end_date FROM trips WHERE id = ?').get(tripId) as TripContext | undefined;
  if (!trip) throw new Error('Trip not found');

  // 2. Get existing place names to avoid duplicates
  const existingPlaces = db.prepare('SELECT name FROM places WHERE trip_id = ?').all(tripId) as Array<{ name: string }>;
  const existingNames = existingPlaces.map(p => p.name);

  // 3. Ask Claude for suggestions
  const rawSuggestions = await askClaude(trip, existingNames, lang);

  // 4. Geocode each suggestion (in parallel, max 5 concurrent)
  const results: Suggestion[] = [];
  const chunks = [];
  for (let i = 0; i < rawSuggestions.length; i += 3) {
    chunks.push(rawSuggestions.slice(i, i + 3));
  }

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map(async (s) => {
        const geo = await geocode(s.name, trip.title, userId);

        // 5. Fetch a photo from Wikimedia if we have coords
        let photo_url: string | null = null;
        if (geo.lat != null && geo.lng != null) {
          try {
            const wikiResult = await fetchWikimediaPhoto(geo.lat, geo.lng, s.name);
            photo_url = wikiResult?.photoUrl ?? null;
          } catch { /* no photo — no problem */ }
        }

        return {
          name: s.name,
          description: s.description,
          category: s.category,
          lat: geo.lat,
          lng: geo.lng,
          address: geo.address,
          photo_url,
        } satisfies Suggestion;
      }),
    );

    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }

  return results;
}

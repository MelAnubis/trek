// ─────────────────────────────────────────────────────────────────────────────
// receiptScanService.ts
//
// Sends a photographed receipt/invoice/ticket to a vision-capable AI provider
// and extracts structured expense fields, so the Budget "Scan receipt" button
// can prefill the expense form instead of the traveler typing it all by hand.
// Mirrors the provider fallback pattern in suggestionsService.ts, but only the
// providers with a vision-capable model wired up here (Gemini, then Claude).
// ─────────────────────────────────────────────────────────────────────────────

export interface ReceiptScanResult {
  name: string | null;
  total_price: number | null;
  currency: string | null;
  expense_date: string | null;
  category: string;
}

// Must match the category keys in client/src/components/Budget/costsCategories.tsx
const CATEGORIES = [
  'accommodation', 'food', 'groceries', 'transport', 'flights', 'activities',
  'sightseeing', 'shopping', 'fees', 'health', 'tips', 'other',
] as const;

function buildPrompt(): { system: string; user: string } {
  const system =
    'You are a receipt/invoice scanning assistant for a travel expense tracker. ' +
    'Extract structured data from the photographed receipt, invoice, or ticket. ' +
    'Respond ONLY with a single raw JSON object — no markdown code fences, no commentary.';

  const user =
    'Extract these fields from the receipt image:\n' +
    '- name: a short human-readable label for the expense (merchant name or what was purchased), max 60 characters\n' +
    "- total_price: the final total amount paid, as a plain number (no currency symbol, '.' as decimal separator)\n" +
    '- currency: the ISO 4217 currency code (e.g. EUR, USD, GBP), inferred from symbols/text if not explicit\n' +
    '- expense_date: the date on the receipt in YYYY-MM-DD format, or null if illegible\n' +
    `- category: exactly one of ${JSON.stringify(CATEGORIES)} — pick the closest match, default "other"\n\n` +
    'Respond with exactly this JSON shape:\n' +
    '{"name": string|null, "total_price": number|null, "currency": string|null, "expense_date": string|null, "category": string}\n\n' +
    'If the image is not a receipt, invoice, or ticket, respond with ' +
    '{"name": null, "total_price": null, "currency": null, "expense_date": null, "category": "other"}.';

  return { system, user };
}

function parseReceiptJson(raw: string): ReceiptScanResult {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(clean) as Partial<ReceiptScanResult>;

  const category = CATEGORIES.includes(parsed.category as any) ? (parsed.category as string) : 'other';
  const total_price = typeof parsed.total_price === 'number' && isFinite(parsed.total_price) ? parsed.total_price : null;
  const currency = typeof parsed.currency === 'string' && /^[A-Za-z]{3}$/.test(parsed.currency.trim())
    ? parsed.currency.trim().toUpperCase() : null;
  const expense_date = typeof parsed.expense_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.expense_date)
    ? parsed.expense_date : null;
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 60) : null;

  return { name, total_price, currency, expense_date, category };
}

async function askGeminiVision(base64: string, mimeType: string): Promise<ReceiptScanResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const { system, user } = buildPrompt();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `${system}\n\n${user}` },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return parseReceiptJson(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

async function askClaudeVision(base64: string, mimeType: string): Promise<ReceiptScanResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const { system, user } = buildPrompt();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: user },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return parseReceiptJson(data.content?.find(c => c.type === 'text')?.text ?? '');
}

/** Vision-capable providers only — Groq's configured model here is text-only. */
export async function scanReceipt(buffer: Buffer, mimeType: string): Promise<ReceiptScanResult> {
  const base64 = buffer.toString('base64');
  if (process.env.GEMINI_API_KEY) return askGeminiVision(base64, mimeType);
  if (process.env.ANTHROPIC_API_KEY) return askClaudeVision(base64, mimeType);
  throw new Error(
    'NO_AI_KEY: No vision-capable AI API key configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.',
  );
}

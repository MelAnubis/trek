// ─────────────────────────────────────────────────────────────────────────────
// aiTextService.ts
//
// A single text-completion call against whichever AI provider is configured,
// trying free/cheap providers before paid ones: Groq, then Gemini, then
// Claude. Same provider set and fallback order as suggestionsService.ts's
// getAIDescriptions() and the same NO_AI_KEY convention, factored out here
// because journal drafting (and the AI features planned right after it —
// best-photo selection, auto-title/summary) all need the same plain
// "system + user prompt in, text out" call rather than suggestionsService's
// POI-specific JSON-array shape or receiptScanService's vision-specific one.
// ─────────────────────────────────────────────────────────────────────────────

export interface AITextOptions {
  maxTokens?: number;
  temperature?: number;
}

// ── Models ───────────────────────────────────────────────────────────────────
// Providers retire models regularly (Groq removed llama-3.3-70b-versatile on
// 2026-08-16 and Google removed gemini-2.0-flash on 2026-06-01), so the model
// ids are overridable from the environment without a rebuild:
//   GROQ_MODEL, GEMINI_MODEL, ANTHROPIC_MODEL
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

export const groqModel = (): string => process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
export const geminiModel = (): string => process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
export const anthropicModel = (): string => process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;

/**
 * Model + token-limit fields for a Groq chat completion. gpt-oss models reason
 * before answering and those reasoning tokens count against the limit, so they
 * get low reasoning effort and extra headroom; otherwise a small limit can
 * return an empty answer.
 */
export function groqRequestBody(maxTokens: number): Record<string, unknown> {
  const model = groqModel();
  if (model.includes('gpt-oss')) {
    return { model, max_completion_tokens: maxTokens + 1024, reasoning_effort: 'low' };
  }
  return { model, max_tokens: maxTokens };
}

async function askGroqText(system: string, user: string, opts: AITextOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      ...groqRequestBody(opts.maxTokens ?? 1024),
      temperature: opts.temperature ?? 0.7,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function askGeminiText(system: string, user: string, opts: AITextOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function askClaudeText(system: string, user: string, opts: AITextOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: anthropicModel(),
      max_tokens: opts.maxTokens ?? 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content?.find(c => c.type === 'text')?.text ?? '';
}

/**
 * Plain text completion. Providers are tried in order Groq → Gemini → Claude,
 * skipping those without a key. If one fails (retired model, quota, outage) the
 * next configured one is tried; the last error is thrown if all of them fail.
 */
export async function askAIText(system: string, user: string, opts: AITextOptions = {}): Promise<string> {
  const providers: Array<[string, () => Promise<string>]> = [];
  if (process.env.GROQ_API_KEY) providers.push(['Groq', () => askGroqText(system, user, opts)]);
  if (process.env.GEMINI_API_KEY) providers.push(['Gemini', () => askGeminiText(system, user, opts)]);
  if (process.env.ANTHROPIC_API_KEY) providers.push(['Claude', () => askClaudeText(system, user, opts)]);
  if (providers.length === 0) {
    throw new Error(
      'NO_AI_KEY: No AI API key configured. Set GROQ_API_KEY (free), GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.',
    );
  }
  let lastErr: unknown;
  for (const [name, call] of providers) {
    try {
      const text = await call();
      if (text.trim()) return text;
      lastErr = new Error(`${name} returned an empty response`);
    } catch (err) {
      lastErr = err;
    }
    console.warn(`[aiText] ${name} failed, trying next provider if any:`, (lastErr as Error)?.message);
  }
  throw lastErr;
}

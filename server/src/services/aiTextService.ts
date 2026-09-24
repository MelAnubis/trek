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

async function askGroqText(system: string, user: string, opts: AITextOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: opts.maxTokens ?? 1024,
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens ?? 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content?.find(c => c.type === 'text')?.text ?? '';
}

/** Plain text completion, trying Groq → Gemini → Claude, whichever has a key set. */
export async function askAIText(system: string, user: string, opts: AITextOptions = {}): Promise<string> {
  if (process.env.GROQ_API_KEY) return askGroqText(system, user, opts);
  if (process.env.GEMINI_API_KEY) return askGeminiText(system, user, opts);
  if (process.env.ANTHROPIC_API_KEY) return askClaudeText(system, user, opts);
  throw new Error(
    'NO_AI_KEY: No AI API key configured. Set GROQ_API_KEY (free), GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.',
  );
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askAIText, groqRequestBody, groqModel, geminiModel, DEFAULT_GROQ_MODEL } from '../../src/services/aiTextService';

const KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_MODEL', 'GEMINI_MODEL', 'ANTHROPIC_MODEL'] as const;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const fail = (status: number, text = 'x') => ({ ok: false, status, json: async () => ({}), text: async () => text });
const groqOk = (content: string) => ok({ choices: [{ message: { content } }] });
const geminiOk = (text: string) => ok({ candidates: [{ content: { parts: [{ text }] } }] });

beforeEach(() => { for (const k of KEYS) delete process.env[k]; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const k of KEYS) delete process.env[k]; });

describe('aiTextService models', () => {
  it('AI-001 — default Groq model is not the retired llama-3.3 and gpt-oss gets reasoning headroom', () => {
    expect(groqModel()).toBe(DEFAULT_GROQ_MODEL);
    expect(groqModel()).not.toContain('llama-3.3-70b');
    const body = groqRequestBody(700);
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(700 + 1024);
    expect(body.max_tokens).toBeUndefined();
  });

  it('AI-002 — env vars override models; non gpt-oss models use plain max_tokens', () => {
    process.env.GROQ_MODEL = 'qwen/qwen3.6-27b';
    process.env.GEMINI_MODEL = 'gemini-x';
    expect(groqRequestBody(500)).toEqual({ model: 'qwen/qwen3.6-27b', max_tokens: 500 });
    expect(geminiModel()).toBe('gemini-x');
  });
});

describe('askAIText', () => {
  it('AI-003 — throws NO_AI_KEY when nothing is configured', async () => {
    await expect(askAIText('s', 'u')).rejects.toThrow('NO_AI_KEY');
  });

  it('AI-004 — sends the configured Groq model', async () => {
    process.env.GROQ_API_KEY = 'k';
    const f = vi.fn().mockResolvedValue(groqOk('hola'));
    vi.stubGlobal('fetch', f);
    expect(await askAIText('s', 'u', { maxTokens: 300 })).toBe('hola');
    const sent = JSON.parse(f.mock.calls[0][1].body);
    expect(sent.model).toBe('openai/gpt-oss-120b');
    expect(sent.messages[1].content).toBe('u');
  });

  it('AI-005 — falls back to the next provider when Groq fails (e.g. retired model)', async () => {
    process.env.GROQ_API_KEY = 'k1';
    process.env.GEMINI_API_KEY = 'k2';
    const f = vi.fn().mockImplementation(async (url: string) =>
      url.includes('groq.com') ? fail(404, 'model_not_found') : geminiOk('desde gemini'));
    vi.stubGlobal('fetch', f);
    expect(await askAIText('s', 'u')).toBe('desde gemini');
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0]).toContain('models/gemini-3.6-flash:generateContent');
  });

  it('AI-006 — falls back when a provider returns an empty answer', async () => {
    process.env.GROQ_API_KEY = 'k1';
    process.env.GEMINI_API_KEY = 'k2';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) =>
      url.includes('groq.com') ? groqOk('   ') : geminiOk('ok')));
    expect(await askAIText('s', 'u')).toBe('ok');
  });

  it('AI-007 — throws the last error when every provider fails', async () => {
    process.env.GROQ_API_KEY = 'k1';
    process.env.GEMINI_API_KEY = 'k2';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(500, 'boom')));
    await expect(askAIText('s', 'u')).rejects.toThrow(/Gemini 500/);
  });
});

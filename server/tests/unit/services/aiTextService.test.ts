/**
 * Unit tests for aiTextService — AITEXT-001 through AITEXT-010.
 * Stubs global fetch; no real network calls.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe('askAIText — provider fallback order', () => {
  it('AITEXT-001: throws NO_AI_KEY when no provider key is configured', async () => {
    const { askAIText } = await import('../../../src/services/aiTextService');
    await expect(askAIText('system', 'user')).rejects.toThrow(/NO_AI_KEY/);
  });

  it('AITEXT-002: uses Groq when GROQ_API_KEY is set', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'A Groq draft.' } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { askAIText } = await import('../../../src/services/aiTextService');
    const result = await askAIText('system', 'user');
    expect(result).toBe('A Groq draft.');
    expect(fetchMock).toHaveBeenCalledWith('https://api.groq.com/openai/v1/chat/completions', expect.anything());
  });

  it('AITEXT-003: falls back to Gemini when only GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'A Gemini draft.' }] } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { askAIText } = await import('../../../src/services/aiTextService');
    const result = await askAIText('system', 'user');
    expect(result).toBe('A Gemini draft.');
    expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
  });

  it('AITEXT-004: falls back to Claude when only ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'A Claude draft.' }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { askAIText } = await import('../../../src/services/aiTextService');
    const result = await askAIText('system', 'user');
    expect(result).toBe('A Claude draft.');
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
  });

  it('AITEXT-005: prefers Groq over Gemini and Claude when multiple keys are set', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Groq wins.' } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { askAIText } = await import('../../../src/services/aiTextService');
    const result = await askAIText('system', 'user');
    expect(result).toBe('Groq wins.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('groq.com');
  });

  it('AITEXT-006: throws with the provider name and status on a non-ok response', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }));
    const { askAIText } = await import('../../../src/services/aiTextService');
    await expect(askAIText('system', 'user')).rejects.toThrow(/Groq 429/);
  });

  it('AITEXT-007: sends the system/user prompt and options through to the provider body', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { askAIText } = await import('../../../src/services/aiTextService');
    await askAIText('be nice', 'write a story', { maxTokens: 300, temperature: 0.9 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toBe('be nice');
    expect(body.messages[0].content).toBe('write a story');
    expect(body.max_tokens).toBe(300);
  });

  it('AITEXT-008: returns an empty string rather than throwing when the response has no text content', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
      text: async () => '',
    }));
    const { askAIText } = await import('../../../src/services/aiTextService');
    const result = await askAIText('system', 'user');
    expect(result).toBe('');
  });
});

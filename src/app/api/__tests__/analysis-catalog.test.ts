// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../analysis/catalog/route';
import { installFakeFetch, SYNTHETIC, useSyntheticStore } from '@/test/fakes';

async function catalog() {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const text = await response.text();
  return { text, body: JSON.parse(text).catalog };
}

describe('GET /api/analysis/catalog', () => {
  it('lists both providers, their defaults and no credential values, without external calls', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_KEY', SYNTHETIC.GEMINI_KEY);
    vi.stubEnv('GOOGLE_MAPS_API_KEY', SYNTHETIC.MAPS_SERVER_KEY);
    const { calls } = installFakeFetch();
    const { text, body } = await catalog();

    expect(body).toEqual({
      providers: [
        {
          id: 'gemini',
          label: 'Gemini',
          operatorCredentials: true,
          participantKeys: true,
          models: [
            { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', workflows: ['scene', 'photo'], default: true },
            { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', workflows: ['scene', 'photo'], default: false },
          ],
        },
        {
          id: 'openai',
          label: 'OpenAI',
          operatorCredentials: false,
          participantKeys: true,
          models: [
            { id: 'gpt-6-luna', label: 'GPT-6 Luna', workflows: ['scene', 'photo'], default: true },
            { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', workflows: ['scene', 'photo'], default: false },
          ],
        },
      ],
      defaultSelection: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
    });
    expect(text).not.toMatch(/synthetic-/);
    expect(text).not.toContain('upstreamModel');
    expect(text).not.toContain('reasoningEffort');
    expect(calls).toHaveLength(0);
  });

  it('keeps a provider listed for participant keys when the server has no credentials for it', async () => {
    expect((await catalog()).body.providers[0]).toMatchObject({ id: 'gemini', operatorCredentials: false, participantKeys: true });
  });

  it('reflects stored operator credentials', async () => {
    await useSyntheticStore({ credentials: { geminiApiKey: SYNTHETIC.GEMINI_KEY } });
    const { text, body } = await catalog();
    expect(body.providers[0].operatorCredentials).toBe(true);
    expect(text).not.toContain(SYNTHETIC.GEMINI_KEY);
  });
});

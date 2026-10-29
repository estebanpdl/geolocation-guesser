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
  it('lists the Gemini default and no credential values, without external calls', async () => {
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
          models: [{ id: 'gemini-flash', label: 'Gemini Flash', workflows: ['scene', 'photo'], default: true }],
        },
      ],
      defaultSelection: { provider: 'gemini', model: 'gemini-flash' },
    });
    expect(text).not.toMatch(/synthetic-/);
    expect(text).not.toContain('gemini-flash-latest');
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

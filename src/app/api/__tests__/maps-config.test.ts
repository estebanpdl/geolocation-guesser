// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../maps/config/route';
import { installFakeFetch, rewriteStore, SYNTHETIC, useSyntheticStore } from '@/test/fakes';

let logSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined)
  );
});

afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
});

async function browserKey() {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  return body.maps.browserKey as string | null;
}

function loggedText(): string {
  return logSpies.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');
}

describe('GET /api/maps/config', () => {
  it('serves the browser key from the credential store at request time', async () => {
    const storePath = await useSyntheticStore({ credentials: { mapsBrowserKey: SYNTHETIC.MAPS_BROWSER_KEY } });
    const { calls } = installFakeFetch();
    expect(await browserKey()).toBe(SYNTHETIC.MAPS_BROWSER_KEY);

    await rewriteStore(storePath, { credentials: { mapsBrowserKey: 'synthetic-rotated-browser-key' } });
    expect(await browserKey()).toBe('synthetic-rotated-browser-key');
    expect(calls).toHaveLength(0);
  });

  it('prefers a nonempty environment value and treats placeholders as unset', async () => {
    await useSyntheticStore({ credentials: { mapsBrowserKey: SYNTHETIC.MAPS_BROWSER_KEY } });
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'synthetic-env-browser-key');
    expect(await browserKey()).toBe('synthetic-env-browser-key');

    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'your_google_maps_api_key_here');
    expect(await browserKey()).toBe(SYNTHETIC.MAPS_BROWSER_KEY);
  });

  it('returns null when no browser key is configured, never the server-only keys', async () => {
    await useSyntheticStore({ credentials: { mapsServerKey: SYNTHETIC.MAPS_SERVER_KEY, geminiApiKey: SYNTHETIC.GEMINI_KEY } });
    vi.stubEnv('OPENAI_API_KEY', SYNTHETIC.OPENAI_KEY);
    const response = await GET();
    const text = await response.text();
    expect(JSON.parse(text).maps).toEqual({ browserKey: null });
    expect(text).not.toMatch(/synthetic-/);
  });

  it('is served while training is open, like the game pages that need it', async () => {
    await useSyntheticStore({
      credentials: { mapsBrowserKey: SYNTHETIC.MAPS_BROWSER_KEY },
      training: { mode: 'open', accessCode: SYNTHETIC.ACCESS_CODE },
    });
    expect(await browserKey()).toBe(SYNTHETIC.MAPS_BROWSER_KEY);
  });

  it('never logs the key', async () => {
    await useSyntheticStore({ credentials: { mapsBrowserKey: SYNTHETIC.MAPS_BROWSER_KEY } });
    await browserKey();
    expect(loggedText()).not.toContain(SYNTHETIC.MAPS_BROWSER_KEY);
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});

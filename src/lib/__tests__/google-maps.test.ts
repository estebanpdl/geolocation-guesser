import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadGoogleMaps,
  MAPS_CONFIG_UNAVAILABLE_MESSAGE,
  MAPS_KEY_MISSING_MESSAGE,
  resetGoogleMapsLoader,
} from '@/lib/google-maps';
import { installBrowserFetch } from '@/test/browser';
import { SYNTHETIC } from '@/test/fakes';

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetGoogleMapsLoader();
  vi.mocked(setOptions).mockClear();
  vi.mocked(importLibrary).mockClear();
});

describe('loadGoogleMaps', () => {
  it('names the key and every way to set it when the server has none', async () => {
    installBrowserFetch({ '/api/maps/config': json({ maps: { browserKey: null } }) });
    await expect(loadGoogleMaps()).rejects.toThrow(MAPS_KEY_MISSING_MESSAGE);
    expect(MAPS_KEY_MISSING_MESSAGE).toContain('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY');
    expect(MAPS_KEY_MISSING_MESSAGE).toContain('.env.local');
    expect(MAPS_KEY_MISSING_MESSAGE).toContain('npm run auth -- set maps-browser');
    expect(setOptions).not.toHaveBeenCalled();
  });

  it('uses the key served at request time, not one inlined at build time', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'synthetic-build-time-key');
    const { calls, fake } = installBrowserFetch({ '/api/maps/config': json({ maps: { browserKey: SYNTHETIC.MAPS_BROWSER_KEY } }) });

    // The test loader's importLibrary rejects, so loading fails after the key has been applied.
    await expect(loadGoogleMaps()).rejects.toThrow(/not available in tests/);
    expect(calls.map((c) => [c.method, c.path])).toEqual([['GET', '/api/maps/config']]);
    expect(fake.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    expect(vi.mocked(setOptions).mock.calls).toEqual([[{ key: SYNTHETIC.MAPS_BROWSER_KEY, v: 'weekly' }]]);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('reports an unreachable or malformed configuration and retries on the next call', async () => {
    const { calls } = installBrowserFetch({ '/api/maps/config': json({ error: 'failed' }, 500) });
    await expect(loadGoogleMaps()).rejects.toThrow(MAPS_CONFIG_UNAVAILABLE_MESSAGE);

    installBrowserFetch({ '/api/maps/config': json({ maps: {} }) });
    await expect(loadGoogleMaps()).rejects.toThrow(MAPS_CONFIG_UNAVAILABLE_MESSAGE);

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(loadGoogleMaps()).rejects.toThrow(MAPS_CONFIG_UNAVAILABLE_MESSAGE);
    expect(calls).toHaveLength(1);
    expect(setOptions).not.toHaveBeenCalled();
  });

  it('loads a key saved after a failed attempt without a page reload', async () => {
    installBrowserFetch({ '/api/maps/config': json({ maps: { browserKey: null } }) });
    await expect(loadGoogleMaps()).rejects.toThrow(MAPS_KEY_MISSING_MESSAGE);

    installBrowserFetch({ '/api/maps/config': json({ maps: { browserKey: SYNTHETIC.MAPS_BROWSER_KEY } }) });
    await expect(loadGoogleMaps()).rejects.toThrow(/not available in tests/);
    expect(vi.mocked(setOptions).mock.calls).toEqual([[{ key: SYNTHETIC.MAPS_BROWSER_KEY, v: 'weekly' }]]);
  });
});

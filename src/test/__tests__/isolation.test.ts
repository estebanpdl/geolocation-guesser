import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGoogleMaps } from '@/lib/google-maps';
import { resolveStorePath } from '@/lib/server/credential-store';
import { loadServerConfig } from '@/lib/server/server-config';
import { installBrowserFetch } from '@/test/browser';

describe('offline test isolation', () => {
  it('blocks fetch to external hosts', async () => {
    await expect(fetch('https://maps.googleapis.com/maps/api/streetview')).rejects.toThrow(/blocked in tests/);
  });

  it('blocks socket connections, including Node http clients', () => {
    expect(() => net.connect(443, 'example.com')).toThrow(/blocked in tests/);
    expect(() => http.get('http://example.com/')).toThrow(/blocked in tests/);
  });

  it('removes inherited credentials and training settings', async () => {
    for (const name of [
      'GOOGLE_GENERATIVE_AI_KEY',
      'GOOGLE_MAPS_API_KEY',
      'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
      'OPENAI_API_KEY',
      'TRAINING_MODE',
      'TRAINING_ACCESS_CODE',
    ]) {
      expect(process.env[name]).toBeUndefined();
    }
    const config = await loadServerConfig();
    expect(config.credentials).toEqual({});
    expect(config.training.mode).toBe('off');
  });

  it('resolves the default credential store inside test scratch', () => {
    const storePath = resolveStorePath();
    expect(path.resolve(storePath).startsWith(path.resolve(os.tmpdir()))).toBe(true);
  });

  it('never loads the Google Maps script', async () => {
    installBrowserFetch({
      '/api/maps/config': () => new Response(JSON.stringify({ maps: { browserKey: 'synthetic-browser-key' } })),
    });
    await expect(loadGoogleMaps()).rejects.toThrow(/not available in tests/);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });
});

// @vitest-environment node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emptyStore, readStore, resolveStorePath, writeStore, type StoreData } from '../credential-store';
import {
  describeServerConfig,
  generateAccessCode,
  loadServerConfig,
  normalizeAccessCode,
  resolveServerConfig,
} from '../server-config';
import { makeScratchDir, rewriteStore, SYNTHETIC, useSyntheticStore } from '@/test/fakes';

function store(data: Partial<StoreData> = {}, status: 'ok' | 'missing' | 'invalid' = 'ok') {
  return { status, path: '/scratch/credentials.json', data: { ...emptyStore(), ...data } };
}

describe('resolveStorePath', () => {
  it('uses .geolocation-guesser in the home directory on Windows', () => {
    expect(resolveStorePath({ USERPROFILE: 'C:\\Users\\op' }, 'win32')).toBe(
      'C:\\Users\\op\\.geolocation-guesser\\credentials.json'
    );
    expect(
      resolveStorePath({ USERPROFILE: 'C:\\Users\\op', LOCALAPPDATA: 'C:\\Users\\op\\AppData\\Local' }, 'win32')
    ).toBe('C:\\Users\\op\\.geolocation-guesser\\credentials.json');
  });

  it('uses .geolocation-guesser in the home directory elsewhere', () => {
    expect(resolveStorePath({ HOME: '/home/op' }, 'linux')).toBe('/home/op/.geolocation-guesser/credentials.json');
    expect(resolveStorePath({ HOME: '/Users/op', XDG_CONFIG_HOME: '/srv/config' }, 'darwin')).toBe(
      '/Users/op/.geolocation-guesser/credentials.json'
    );
  });

  it('defaults to the current home directory', () => {
    // Test setup points HOME and USERPROFILE at scratch, so this is a synthetic home.
    const home = process.platform === 'win32' ? process.env.USERPROFILE! : process.env.HOME!;
    expect(home).toContain('geolocation-guesser-tests-');
    expect(resolveStorePath()).toBe(path.join(home, '.geolocation-guesser', 'credentials.json'));
  });

  it('refuses a relative home directory', () => {
    expect(() => resolveStorePath({ HOME: 'relative/home' }, 'linux')).toThrow(/home directory/);
    expect(() => resolveStorePath({ USERPROFILE: 'Users\\op' }, 'win32')).toThrow(/home directory/);
  });

  it('accepts only an absolute override path', () => {
    expect(
      resolveStorePath({ GEOLOCATION_GUESSER_CREDENTIALS_FILE: '/etc/gg/credentials.json', HOME: '/home/op' }, 'linux')
    ).toBe('/etc/gg/credentials.json');
    expect(
      resolveStorePath({ GEOLOCATION_GUESSER_CREDENTIALS_FILE: 'D:\\gg\\credentials.json', USERPROFILE: 'C:\\Users\\op' }, 'win32')
    ).toBe('D:\\gg\\credentials.json');
    expect(() => resolveStorePath({ GEOLOCATION_GUESSER_CREDENTIALS_FILE: 'creds.json', HOME: '/home/op' }, 'linux')).toThrow(
      /absolute/
    );
    expect(() =>
      resolveStorePath({ GEOLOCATION_GUESSER_CREDENTIALS_FILE: 'gg\\creds.json', USERPROFILE: 'C:\\Users\\op' }, 'win32')
    ).toThrow(/absolute/);
  });

  it('treats a blank override as unset', () => {
    expect(resolveStorePath({ GEOLOCATION_GUESSER_CREDENTIALS_FILE: '  ', HOME: '/home/op' }, 'linux')).toBe(
      '/home/op/.geolocation-guesser/credentials.json'
    );
  });
});

describe('credential store file', () => {
  it('reads a missing store as empty', async () => {
    const dir = await makeScratchDir();
    const result = await readStore(path.join(dir, 'credentials.json'));
    expect(result.status).toBe('missing');
    expect(result.data).toEqual(emptyStore());
  });

  it.each([
    ['not json', '{'],
    ['wrong version', JSON.stringify({ version: 2, credentials: {} })],
    ['unknown field', JSON.stringify({ version: 1, credentials: { other: 'x' } })],
    ['non-string value', JSON.stringify({ version: 1, credentials: { geminiApiKey: 5 } })],
    ['multi-line value', JSON.stringify({ version: 1, credentials: { geminiApiKey: 'a\nb' } })],
    ['unknown mode', JSON.stringify({ version: 1, training: { mode: 'public' } })],
    ['non-string reset marker', JSON.stringify({ version: 1, training: { attemptsResetAt: 5 } })],
  ])('reports a %s store as invalid', async (_label, content) => {
    const storePath = await useSyntheticStore(content);
    expect((await readStore(storePath)).status).toBe('invalid');
  });

  it('writes atomically and round-trips without leaving temporary files', async () => {
    const dir = await makeScratchDir();
    const storePath = path.join(dir, 'nested', 'credentials.json');
    const data: StoreData = { version: 1, credentials: { geminiApiKey: SYNTHETIC.GEMINI_KEY }, training: { mode: 'open' } };

    await writeStore(storePath, data);
    await writeStore(storePath, { ...data, training: { mode: 'closed' } });

    expect((await readStore(storePath)).data.training.mode).toBe('closed');
    expect(await fs.readdir(path.dirname(storePath))).toEqual(['credentials.json']);
    if (process.platform !== 'win32') {
      expect((await fs.stat(storePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses to write invalid content', async () => {
    const dir = await makeScratchDir();
    const bad = { version: 1, credentials: { geminiApiKey: 'a\nb' }, training: {} } as StoreData;
    await expect(writeStore(path.join(dir, 'credentials.json'), bad)).rejects.toThrow();
  });
});

describe('resolveServerConfig precedence', () => {
  it('prefers a nonempty environment value over the store', () => {
    const config = resolveServerConfig(
      { GOOGLE_GENERATIVE_AI_KEY: 'env-gemini' },
      store({ credentials: { geminiApiKey: 'store-gemini', openaiApiKey: 'store-openai' } })
    );
    expect(config.credentials.geminiApiKey).toEqual({ value: 'env-gemini', source: 'environment' });
    expect(config.credentials.openaiApiKey).toEqual({ value: 'store-openai', source: 'store' });
  });

  it('treats blank and placeholder environment values as absent', () => {
    const config = resolveServerConfig(
      { GOOGLE_GENERATIVE_AI_KEY: '   ', GOOGLE_MAPS_API_KEY: 'your_google_maps_api_key_here' },
      store({ credentials: { geminiApiKey: 'store-gemini' } })
    );
    expect(config.credentials.geminiApiKey?.source).toBe('store');
    expect(config.credentials.mapsServerKey).toBeUndefined();
  });

  it('uses the public Maps key only as the last resort for Street View', () => {
    const fallback = resolveServerConfig({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'public' }, store());
    expect(fallback.credentials.mapsServerKey).toEqual({ value: 'public', source: 'public-environment' });

    const stored = resolveServerConfig(
      { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'public' },
      store({ credentials: { mapsServerKey: 'server' } })
    );
    expect(stored.credentials.mapsServerKey?.source).toBe('store');
  });

  it('defaults to local mode when nothing is configured', () => {
    const config = resolveServerConfig({}, store({}, 'missing'));
    expect(config.training).toMatchObject({ mode: 'off', modeSource: 'default', accessCode: null, sessionTtlMinutes: 180 });
    expect(config.problems).toEqual([]);
  });

  it('applies environment training settings over the store', () => {
    const config = resolveServerConfig(
      { TRAINING_MODE: 'Open', TRAINING_ACCESS_CODE: 'abcd-efgh-2345', TRAINING_SESSION_TTL_MINUTES: '45' },
      store({ training: { mode: 'off', accessCode: 'STOREDCODE' } })
    );
    expect(config.training).toMatchObject({
      mode: 'open',
      modeSource: 'environment',
      accessCode: { value: 'ABCDEFGH2345', source: 'environment' },
      sessionTtlMinutes: 45,
    });
  });

  it('lets a saved closed mode win over an environment mode', () => {
    for (const envMode of ['open', 'off']) {
      const config = resolveServerConfig({ TRAINING_MODE: envMode }, store({ training: { mode: 'closed' } }));
      expect(config.training).toMatchObject({ mode: 'closed', modeSource: 'store' });
    }
    const envClosed = resolveServerConfig({ TRAINING_MODE: 'closed' }, store({ training: { mode: 'open' } }));
    expect(envClosed.training).toMatchObject({ mode: 'closed', modeSource: 'environment' });
    const envOpen = resolveServerConfig({ TRAINING_MODE: 'open' }, store({ training: { mode: 'off' } }));
    expect(envOpen.training).toMatchObject({ mode: 'open', modeSource: 'environment' });
  });

  it('closes training when the mode setting or the store is invalid', () => {
    const badMode = resolveServerConfig({ TRAINING_MODE: 'public' }, store());
    expect(badMode.training).toMatchObject({ mode: 'closed', modeSource: 'fail-closed' });
    expect(badMode.problems).toContain('training_mode_invalid');

    const badStore = resolveServerConfig({}, store({ credentials: { geminiApiKey: 'ignored' } }, 'invalid'));
    expect(badStore.training).toMatchObject({ mode: 'closed', modeSource: 'fail-closed' });
    expect(badStore.credentials.geminiApiKey).toBeUndefined();
  });

  it('rejects unusable access codes and session lifetimes', () => {
    const config = resolveServerConfig(
      { TRAINING_MODE: 'open', TRAINING_ACCESS_CODE: 'ab-cd', TRAINING_SESSION_TTL_MINUTES: '2' },
      store()
    );
    expect(config.training.accessCode).toBeNull();
    expect(config.training.sessionTtlMinutes).toBe(180);
    expect(config.problems).toEqual(
      expect.arrayContaining(['training_access_code_invalid', 'training_access_code_missing', 'training_session_ttl_invalid'])
    );
  });

  it('reads trusted proxy hops from the environment, 0 to 3', () => {
    expect(resolveServerConfig({}, store()).trustedProxyHops).toBe(0);
    for (const hops of ['0', '1', '3', ' 2 ']) {
      const config = resolveServerConfig({ TRUSTED_PROXY_HOPS: hops }, store());
      expect([config.trustedProxyHops, config.problems]).toEqual([Number(hops), []]);
    }
    for (const hops of ['4', '10', '-1', '1.5', 'one']) {
      const config = resolveServerConfig({ TRUSTED_PROXY_HOPS: hops }, store());
      expect([config.trustedProxyHops, config.problems]).toEqual([0, ['trusted_proxy_hops_invalid']]);
    }
  });

  it('takes the attempt-limit reset marker from a usable store only', () => {
    const marker = '2026-10-29T10:00:00.000Z';
    expect(resolveServerConfig({}, store({ training: { attemptsResetAt: marker } })).training.attemptsResetAt).toBe(marker);
    expect(resolveServerConfig({}, store()).training.attemptsResetAt).toBeNull();
    expect(resolveServerConfig({}, store({ training: { attemptsResetAt: marker } }, 'invalid')).training.attemptsResetAt).toBeNull();
  });
});

describe('access codes', () => {
  it('normalizes case, spaces and hyphens', () => {
    expect(normalizeAccessCode(' ab cd-ef gh ')).toBe('ABCDEFGH');
  });

  it('generates distinct grouped codes without look-alike characters', () => {
    const codes = new Set(Array.from({ length: 50 }, generateAccessCode));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/);
  });
});

describe('describeServerConfig', () => {
  it('reports sources without values', () => {
    const config = resolveServerConfig(
      { GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY, TRAINING_MODE: 'open' },
      store({ credentials: { mapsServerKey: SYNTHETIC.MAPS_SERVER_KEY }, training: { accessCode: SYNTHETIC.ACCESS_CODE } })
    );
    const text = describeServerConfig(config).join('\n');
    expect(text).toContain('Gemini API key: configured (environment)');
    expect(text).toContain('Street View server key: configured (credential store)');
    expect(text).toContain('OpenAI API key: not configured');
    expect(text).toContain('Training mode: open (environment)');
    expect(text).toContain('Trusted proxy hops: 0');
    for (const secret of [SYNTHETIC.GEMINI_KEY, SYNTHETIC.MAPS_SERVER_KEY, SYNTHETIC.ACCESS_CODE, normalizeAccessCode(SYNTHETIC.ACCESS_CODE)]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('loadServerConfig', () => {
  it('picks up store changes without a restart', async () => {
    const storePath = await useSyntheticStore({ training: { mode: 'open', accessCode: 'FIRSTCODE1' } });
    expect((await loadServerConfig()).training.accessCode?.value).toBe('FIRSTCODE1');

    await rewriteStore(storePath, { training: { mode: 'closed', accessCode: 'SECONDCODE2' } });
    const updated = await loadServerConfig();
    expect(updated.training.mode).toBe('closed');
    expect(updated.training.accessCode?.value).toBe('SECONDCODE2');
  });

  it('reads the store from the home directory and writes it there', async () => {
    const home = await makeScratchDir('home-');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    const storePath = path.join(home, '.geolocation-guesser', 'credentials.json');

    const missing = await loadServerConfig();
    expect(missing.storePath).toBe(storePath);
    expect(missing.storeStatus).toBe('missing');

    await writeStore(storePath, { ...emptyStore(), training: { mode: 'closed' } });
    const saved = await loadServerConfig();
    expect(saved.storeStatus).toBe('ok');
    expect(saved.training.mode).toBe('closed');
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.dirname(storePath))).mode & 0o777).toBe(0o700);
      expect((await fs.stat(storePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('closes training when the store override path is relative', async () => {
    vi.stubEnv('GEOLOCATION_GUESSER_CREDENTIALS_FILE', 'relative/credentials.json');
    const config = await loadServerConfig();
    expect(config.storeStatus).toBe('path_error');
    expect(config.training.mode).toBe('closed');
  });
});

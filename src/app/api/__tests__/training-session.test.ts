// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from '../training/session/route';
import { resetTrainingAccessState, SESSION_COOKIE } from '@/lib/server/training-access';
import { getRequest, jsonRequest, sessionCookieFrom, SYNTHETIC } from '@/test/fakes';

function enter(code: unknown, options: Parameters<typeof jsonRequest>[2] = {}) {
  return POST(jsonRequest('/api/training/session', { code }, options));
}

async function status(cookie?: string) {
  return (await (await GET(getRequest('/api/training/session', cookie))).json()).training;
}

beforeEach(() => {
  resetTrainingAccessState();
  vi.stubEnv('TRAINING_MODE', 'open');
  vi.stubEnv('TRAINING_ACCESS_CODE', SYNTHETIC.ACCESS_CODE);
});

describe('/api/training/session', () => {
  it('issues an HttpOnly, SameSite=Strict session cookie for the right code', async () => {
    const response = await enter(SYNTHETIC.ACCESS_CODE);
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=strict/i);
    expect(setCookie).toMatch(/Max-Age=10800/);
    expect(setCookie).not.toMatch(/Secure/i);
    expect(await status(sessionCookieFrom(response))).toMatchObject({ mode: 'open', active: true });
  });

  it('marks the cookie Secure over HTTPS, including behind a TLS proxy', async () => {
    const direct = await enter(SYNTHETIC.ACCESS_CODE, { origin: 'https://training.example' });
    expect(direct.headers.get('set-cookie')).toMatch(/Secure/i);
    const proxied = await enter(SYNTHETIC.ACCESS_CODE, { headers: { 'x-forwarded-proto': 'https' } });
    expect(proxied.headers.get('set-cookie')).toMatch(/Secure/i);
  });

  it('rejects a wrong code without echoing or logging it', async () => {
    const warn = vi.spyOn(console, 'warn');
    const response = await enter('WRONG-GUESS-1234');
    const text = await response.text();
    expect(response.status).toBe(401);
    expect(JSON.parse(text).code).toBe('invalid_access_code');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(text).not.toContain('WRONG-GUESS-1234');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('WRONG-GUESS-1234');
  });

  it('answers repeated wrong codes with 429 and Retry-After', async () => {
    for (let i = 0; i < 5; i++) expect((await enter('WRONG-GUESS-1234')).status).toBe(401);
    const throttled = await enter(SYNTHETIC.ACCESS_CODE);
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('reports each training state', async () => {
    expect(await status()).toMatchObject({ mode: 'open', active: false });
    vi.stubEnv('TRAINING_MODE', 'closed');
    expect(await status()).toMatchObject({ mode: 'closed', active: false });
    expect((await enter(SYNTHETIC.ACCESS_CODE)).status).toBe(403);
    vi.stubEnv('TRAINING_MODE', 'off');
    expect(await status()).toMatchObject({ mode: 'off', active: true });
    expect((await enter(SYNTHETIC.ACCESS_CODE)).status).toBe(409);
    vi.stubEnv('TRAINING_MODE', 'open');
    vi.stubEnv('TRAINING_ACCESS_CODE', '');
    expect(await status()).toMatchObject({ mode: 'unavailable', active: false });
    expect((await enter(SYNTHETIC.ACCESS_CODE)).status).toBe(503);
  });

  it('reports status with only the mode, session state and expiry', async () => {
    const response = await GET(getRequest('/api/training/session'));
    const text = await response.text();
    expect(Object.keys(JSON.parse(text).training).sort()).toEqual(['active', 'expiresAt', 'mode']);
    expect(text).not.toContain(SYNTHETIC.ACCESS_CODE);
    expect(text.toUpperCase()).not.toContain(SYNTHETIC.ACCESS_CODE.replace(/-/g, ''));
  });

  it('ends the session and clears the cookie', async () => {
    const cookie = sessionCookieFrom(await enter(SYNTHETIC.ACCESS_CODE));
    const response = await DELETE(getRequest('/api/training/session', cookie, 'DELETE'));
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await status(cookie)).toMatchObject({ active: false });
  });
});

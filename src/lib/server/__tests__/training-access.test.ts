// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api-error';
import { emptyStore, type TrainingMode } from '../credential-store';
import { resolveServerConfig } from '../server-config';
import {
  ATTEMPT_LIMITS,
  checkTrainingAccess,
  describeTrainingAccess,
  endTrainingSession,
  resetTrainingAccessState,
  SESSION_COOKIE,
  startTrainingSession,
} from '../training-access';
import { getRequest, SYNTHETIC } from '@/test/fakes';

const T0 = 1_700_000_000_000;

/** `accessCode: null` configures no code at all. */
function config(
  mode: TrainingMode,
  accessCode: string | null = SYNTHETIC.ACCESS_CODE,
  ttl = '60',
  { hops = '0', attemptsResetAt }: { hops?: string; attemptsResetAt?: string } = {}
) {
  return resolveServerConfig(
    { TRAINING_SESSION_TTL_MINUTES: ttl, TRUSTED_PROXY_HOPS: hops },
    {
      status: 'ok',
      path: null,
      data: { ...emptyStore(), training: { mode, accessCode: accessCode ?? undefined, attemptsResetAt } },
    }
  );
}

function request(sessionId?: string, client = '203.0.113.7') {
  const req = getRequest('/api/ai-analysis', sessionId ? `${SESSION_COOKIE}=${sessionId}` : undefined);
  req.headers.set('x-forwarded-for', client);
  return req;
}

function apiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected an ApiError');
}

beforeEach(() => resetTrainingAccessState());

describe('checkTrainingAccess', () => {
  it('admits every request when training mode is off', () => {
    expect(checkTrainingAccess(request(), config('off', null))).toEqual({ mode: 'off' });
  });

  it('blocks all requests while training is closed', () => {
    const open = config('open');
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    const err = apiError(() => checkTrainingAccess(request(sessionId), config('closed'), T0));
    expect([err.status, err.code]).toEqual([403, 'training_closed']);
  });

  it('fails closed when training is open without a usable code', () => {
    expect(apiError(() => checkTrainingAccess(request(), config('open', null))).code).toBe('training_unavailable');
    expect(apiError(() => checkTrainingAccess(request(), config('open', 'short'))).code).toBe('training_unavailable');
  });

  it('requires a session cookie in open mode', () => {
    const err = apiError(() => checkTrainingAccess(request(), config('open'), T0));
    expect([err.status, err.code]).toEqual([401, 'training_session_required']);
    expect(apiError(() => checkTrainingAccess(request('x'.repeat(43)), config('open'), T0)).status).toBe(401);
  });

  it('admits a live session and rejects it after expiry', () => {
    const open = config('open');
    const { sessionId, expiresAt } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    expect(expiresAt).toBe(T0 + 60 * 60_000);
    expect(checkTrainingAccess(request(sessionId), open, expiresAt - 1)).toEqual({ mode: 'open', expiresAt });
    expect(apiError(() => checkTrainingAccess(request(sessionId), open, expiresAt)).code).toBe('training_session_required');
    // The expired session is gone even if the clock were wound back.
    expect(apiError(() => checkTrainingAccess(request(sessionId), open, T0)).code).toBe('training_session_required');
  });

  it('invalidates sessions when the access code is rotated', () => {
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0);
    const rotated = config('open', 'NEWCODE-9876');
    expect(apiError(() => checkTrainingAccess(request(sessionId), rotated, T0 + 1)).code).toBe('training_session_required');
  });

  it('places no limit on repeated or concurrent use of a session', async () => {
    const open = config('open');
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    const results = await Promise.all(
      Array.from({ length: 200 }, async () => checkTrainingAccess(request(sessionId), open, T0 + 1))
    );
    expect(results.every((r) => r.mode === 'open')).toBe(true);
  });

  it('ends a session on request', () => {
    const open = config('open');
    const { sessionId } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0);
    endTrainingSession(request(sessionId));
    expect(apiError(() => checkTrainingAccess(request(sessionId), open, T0 + 1)).code).toBe('training_session_required');
  });
});

describe('startTrainingSession', () => {
  it('accepts the code regardless of case, spaces and hyphens', () => {
    const lower = SYNTHETIC.ACCESS_CODE.toLowerCase().replace(/-/g, ' ');
    expect(startTrainingSession(request(), lower, config('open'), T0).sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    ['off', 409, 'training_off'],
    ['closed', 403, 'training_closed'],
  ] as const)('refuses code entry when mode is %s', (mode, status, code) => {
    const err = apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config(mode), T0));
    expect([err.status, err.code]).toEqual([status, code]);
  });

  it('rejects malformed code input without counting it', () => {
    for (const code of [undefined, 42, '', 'x'.repeat(257)]) {
      expect(apiError(() => startTrainingSession(request(), code, config('open'), T0)).code).toBe('invalid_access_code_format');
    }
    expect(startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0).sessionId).toBeTruthy();
  });

  it('throttles a client address after its burst of wrong codes, then allows one more per interval', () => {
    const open = config('open');
    for (let i = 0; i < ATTEMPT_LIMITS.CLIENT_BURST; i++) {
      expect(apiError(() => startTrainingSession(request(), 'WRONGCODE1', open, T0)).code).toBe('invalid_access_code');
    }
    // Even the right code is refused while throttled, so throttling bounds guesses.
    const throttled = apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0));
    expect([throttled.status, throttled.code]).toEqual([429, 'too_many_attempts']);
    expect(throttled.retryAfterSeconds).toBe(ATTEMPT_LIMITS.CLIENT_REFILL_MS / 1000);

    // Another address is unaffected.
    expect(startTrainingSession(request(undefined, '198.51.100.2'), SYNTHETIC.ACCESS_CODE, open, T0).sessionId).toBeTruthy();

    // One interval later the address gets one attempt back, and only one.
    const later = T0 + ATTEMPT_LIMITS.CLIENT_REFILL_MS;
    expect(apiError(() => startTrainingSession(request(), 'WRONGCODE1', open, later)).code).toBe('invalid_access_code');
    expect(apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, later)).code).toBe('too_many_attempts');
    expect(startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, later + ATTEMPT_LIMITS.CLIENT_REFILL_MS).sessionId).toBeTruthy();
  });

  it('lets a room behind one address absorb typos without locking everyone out', () => {
    const open = config('open', SYNTHETIC.ACCESS_CODE, '60', { hops: '1' });
    // ngrok sends the room's shared NAT address as the only X-Forwarded-For entry.
    const room = () => request(undefined, '203.0.113.50');
    // 40 participants arrive within two minutes; a third of them mistype the code first.
    for (let p = 0; p < 40; p++) {
      const at = T0 + p * 3_000;
      if (p % 3 === 0) {
        expect(apiError(() => startTrainingSession(room(), 'WRONGCODE1', open, at)).code).toBe('invalid_access_code');
      }
      expect(startTrainingSession(room(), SYNTHETIC.ACCESS_CODE, open, at + 1).sessionId).toBeTruthy();
    }
  });

  it('keys attempts on the proxy-appended address, so rotating spoofed prefixes share one budget', () => {
    const open = config('open', SYNTHETIC.ACCESS_CODE, '60', { hops: '1' });
    for (let i = 0; i < ATTEMPT_LIMITS.CLIENT_BURST; i++) {
      apiError(() => startTrainingSession(request(undefined, `192.0.2.${i}, 203.0.113.7`), 'WRONGCODE1', open, T0));
    }
    const err = apiError(() => startTrainingSession(request(undefined, '192.0.2.250, 203.0.113.7'), SYNTHETIC.ACCESS_CODE, open, T0));
    expect(err.code).toBe('too_many_attempts');
    expect(startTrainingSession(request(undefined, '192.0.2.250, 198.51.100.2'), SYNTHETIC.ACCESS_CODE, open, T0).sessionId).toBeTruthy();
  });

  it('gives one IPv6 /64 one budget, however many addresses it rotates through', () => {
    const open = config('open', SYNTHETIC.ACCESS_CODE, '60', { hops: '1' });
    for (let i = 0; i < ATTEMPT_LIMITS.CLIENT_BURST; i++) {
      apiError(() => startTrainingSession(request(undefined, `2001:db8:aa:bb::${(i + 1).toString(16)}`), 'WRONGCODE1', open, T0));
    }
    const err = apiError(() => startTrainingSession(request(undefined, '2001:db8:aa:bb:1:2:3:4'), SYNTHETIC.ACCESS_CODE, open, T0));
    expect(err.code).toBe('too_many_attempts');
    expect(startTrainingSession(request(undefined, '2001:db8:aa:bc::1'), SYNTHETIC.ACCESS_CODE, open, T0).sessionId).toBeTruthy();
  });

  it('gives each spoofed header its own budget without a trusted proxy, leaving the host bound', () => {
    const open = config('open');
    for (let i = 0; i < ATTEMPT_LIMITS.CLIENT_BURST; i++) {
      apiError(() => startTrainingSession(request(undefined, `192.0.2.${i}, 203.0.113.7`), 'WRONGCODE1', open, T0));
    }
    expect(startTrainingSession(request(undefined, '192.0.2.250, 203.0.113.7'), SYNTHETIC.ACCESS_CODE, open, T0).sessionId).toBeTruthy();
  });

  it('clears the limits when the operator unlocks, keeping sessions', () => {
    const open = config('open', SYNTHETIC.ACCESS_CODE, '60', { attemptsResetAt: '2026-10-29T10:00:00.000Z' });
    const { sessionId } = startTrainingSession(request(undefined, '198.51.100.2'), SYNTHETIC.ACCESS_CODE, open, T0);
    for (let i = 0; i < ATTEMPT_LIMITS.CLIENT_BURST; i++) apiError(() => startTrainingSession(request(), 'WRONGCODE1', open, T0));
    expect(apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0)).code).toBe('too_many_attempts');

    const unlocked = config('open', SYNTHETIC.ACCESS_CODE, '60', { attemptsResetAt: '2026-10-29T10:05:00.000Z' });
    expect(startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, unlocked, T0 + 1).sessionId).toBeTruthy();
    expect(checkTrainingAccess(request(sessionId), unlocked, T0 + 1).mode).toBe('open');
  });

  it('clears the limits when the code is rotated', () => {
    const open = config('open');
    for (let i = 0; i < ATTEMPT_LIMITS.HOST_FAILURES; i++) {
      apiError(() => startTrainingSession(request(undefined, `client-${i}`), 'WRONGCODE1', open, T0));
    }
    expect(apiError(() => startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, open, T0 + 1)).code).toBe('too_many_attempts');
    expect(startTrainingSession(request(), 'NEWCODE-9876', config('open', 'NEWCODE-9876'), T0 + 1).sessionId).toBeTruthy();
  });

  it('bounds wrong codes across all clients', () => {
    const open = config('open');
    for (let i = 0; i < ATTEMPT_LIMITS.HOST_FAILURES; i++) {
      apiError(() => startTrainingSession(request(undefined, `client-${i}`), 'WRONGCODE1', open, T0));
    }
    const err = apiError(() => startTrainingSession(request(undefined, 'fresh-client'), SYNTHETIC.ACCESS_CODE, open, T0 + 1));
    expect([err.status, err.code]).toEqual([429, 'too_many_attempts']);
    expect(startTrainingSession(request(undefined, 'fresh-client'), SYNTHETIC.ACCESS_CODE, open, T0 + ATTEMPT_LIMITS.HOST_WINDOW_MS).sessionId).toBeTruthy();
  });

  it('never logs the entered or configured code', () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    apiError(() => startTrainingSession(request(), 'WRONGCODE1', config('open'), T0));
    startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0);
    const output = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(output).not.toContain('WRONGCODE1');
    expect(output).not.toContain(SYNTHETIC.ACCESS_CODE);
  });
});

describe('describeTrainingAccess', () => {
  it('reports the state a browser needs', () => {
    expect(describeTrainingAccess(request(), config('off', null))).toEqual({ mode: 'off', active: true, expiresAt: null });
    expect(describeTrainingAccess(request(), config('closed'))).toMatchObject({ mode: 'closed', active: false });
    expect(describeTrainingAccess(request(), config('open', null))).toMatchObject({ mode: 'unavailable', active: false });
    expect(describeTrainingAccess(request(), config('open'), T0)).toMatchObject({ mode: 'open', active: false });

    const { sessionId, expiresAt } = startTrainingSession(request(), SYNTHETIC.ACCESS_CODE, config('open'), T0);
    expect(describeTrainingAccess(request(sessionId), config('open'), T0 + 1)).toEqual({ mode: 'open', active: true, expiresAt });
  });
});

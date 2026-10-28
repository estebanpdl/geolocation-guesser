// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../ai-analysis/route';
import { POST as startSession } from '../training/session/route';
import { resetTrainingAccessState } from '@/lib/server/training-access';
import {
  geminiStatus,
  geminiText,
  installFakeFetch,
  isGemini,
  isStreetView,
  jsonRequest,
  rewriteStore,
  sessionCookieFrom,
  streetViewImage,
  streetViewStatus,
  SYNTHETIC,
  useSyntheticStore,
} from '@/test/fakes';

const VIEW = { lat: 48.8566, lng: 2.3522, heading: 0, pitch: 0 };

function useServerKeys() {
  vi.stubEnv('GOOGLE_GENERATIVE_AI_KEY', SYNTHETIC.GEMINI_KEY);
  vi.stubEnv('GOOGLE_MAPS_API_KEY', SYNTHETIC.MAPS_SERVER_KEY);
}

function analyze(body: unknown = VIEW, cookie?: string) {
  return POST(jsonRequest('/api/ai-analysis', body, { cookie }));
}

async function signIn(code: string = SYNTHETIC.ACCESS_CODE): Promise<string> {
  const response = await startSession(jsonRequest('/api/training/session', { code }));
  expect(response.status).toBe(200);
  return sessionCookieFrom(response);
}

function consoleOutput(...spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies.flatMap((spy) => spy.mock.calls.flat()).map(String).join('\n');
}

beforeEach(() => resetTrainingAccessState());

describe('POST /api/ai-analysis', () => {
  it('fetches one Street View image and makes one Gemini call in local mode', async () => {
    useServerKeys();
    const { calls } = installFakeFetch(streetViewImage(), geminiText());

    const response = await analyze();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis.textAndSigns).toBe('Cyrillic shop sign.');
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
    expect(calls.filter((c) => isStreetView(c.url))).toHaveLength(1);
    expect(calls.filter((c) => isGemini(c.url))).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(SYNTHETIC.MAPS_SERVER_KEY);
    expect(JSON.stringify(body)).not.toContain(SYNTHETIC.GEMINI_KEY);
  });

  it('uses credentials from the store when the environment has none', async () => {
    await useSyntheticStore({ credentials: { geminiApiKey: SYNTHETIC.GEMINI_KEY, mapsServerKey: SYNTHETIC.MAPS_SERVER_KEY } });
    const { calls } = installFakeFetch(streetViewImage(), geminiText());

    expect((await analyze()).status).toBe(200);
    expect(calls[0].url.searchParams.get('key')).toBe(SYNTHETIC.MAPS_SERVER_KEY);
    expect(new Headers(calls[1].init?.headers).get('x-goog-api-key')).toBe(SYNTHETIC.GEMINI_KEY);
  });

  it.each([
    ['malformed JSON', '{"lat":', undefined, 400, 'invalid_json'],
    ['a JSON array', '[]', undefined, 400, 'invalid_body'],
    ['out-of-range latitude', { lat: 95, lng: 0 }, undefined, 400, 'invalid_coordinates'],
    ['string coordinates', { lat: '1', lng: '2' }, undefined, 400, 'invalid_coordinates'],
    ['an out-of-range heading', { ...VIEW, heading: 400 }, undefined, 400, 'invalid_view'],
    ['an oversized body', { ...VIEW, padding: 'x'.repeat(5000) }, undefined, 413, 'payload_too_large'],
    ['a non-JSON content type', JSON.stringify(VIEW), { 'content-type': 'text/plain' }, 415, 'unsupported_media_type'],
  ])('rejects %s without external calls', async (_label, body, headers, status, code) => {
    useServerKeys();
    const { calls } = installFakeFetch(streetViewImage(), geminiText());
    const response = await POST(jsonRequest('/api/ai-analysis', body, { headers }));
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(calls).toHaveLength(0);
  });

  it('returns 503 without external calls when keys are missing', async () => {
    const { calls } = installFakeFetch(streetViewImage(), geminiText());
    const response = await analyze();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('analysis_unconfigured');
    expect(calls).toHaveLength(0);
  });

  it('maps no imagery to 422 and skips inference', async () => {
    useServerKeys();
    const { calls } = installFakeFetch(streetViewStatus(404), geminiText());
    const response = await analyze();
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('no_imagery');
    expect(calls.filter((c) => isGemini(c.url))).toHaveLength(0);
  });

  it('sanitizes upstream failures in the response and the log', async () => {
    useServerKeys();
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    installFakeFetch(streetViewImage(), geminiStatus(500));

    const response = await analyze();
    const text = await response.text();
    const logged = consoleOutput(warn, error);

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ code: 'provider_error', error: 'The AI provider failed to respond.' });
    expect(logged).toContain('code=provider_error');
    expect(logged).toContain('upstreamStatus=500');
    for (const output of [text, logged]) {
      expect(output).not.toContain('upstream detail');
      expect(output).not.toContain(SYNTHETIC.GEMINI_KEY);
      expect(output).not.toContain(SYNTHETIC.MAPS_SERVER_KEY);
      expect(output).not.toContain('googleapis.com');
    }
  });

  describe('in training mode', () => {
    beforeEach(() => {
      useServerKeys();
      vi.stubEnv('TRAINING_MODE', 'open');
      vi.stubEnv('TRAINING_ACCESS_CODE', SYNTHETIC.ACCESS_CODE);
    });

    it('rejects requests without a session before reading the body or calling out', async () => {
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze('{not even json');
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe('training_session_required');
      expect(calls).toHaveLength(0);
    });

    it('accepts requests with a session', async () => {
      installFakeFetch(streetViewImage(), geminiText());
      const cookie = await signIn();
      expect((await analyze(VIEW, cookie)).status).toBe(200);
    });

    it('does not limit repeated or concurrent analyses in one session', async () => {
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const cookie = await signIn();
      const responses = await Promise.all(Array.from({ length: 8 }, () => analyze(VIEW, cookie)));
      const again = await analyze(VIEW, cookie);
      expect([...responses, again].map((r) => r.status)).toEqual(Array(9).fill(200));
      expect(calls.filter((c) => isGemini(c.url))).toHaveLength(9);
    });

    it('fails closed without a configured code', async () => {
      vi.stubEnv('TRAINING_ACCESS_CODE', '');
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze();
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe('training_unavailable');
      expect(calls).toHaveLength(0);
    });
  });

  describe('with training managed in the credential store', () => {
    it('applies rotation and closure to a running server', async () => {
      useServerKeys();
      const storePath = await useSyntheticStore({ training: { mode: 'open', accessCode: SYNTHETIC.ACCESS_CODE } });
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const cookie = await signIn();
      expect((await analyze(VIEW, cookie)).status).toBe(200);

      await rewriteStore(storePath, { training: { mode: 'open', accessCode: 'ROTATED-CODE-2345' } });
      const rotated = await analyze(VIEW, cookie);
      expect(rotated.status).toBe(401);

      const newCookie = await signIn('rotated-code-2345');
      expect((await analyze(VIEW, newCookie)).status).toBe(200);

      await rewriteStore(storePath, { training: { mode: 'closed', accessCode: 'ROTATED-CODE-2345' } });
      const closed = await analyze(VIEW, newCookie);
      expect(closed.status).toBe(403);
      expect((await closed.json()).code).toBe('training_closed');
      expect(calls.filter((c) => isGemini(c.url))).toHaveLength(2);
    });

    it('closes training when the store cannot be parsed', async () => {
      useServerKeys();
      await useSyntheticStore('{ not valid json');
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze();
      expect(response.status).toBe(403);
      expect(calls).toHaveLength(0);
    });
  });
});

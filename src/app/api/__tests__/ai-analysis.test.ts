// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../ai-analysis/route';
import { POST as startSession } from '../training/session/route';
import { parseAnalysisResponse } from '@/lib/analysis/contract';
import { resetTrainingAccessState } from '@/lib/server/training-access';
import {
  geminiKeyInvalid,
  geminiKeyOf,
  geminiStatus,
  geminiText,
  installFakeFetch,
  isGemini,
  isStreetView,
  jsonRequest,
  openaiText,
  rewriteStore,
  SAMPLE_ANALYSIS,
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
    expect(body.analysis).toEqual(SAMPLE_ANALYSIS);
    expect(body.selection).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(body.credentialSource).toBe('operator');
    expect(body).not.toHaveProperty('rawResponse');
    expect(parseAnalysisResponse(body)).not.toBeNull();
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

  it.each([
    ['output that is not JSON', geminiText('**Text & Signs**: sign'), 502, 'invalid_output'],
    ['output missing a field', geminiText(JSON.stringify({ ...SAMPLE_ANALYSIS, overallAssessment: undefined })), 502, 'invalid_output'],
    ['truncated output', geminiText('{"textAndSigns": "Cyr', 'MAX_TOKENS'), 502, 'output_truncated'],
    ['a refusal', geminiText('', 'SAFETY'), 422, 'analysis_refused'],
  ])('reports %s as an error, never a placeholder analysis', async (_label, route, status, code) => {
    useServerKeys();
    const { calls } = installFakeFetch(streetViewImage(), route);
    const response = await analyze();
    const body = await response.json();
    expect([response.status, body.code]).toEqual([status, code]);
    expect(body).not.toHaveProperty('analysis');
    expect(calls.filter((c) => isGemini(c.url))).toHaveLength(1);
  });

  describe('model selection', () => {
    it('accepts the default entry by ID', async () => {
      useServerKeys();
      installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze({ ...VIEW, selection: { provider: 'gemini', model: 'gemini-3.5-flash-lite' } });
      expect(response.status).toBe(200);
    });

    it.each([
      ['an unknown model', { provider: 'gemini', model: 'gemini-ultra-unlisted' }, 400, 'unknown_model'],
      ['an upstream model name', { provider: 'gemini', model: 'gemini-flash-latest' }, 400, 'unknown_model'],
      ['an unknown provider', { provider: 'mistral', model: 'gemini-3.5-flash-lite' }, 400, 'unknown_provider'],
      ['a malformed selection', 'gemini-3.5-flash-lite', 400, 'invalid_selection'],
      ['a mismatched pair', { provider: 'openai', model: 'gemini-3.5-flash-lite' }, 400, 'selection_mismatch'],
      ['OpenAI, which may not receive Street View imagery', { provider: 'openai', model: 'gpt-6-luna' }, 403, 'street_view_not_permitted'],
    ])('rejects %s before fetching the Street View image', async (_label, selection, status, code) => {
      useServerKeys();
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze({ ...VIEW, selection });
      expect([response.status, (await response.json()).code]).toEqual([status, code]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('participant keys', () => {
    const participant = (apiKey: string, provider = 'gemini') => ({
      ...VIEW,
      selection: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
      participantKey: { provider, apiKey },
    });

    it('enable analysis when the server has no inference key, with the server key for the image', async () => {
      vi.stubEnv('GOOGLE_MAPS_API_KEY', SYNTHETIC.MAPS_SERVER_KEY);
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze(participant(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A));
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(JSON.parse(text).credentialSource).toBe('participant');
      expect(calls[0].url.searchParams.get('key')).toBe(SYNTHETIC.MAPS_SERVER_KEY);
      expect(geminiKeyOf(calls[1])).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
      expect(text).not.toContain(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    });

    it('take precedence over the server key', async () => {
      useServerKeys();
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      expect((await analyze(participant(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A))).status).toBe(200);
      expect(geminiKeyOf(calls[1])).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    });

    it('report a rejected key without retrying on the server key, logging or echoing it', async () => {
      useServerKeys();
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      const { calls } = installFakeFetch(streetViewImage(), geminiKeyInvalid());

      const response = await analyze(participant(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A));
      const text = await response.text();
      const logged = consoleOutput(warn, error);

      expect([response.status, JSON.parse(text).code]).toEqual([401, 'participant_key_rejected']);
      const geminiCalls = calls.filter((c) => isGemini(c.url));
      expect(geminiCalls).toHaveLength(1);
      expect(geminiKeyOf(geminiCalls[0])).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
      expect(logged).toContain('code=participant_key_rejected');
      for (const output of [text, logged]) {
        expect(output).not.toContain(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
        expect(output).not.toContain(SYNTHETIC.GEMINI_KEY);
      }
    });

    it.each([
      ['a malformed key', participant('two words'), 'invalid_participant_key'],
      ['a key for another provider', participant(SYNTHETIC.PARTICIPANT_OPENAI_KEY, 'openai'), 'participant_key_mismatch'],
    ])('reject %s before fetching the Street View image', async (_label, body, code) => {
      useServerKeys();
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze(body);
      const text = await response.text();
      expect([response.status, JSON.parse(text).code]).toEqual([400, code]);
      expect(text).not.toContain(SYNTHETIC.PARTICIPANT_OPENAI_KEY);
      expect(calls).toHaveLength(0);
    });

    it('do not unlock Street View analysis for a provider not permitted to receive it', async () => {
      useServerKeys();
      const { calls } = installFakeFetch(streetViewImage(), openaiText());
      const response = await analyze({
        ...VIEW,
        selection: { provider: 'openai', model: 'gpt-6-luna' },
        participantKey: { provider: 'openai', apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY },
      });
      const text = await response.text();
      expect([response.status, JSON.parse(text).code]).toEqual([403, 'street_view_not_permitted']);
      expect(text).not.toContain(SYNTHETIC.PARTICIPANT_OPENAI_KEY);
      expect(calls).toHaveLength(0);
    });

    it('fall back to the server key only when blank', async () => {
      useServerKeys();
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze(participant('   '));
      expect((await response.json()).credentialSource).toBe('operator');
      expect(geminiKeyOf(calls[1])).toBe(SYNTHETIC.GEMINI_KEY);
    });

    it('stay with their own request when requests interleave', async () => {
      useServerKeys();
      // Gemini replies in reverse arrival order and tags each reply with the key it saw.
      const tags: Record<string, string> = {
        [SYNTHETIC.PARTICIPANT_GEMINI_KEY_A]: 'A',
        [SYNTHETIC.PARTICIPANT_GEMINI_KEY_B]: 'B',
        [SYNTHETIC.GEMINI_KEY]: 'operator',
      };
      let arrivals = 0;
      const { calls } = installFakeFetch(streetViewImage(), async (url, init) => {
        if (!isGemini(url)) return undefined;
        const key = new Headers(init?.headers).get('x-goog-api-key') ?? '';
        await new Promise((r) => setTimeout(r, 30 - 10 * arrivals++));
        const text = JSON.stringify({ ...SAMPLE_ANALYSIS, overallAssessment: tags[key] ?? 'unknown' });
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] });
      });

      const responses = await Promise.all([
        analyze(participant(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A)),
        analyze(VIEW),
        analyze(participant(SYNTHETIC.PARTICIPANT_GEMINI_KEY_B)),
      ]);
      const texts = await Promise.all(responses.map((r) => r.text()));
      const bodies = texts.map((t) => JSON.parse(t));

      expect(bodies.map((b) => [b.analysis.overallAssessment, b.credentialSource])).toEqual([
        ['A', 'participant'],
        ['operator', 'operator'],
        ['B', 'participant'],
      ]);
      expect(calls.filter((c) => isGemini(c.url)).map(geminiKeyOf).sort()).toEqual(
        [SYNTHETIC.PARTICIPANT_GEMINI_KEY_A, SYNTHETIC.PARTICIPANT_GEMINI_KEY_B, SYNTHETIC.GEMINI_KEY].sort()
      );
      for (const text of texts) expect(text).not.toMatch(/synthetic-/);
    });
  });

  describe('in training mode', () => {
    beforeEach(() => {
      useServerKeys();
      vi.stubEnv('TRAINING_MODE', 'open');
      vi.stubEnv('TRAINING_ACCESS_CODE', SYNTHETIC.ACCESS_CODE);
    });

    it('requires a session for participant-key requests too', async () => {
      const { calls } = installFakeFetch(streetViewImage(), geminiText());
      const response = await analyze({
        ...VIEW,
        participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A },
      });
      expect([response.status, (await response.json()).code]).toEqual([401, 'training_session_required']);
      expect(calls).toHaveLength(0);
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

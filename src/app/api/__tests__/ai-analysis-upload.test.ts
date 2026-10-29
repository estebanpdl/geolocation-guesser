// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../ai-analysis-upload/route';
import { parseAnalysisResponse } from '@/lib/analysis/contract';
import { resetTrainingAccessState } from '@/lib/server/training-access';
import {
  geminiBlocked,
  geminiKeyOf,
  geminiStatus,
  geminiText,
  installFakeFetch,
  isGemini,
  isOpenAI,
  jsonRequest,
  openaiKeyOf,
  openaiRefusal,
  openaiStatus,
  openaiText,
  SYNTHETIC,
  syntheticJpeg,
  syntheticPng,
  syntheticWebp,
  toBase64,
} from '@/test/fakes';

function upload(body: unknown) {
  return POST(jsonRequest('/api/ai-analysis-upload', body));
}

function photo() {
  return { image: toBase64(syntheticJpeg()), mimeType: 'image/jpeg' };
}

beforeEach(() => {
  resetTrainingAccessState();
  vi.stubEnv('GOOGLE_GENERATIVE_AI_KEY', SYNTHETIC.GEMINI_KEY);
});

describe('POST /api/ai-analysis-upload', () => {
  it.each([
    ['image/jpeg', syntheticJpeg()],
    ['image/png', syntheticPng()],
    ['image/webp', syntheticWebp()],
  ] as const)('sends a valid %s photo in one Gemini call and no Maps request', async (mimeType, bytes) => {
    const { calls } = installFakeFetch(geminiText());
    const response = await upload({ image: toBase64(bytes), mimeType });
    expect(response.status).toBe(200);
    expect((await response.json()).analysis.overallAssessment).toBe('Eastern Europe, low confidence.');
    expect(calls).toHaveLength(1);
    expect(isGemini(calls[0].url)).toBe(true);
    const sent = JSON.parse(String(calls[0].init?.body)).contents[0].parts[1].inlineData;
    expect(sent).toEqual({ mimeType, data: toBase64(bytes) });
  });

  it.each([
    ['missing image', { mimeType: 'image/jpeg' }, 400, 'missing_image'],
    ['unsupported type', { image: toBase64(syntheticJpeg()), mimeType: 'image/gif' }, 415, 'unsupported_image'],
    ['non-canonical base64', { image: `${toBase64(syntheticJpeg())}\n`, mimeType: 'image/jpeg' }, 400, 'invalid_base64'],
    ['content not matching its type', { image: toBase64(syntheticPng()), mimeType: 'image/jpeg' }, 415, 'image_type_mismatch'],
    ['non-image bytes', { image: toBase64(new TextEncoder().encode('<svg onload=alert(1)>')), mimeType: 'image/png' }, 415, 'unsupported_image'],
    ['a tiny image', { image: toBase64(syntheticPng(4, 4)), mimeType: 'image/png' }, 400, 'image_dimensions_out_of_range'],
  ])('rejects %s without external calls', async (_label, body, status, code) => {
    const { calls } = installFakeFetch(geminiText());
    const response = await upload(body);
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(calls).toHaveLength(0);
  });

  it('rejects a body over the size limit before parsing it', async () => {
    const { calls } = installFakeFetch(geminiText());
    const response = await POST(
      jsonRequest('/api/ai-analysis-upload', '{}', { headers: { 'content-length': String(15 * 1024 * 1024) } })
    );
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('reports a refusal from the provider', async () => {
    installFakeFetch(geminiBlocked());
    const response = await upload({ image: toBase64(syntheticJpeg()), mimeType: 'image/jpeg' });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('analysis_refused');
  });

  it('checks training access before reading the photo', async () => {
    vi.stubEnv('TRAINING_MODE', 'open');
    vi.stubEnv('TRAINING_ACCESS_CODE', SYNTHETIC.ACCESS_CODE);
    const { calls } = installFakeFetch(geminiText());
    const response = await POST(
      jsonRequest('/api/ai-analysis-upload', '{}', { headers: { 'content-length': String(15 * 1024 * 1024) } })
    );
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('returns the shared response shape without the raw model text', async () => {
    installFakeFetch(geminiText());
    const body = await (await upload(photo())).json();
    expect(body).toMatchObject({ selection: { provider: 'gemini', model: 'gemini-3.5-flash-lite' }, credentialSource: 'operator' });
    expect(body).not.toHaveProperty('rawResponse');
    expect(parseAnalysisResponse(body)).not.toBeNull();
  });

  it('reports malformed output as an error', async () => {
    installFakeFetch(geminiText('not json at all'));
    const response = await upload(photo());
    expect([response.status, (await response.json()).code]).toEqual([502, 'invalid_output']);
  });

  it.each([
    ['an unknown model', { selection: { provider: 'gemini', model: 'stale-entry' } }, 400, 'unknown_model'],
    ['a mismatched pair', { selection: { provider: 'openai', model: 'gemini-3.5-flash-lite' } }, 400, 'selection_mismatch'],
    ['a malformed key', { participantKey: { provider: 'gemini', apiKey: 'a b' } }, 400, 'invalid_participant_key'],
    ['a mismatched key', { participantKey: { provider: 'openai', apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY } }, 400, 'participant_key_mismatch'],
  ])('rejects %s without external calls', async (_label, extra, status, code) => {
    const { calls } = installFakeFetch(geminiText());
    const response = await upload({ ...photo(), ...extra });
    expect([response.status, (await response.json()).code]).toEqual([status, code]);
    expect(calls).toHaveLength(0);
  });

  it('uses a participant key without a server key, and does not fall back when it is rejected', async () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_KEY', '');
    const withKey = { ...photo(), participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } };

    const ok = installFakeFetch(geminiText());
    const accepted = await upload(withKey);
    expect([accepted.status, (await accepted.json()).credentialSource]).toEqual([200, 'participant']);
    expect(geminiKeyOf(ok.calls[0])).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);

    vi.stubEnv('GOOGLE_GENERATIVE_AI_KEY', SYNTHETIC.GEMINI_KEY);
    const rejected = installFakeFetch(geminiStatus(403));
    const response = await upload(withKey);
    const text = await response.text();
    expect([response.status, JSON.parse(text).code]).toEqual([401, 'participant_key_rejected']);
    expect(rejected.calls.map(geminiKeyOf)).toEqual([SYNTHETIC.PARTICIPANT_GEMINI_KEY_A]);
    expect(text).not.toContain(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
  });

  describe('with OpenAI selected', () => {
    const openai = { selection: { provider: 'openai', model: 'gpt-6-luna' } };

    it('sends the photo in one OpenAI call with the server key and no other request', async () => {
      vi.stubEnv('OPENAI_API_KEY', SYNTHETIC.OPENAI_KEY);
      const bytes = syntheticWebp();
      const { calls } = installFakeFetch(openaiText());
      const response = await upload({ image: toBase64(bytes), mimeType: 'image/webp', ...openai });
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ selection: openai.selection, credentialSource: 'operator' });
      expect(parseAnalysisResponse(JSON.parse(text))).not.toBeNull();
      expect(calls).toHaveLength(1);
      expect(isOpenAI(calls[0].url)).toBe(true);
      expect(openaiKeyOf(calls[0])).toBe(SYNTHETIC.OPENAI_KEY);
      const [, imagePart] = JSON.parse(String(calls[0].init?.body)).input[0].content;
      expect(imagePart.image_url).toBe(`data:image/webp;base64,${toBase64(bytes)}`);
      expect(text).not.toContain(SYNTHETIC.OPENAI_KEY);
    });

    it('is unconfigured without a server key or participant key, and calls nothing', async () => {
      const { calls } = installFakeFetch(openaiText());
      const response = await upload({ ...photo(), ...openai });
      expect([response.status, (await response.json()).code]).toEqual([503, 'analysis_unconfigured']);
      expect(calls).toHaveLength(0);
    });

    it('uses a participant key and does not fall back to the server key when it is rejected', async () => {
      vi.stubEnv('OPENAI_API_KEY', SYNTHETIC.OPENAI_KEY);
      const { calls } = installFakeFetch(openaiStatus(401, 'invalid_api_key'));
      const response = await upload({
        ...photo(),
        ...openai,
        participantKey: { provider: 'openai', apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY },
      });
      const text = await response.text();
      expect([response.status, JSON.parse(text).code]).toEqual([401, 'participant_key_rejected']);
      expect(calls.map(openaiKeyOf)).toEqual([SYNTHETIC.PARTICIPANT_OPENAI_KEY]);
      expect(text).not.toContain(SYNTHETIC.PARTICIPANT_OPENAI_KEY);
    });

    it.each([
      ['a quota error', openaiStatus(429, 'credit_balance_exhausted'), 429, 'provider_quota'],
      ['a server error', openaiStatus(500), 502, 'provider_error'],
      ['a refusal', openaiRefusal(), 422, 'analysis_refused'],
      ['output that is not the contract', openaiText('{"textAndSigns": "only one field"}'), 502, 'invalid_output'],
    ])('reports %s after exactly one call', async (_label, route, status, code) => {
      vi.stubEnv('OPENAI_API_KEY', SYNTHETIC.OPENAI_KEY);
      const { calls } = installFakeFetch(route);
      const response = await upload({ ...photo(), ...openai });
      const text = await response.text();
      expect([response.status, JSON.parse(text).code]).toEqual([status, code]);
      expect(text).not.toContain('upstream detail');
      expect(calls).toHaveLength(1);
    });
  });

  it('blocks photo analysis while training is closed', async () => {
    vi.stubEnv('TRAINING_MODE', 'closed');
    const { calls } = installFakeFetch(geminiText());
    const response = await upload({ image: toBase64(syntheticJpeg()), mimeType: 'image/jpeg' });
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

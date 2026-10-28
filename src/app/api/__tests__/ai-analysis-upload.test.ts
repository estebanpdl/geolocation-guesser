// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../ai-analysis-upload/route';
import { resetTrainingAccessState } from '@/lib/server/training-access';
import {
  geminiBlocked,
  geminiText,
  installFakeFetch,
  isGemini,
  jsonRequest,
  SYNTHETIC,
  syntheticJpeg,
  syntheticPng,
  syntheticWebp,
  toBase64,
} from '@/test/fakes';

function upload(body: unknown) {
  return POST(jsonRequest('/api/ai-analysis-upload', body));
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

  it('blocks photo analysis while training is closed', async () => {
    vi.stubEnv('TRAINING_MODE', 'closed');
    const { calls } = installFakeFetch(geminiText());
    const response = await upload({ image: toBase64(syntheticJpeg()), mimeType: 'image/jpeg' });
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

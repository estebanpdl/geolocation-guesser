// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeImage, GEMINI_MODEL, parseAnalysis } from '../gemini';
import { ApiError } from '@/lib/server/api-error';
import {
  geminiBlocked,
  geminiStatus,
  geminiText,
  installFakeFetch,
  SAMPLE_ANALYSIS_TEXT,
  SYNTHETIC,
  syntheticJpeg,
} from '@/test/fakes';

const image = { bytes: syntheticJpeg(), mimeType: 'image/jpeg' };
const options = () => ({ apiKey: SYNTHETIC.GEMINI_KEY, signal: new AbortController().signal });

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('parseAnalysis', () => {
  it('splits the response into the seven sections', () => {
    const result = parseAnalysis(SAMPLE_ANALYSIS_TEXT);
    expect(result.textAndSigns).toBe('Cyrillic shop sign.');
    expect(result.roadAndInfrastructure).toBe('Right-hand traffic.');
    expect(result.overallAssessment).toBe('Eastern Europe, low confidence.');
  });

  it('marks sections missing from the response', () => {
    expect(parseAnalysis('unstructured reply').textAndSigns).toBe('No analysis available');
  });
});

describe('analyzeImage', () => {
  it('makes one request with the key in a header and a bounded output', async () => {
    const { calls } = installFakeFetch(geminiText());
    const result = await analyzeImage(image, options());

    expect(result.culturalIndicators).toBe('No clear indicators.');
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url.pathname).toContain(`models/${GEMINI_MODEL}:generateContent`);
    expect(url.search).not.toContain(SYNTHETIC.GEMINI_KEY);
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(SYNTHETIC.GEMINI_KEY);

    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from(image.bytes).toString('base64'),
    });
  });

  it.each([
    [429, 429, 'provider_quota'],
    [400, 502, 'provider_rejected'],
    [403, 502, 'provider_rejected'],
    [500, 502, 'provider_error'],
    [503, 502, 'provider_error'],
  ])('maps upstream %i to %i %s without retrying', async (upstream, status, code) => {
    const { calls } = installFakeFetch(geminiStatus(upstream));
    const err = await failure(analyzeImage(image, options()));
    expect([err.status, err.code, err.upstreamStatus]).toEqual([status, code, upstream]);
    expect(err.message).not.toContain('upstream detail');
    expect(calls).toHaveLength(1);
  });

  it('reports a safety block as a refusal', async () => {
    installFakeFetch(geminiBlocked());
    const err = await failure(analyzeImage(image, options()));
    expect([err.status, err.code]).toEqual([422, 'analysis_refused']);
  });

  it('rejects empty and oversized output', async () => {
    installFakeFetch(geminiText('   '));
    expect((await failure(analyzeImage(image, options()))).code).toBe('empty_output');

    installFakeFetch(geminiText('x'.repeat(50_001)));
    expect((await failure(analyzeImage(image, options()))).code).toBe('output_too_large');
  });

  it('makes no request when the deadline has already passed', async () => {
    const { calls } = installFakeFetch(geminiText());
    const controller = new AbortController();
    controller.abort(new ApiError(504, 'deadline_exceeded', 'stopped'));
    const err = await failure(analyzeImage(image, { apiKey: SYNTHETIC.GEMINI_KEY, signal: controller.signal }));
    expect(err.code).toBe('deadline_exceeded');
    expect(calls).toHaveLength(0);
  });

  it('turns an abort during the request into the deadline error', async () => {
    const controller = new AbortController();
    installFakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          controller.abort(new ApiError(504, 'deadline_exceeded', 'stopped'));
        })
    );
    const err = await failure(analyzeImage(image, { apiKey: SYNTHETIC.GEMINI_KEY, signal: controller.signal }));
    expect([err.status, err.code]).toEqual([504, 'deadline_exceeded']);
  });
});

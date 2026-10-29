// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from '../analysis-prompt';
import { ApiError } from '../api-error';
import { validateImageBytes } from '../image';
import { geminiAdapter } from '../providers/gemini';
import type { GenerationRequest } from '../providers/types';
import {
  geminiBlocked,
  geminiKeyOf,
  geminiStatus,
  geminiText,
  installFakeFetch,
  SAMPLE_ANALYSIS_JSON,
  SYNTHETIC,
  syntheticJpeg,
} from '@/test/fakes';

const image = validateImageBytes(syntheticJpeg(), 'image/jpeg');

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model: 'synthetic-gemini-model',
    image,
    prompt: ANALYSIS_PROMPT,
    schema: ANALYSIS_SCHEMA,
    maxOutputTokens: 8192,
    apiKey: SYNTHETIC.GEMINI_KEY,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('geminiAdapter', () => {
  it('makes one JSON-mode request with the key in a header, the given model and bounded output', async () => {
    const { calls } = installFakeFetch(geminiText());
    await expect(geminiAdapter.generate(request())).resolves.toEqual({ status: 'complete', text: SAMPLE_ANALYSIS_JSON });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url.pathname).toContain('models/synthetic-gemini-model:generateContent');
    expect(call.url.search).not.toContain(SYNTHETIC.GEMINI_KEY);
    expect(geminiKeyOf(call)).toBe(SYNTHETIC.GEMINI_KEY);

    const body = JSON.parse(String(call.init?.body));
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required).toEqual(ANALYSIS_SCHEMA.required);
    expect(body.generationConfig.responseSchema).not.toHaveProperty('additionalProperties');
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from(image.bytes).toString('base64'),
    });
  });

  it('uses only the key of each call when calls interleave', async () => {
    const { calls } = installFakeFetch(geminiText());
    await Promise.all([
      geminiAdapter.generate(request({ apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A })),
      geminiAdapter.generate(request({ apiKey: SYNTHETIC.GEMINI_KEY })),
      geminiAdapter.generate(request({ apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_B })),
    ]);
    expect(calls.map(geminiKeyOf)).toEqual([
      SYNTHETIC.PARTICIPANT_GEMINI_KEY_A,
      SYNTHETIC.GEMINI_KEY,
      SYNTHETIC.PARTICIPANT_GEMINI_KEY_B,
    ]);
  });

  it.each([
    ['MAX_TOKENS', { status: 'truncated' }],
    ['SAFETY', { status: 'refused' }],
    ['RECITATION', { status: 'refused' }],
    ['PROHIBITED_CONTENT', { status: 'refused' }],
    ['IMAGE_SAFETY', { status: 'refused' }],
  ])('classifies finish reason %s', async (finishReason, expected) => {
    installFakeFetch(geminiText('{"textAndSigns": "cut off', finishReason));
    await expect(geminiAdapter.generate(request())).resolves.toEqual(expected);
  });

  it('reports a blocked prompt as a refusal', async () => {
    installFakeFetch(geminiBlocked());
    await expect(geminiAdapter.generate(request())).resolves.toEqual({ status: 'refused' });
  });

  it.each([
    [429, 429, 'provider_quota'],
    [400, 502, 'provider_rejected'],
    [401, 502, 'provider_rejected'],
    [403, 502, 'provider_rejected'],
    [500, 502, 'provider_error'],
    [503, 502, 'provider_error'],
  ])('maps upstream %i to %i %s without retrying', async (upstream, status, code) => {
    const { calls } = installFakeFetch(geminiStatus(upstream));
    const err = await failure(geminiAdapter.generate(request()));
    expect([err.status, err.code, err.upstreamStatus]).toEqual([status, code, upstream]);
    expect(err.message).not.toContain('upstream detail');
    expect(calls).toHaveLength(1);
  });

  it('makes no request when the deadline has already passed', async () => {
    const { calls } = installFakeFetch(geminiText());
    const controller = new AbortController();
    controller.abort(new ApiError(504, 'deadline_exceeded', 'stopped'));
    const err = await failure(geminiAdapter.generate(request({ signal: controller.signal })));
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
    const err = await failure(geminiAdapter.generate(request({ signal: controller.signal })));
    expect([err.status, err.code]).toEqual([504, 'deadline_exceeded']);
  });
});

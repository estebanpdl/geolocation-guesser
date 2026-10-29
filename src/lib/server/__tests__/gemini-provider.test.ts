// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from '../analysis-prompt';
import { ApiError } from '../api-error';
import { validateImageBytes } from '../image';
import { geminiAdapter } from '../providers/gemini';
import type { GenerationRequest } from '../providers/types';
import {
  geminiBlocked,
  geminiKeyInvalid,
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
  it('makes one JSON-schema request with the key in a header, the given model, the image and bounded output', async () => {
    const { calls } = installFakeFetch(geminiText());
    await expect(geminiAdapter.generate(request())).resolves.toEqual({ status: 'complete', text: SAMPLE_ANALYSIS_JSON });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url.origin).toBe('https://generativelanguage.googleapis.com');
    expect(call.url.pathname).toContain('models/synthetic-gemini-model:generateContent');
    expect(call.url.search).not.toContain(SYNTHETIC.GEMINI_KEY);
    expect(geminiKeyOf(call)).toBe(SYNTHETIC.GEMINI_KEY);

    const body = JSON.parse(String(call.init?.body));
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      type: 'object',
      required: ANALYSIS_SCHEMA.required,
      additionalProperties: false,
    });
    expect(body.generationConfig).not.toHaveProperty('responseSchema');
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].parts[0].text).toBe(ANALYSIS_PROMPT);
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from(image.bytes).toString('base64'),
    });
  });

  it('ignores SDK environment settings that would redirect the request or switch backends', async () => {
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://collector.example');
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');
    vi.stubEnv('GOOGLE_API_KEY', 'synthetic-environment-key');
    const { calls } = installFakeFetch(geminiText());
    await geminiAdapter.generate(request());
    expect(calls.map((c) => c.url.origin)).toEqual(['https://generativelanguage.googleapis.com']);
    expect(geminiKeyOf(calls[0])).toBe(SYNTHETIC.GEMINI_KEY);
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
    ['CONTINUATION', { status: 'truncated' }],
    ['SAFETY', { status: 'refused' }],
    ['RECITATION', { status: 'refused' }],
    ['PROHIBITED_CONTENT', { status: 'refused' }],
    ['IMAGE_SAFETY', { status: 'refused' }],
    ['IMAGE_PROHIBITED_CONTENT', { status: 'refused' }],
  ])('classifies finish reason %s after exactly one request', async (finishReason, expected) => {
    const { calls } = installFakeFetch(geminiText('{"textAndSigns": "cut off', finishReason));
    await expect(geminiAdapter.generate(request())).resolves.toEqual(expected);
    expect(calls).toHaveLength(1);
  });

  it('treats an unknown finish reason as a provider failure', async () => {
    installFakeFetch(geminiText(SAMPLE_ANALYSIS_JSON, 'MALFORMED_FUNCTION_CALL'));
    expect((await failure(geminiAdapter.generate(request()))).code).toBe('provider_error');
  });

  it('reports a blocked prompt as a refusal', async () => {
    installFakeFetch(geminiBlocked());
    await expect(geminiAdapter.generate(request())).resolves.toEqual({ status: 'refused' });
  });

  it('drops thought parts from the answer', async () => {
    installFakeFetch(() =>
      Response.json({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'thinking about it', thought: true }, { text: SAMPLE_ANALYSIS_JSON }] },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      })
    );
    await expect(geminiAdapter.generate(request())).resolves.toEqual({ status: 'complete', text: SAMPLE_ANALYSIS_JSON });
  });

  it.each([
    ['429', geminiStatus(429), 429, 'provider_quota', 429],
    ['400 with API_KEY_INVALID', geminiKeyInvalid(), 502, 'provider_rejected', 400],
    ['400 for another reason', geminiStatus(400), 502, 'provider_error', 400],
    ['401', geminiStatus(401), 502, 'provider_rejected', 401],
    ['403', geminiStatus(403), 502, 'provider_rejected', 403],
    ['500', geminiStatus(500), 502, 'provider_error', 500],
    ['503', geminiStatus(503), 502, 'provider_error', 503],
  ])('maps upstream %s to a safe error without retrying', async (_label, route, status, code, upstream) => {
    const { calls } = installFakeFetch(route);
    const err = await failure(geminiAdapter.generate(request()));
    expect([err.status, err.code, err.upstreamStatus]).toEqual([status, code, upstream]);
    expect(err.message).not.toContain('upstream detail');
    expect(calls).toHaveLength(1);
  });

  it('maps a network failure to a provider error without retrying', async () => {
    const { calls } = installFakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect((await failure(geminiAdapter.generate(request()))).code).toBe('provider_error');
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
    const { calls } = installFakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          controller.abort(new ApiError(504, 'deadline_exceeded', 'stopped'));
        })
    );
    const err = await failure(geminiAdapter.generate(request({ signal: controller.signal })));
    expect([err.status, err.code]).toEqual([504, 'deadline_exceeded']);
    expect(calls).toHaveLength(1);
  });
});

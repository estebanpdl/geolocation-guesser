// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from '../analysis-prompt';
import { ApiError } from '../api-error';
import { validateImageBytes } from '../image';
import { openaiAdapter } from '../providers/openai';
import type { GenerationRequest } from '../providers/types';
import {
  installFakeFetch,
  openaiIncomplete,
  openaiKeyOf,
  openaiRefusal,
  openaiResponse,
  openaiStatus,
  openaiText,
  SAMPLE_ANALYSIS_JSON,
  SYNTHETIC,
  syntheticPng,
} from '@/test/fakes';

const image = validateImageBytes(syntheticPng(), 'image/png');

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model: 'synthetic-openai-model',
    image,
    prompt: ANALYSIS_PROMPT,
    schema: ANALYSIS_SCHEMA,
    maxOutputTokens: 8192,
    reasoningEffort: 'low',
    apiKey: SYNTHETIC.OPENAI_KEY,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('openaiAdapter', () => {
  it('makes one strict JSON-schema Responses request with the image, bounded output and no stored response', async () => {
    const { calls } = installFakeFetch(openaiText());
    await expect(openaiAdapter.generate(request())).resolves.toEqual({ status: 'complete', text: SAMPLE_ANALYSIS_JSON });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(`${call.url.origin}${call.url.pathname}`).toBe('https://api.openai.com/v1/responses');
    expect(call.url.search).toBe('');
    expect(openaiKeyOf(call)).toBe(SYNTHETIC.OPENAI_KEY);

    const body = JSON.parse(String(call.init?.body));
    expect(body).toMatchObject({
      model: 'synthetic-openai-model',
      max_output_tokens: 8192,
      reasoning: { effort: 'low' },
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(body.text.format.schema).toMatchObject({
      type: 'object',
      required: ANALYSIS_SCHEMA.required,
      additionalProperties: false,
    });
    expect(body.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: ANALYSIS_PROMPT },
          { type: 'input_image', image_url: `data:image/png;base64,${Buffer.from(image.bytes).toString('base64')}`, detail: 'high' },
        ],
      },
    ]);
  });

  it('omits reasoning settings for an entry without them', async () => {
    const { calls } = installFakeFetch(openaiText());
    await openaiAdapter.generate(request({ reasoningEffort: undefined }));
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty('reasoning');
  });

  it('ignores SDK environment settings that would redirect the request or add account headers', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://collector.example/v1');
    vi.stubEnv('OPENAI_ORG_ID', 'org-synthetic-operator');
    vi.stubEnv('OPENAI_PROJECT_ID', 'proj-synthetic-operator');
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-environment-key');
    const { calls } = installFakeFetch(openaiText());
    await openaiAdapter.generate(request({ apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY }));

    expect(calls.map((c) => c.url.origin)).toEqual(['https://api.openai.com']);
    const headers = new Headers(calls[0].init?.headers);
    expect(openaiKeyOf(calls[0])).toBe(SYNTHETIC.PARTICIPANT_OPENAI_KEY);
    expect(headers.get('openai-organization')).toBeNull();
    expect(headers.get('openai-project')).toBeNull();
  });

  it('uses only the key of each call when calls interleave', async () => {
    const { calls } = installFakeFetch(openaiText());
    await Promise.all([
      openaiAdapter.generate(request({ apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY })),
      openaiAdapter.generate(request({ apiKey: SYNTHETIC.OPENAI_KEY })),
    ]);
    expect(calls.map(openaiKeyOf)).toEqual([SYNTHETIC.PARTICIPANT_OPENAI_KEY, SYNTHETIC.OPENAI_KEY]);
  });

  it('joins the message text and ignores reasoning items', async () => {
    const [first, second] = [SAMPLE_ANALYSIS_JSON.slice(0, 20), SAMPLE_ANALYSIS_JSON.slice(20)];
    installFakeFetch(() =>
      Response.json(
        openaiResponse([
          { type: 'output_text', text: first, annotations: [] },
          { type: 'output_text', text: second, annotations: [] },
        ])
      )
    );
    await expect(openaiAdapter.generate(request())).resolves.toEqual({ status: 'complete', text: SAMPLE_ANALYSIS_JSON });
  });

  it.each([
    ['a refusal part', openaiRefusal(), { status: 'refused' }],
    ['output stopped by the content filter', openaiIncomplete('content_filter'), { status: 'refused' }],
    ['output stopped at the token limit', openaiIncomplete('max_output_tokens'), { status: 'truncated' }],
  ])('classifies %s after exactly one request', async (_label, route, expected) => {
    const { calls } = installFakeFetch(route);
    await expect(openaiAdapter.generate(request())).resolves.toEqual(expected);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['failed', undefined],
    ['incomplete', 'max_messages'],
  ])('treats a %s response as a provider failure', async (status, reason) => {
    installFakeFetch(() => Response.json(openaiResponse(undefined, status, reason)));
    expect((await failure(openaiAdapter.generate(request()))).code).toBe('provider_error');
  });

  it.each([
    ['429 rate limit', openaiStatus(429, 'rate_limit_exceeded'), 429, 'provider_quota', 429],
    ['429 billing', openaiStatus(429, 'credit_balance_exhausted'), 429, 'provider_quota', 429],
    ['400', openaiStatus(400), 502, 'provider_error', 400],
    ['401', openaiStatus(401, 'invalid_api_key'), 502, 'provider_rejected', 401],
    ['403', openaiStatus(403), 502, 'provider_rejected', 403],
    ['500', openaiStatus(500), 502, 'provider_error', 500],
    ['503', openaiStatus(503), 502, 'provider_error', 503],
  ])('maps upstream %s to a safe error without retrying', async (_label, route, status, code, upstream) => {
    const { calls } = installFakeFetch(route);
    const err = await failure(openaiAdapter.generate(request()));
    expect([err.status, err.code, err.upstreamStatus]).toEqual([status, code, upstream]);
    expect(err.message).not.toContain('upstream detail');
    expect(calls).toHaveLength(1);
  });

  it('maps a network failure to a provider error without retrying', async () => {
    const { calls } = installFakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect((await failure(openaiAdapter.generate(request()))).code).toBe('provider_error');
    expect(calls).toHaveLength(1);
  });

  it('makes no request when the deadline has already passed', async () => {
    const { calls } = installFakeFetch(openaiText());
    const controller = new AbortController();
    controller.abort(new ApiError(504, 'deadline_exceeded', 'stopped'));
    const err = await failure(openaiAdapter.generate(request({ signal: controller.signal })));
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
    const err = await failure(openaiAdapter.generate(request({ signal: controller.signal })));
    expect([err.status, err.code]).toEqual([504, 'deadline_exceeded']);
    expect(calls).toHaveLength(1);
  });
});

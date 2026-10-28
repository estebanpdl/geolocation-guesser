// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '@/lib/analysis/contract';
import { parseOutput, runPhotoAnalysis, runSceneAnalysis, type AnalysisDependencies, type AnalysisOptions } from '../analysis';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from '../analysis-prompt';
import { ApiError } from '../api-error';
import { emptyStore } from '../credential-store';
import { validateImageBytes } from '../image';
import type { GenerationRequest, GenerationResult, ProviderAdapter } from '../providers/types';
import { resolveServerConfig } from '../server-config';
import { SAMPLE_ANALYSIS, SAMPLE_ANALYSIS_JSON, SYNTHETIC, syntheticJpeg, TWO_PROVIDER_CATALOG } from '@/test/fakes';

const view = { lat: 10, lng: 20, heading: 0, pitch: 0 };
const image = validateImageBytes(syntheticJpeg(), 'image/jpeg');
const complete: GenerationResult = { status: 'complete', text: SAMPLE_ANALYSIS_JSON };
const OPERATOR_ENV = { GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY, GOOGLE_MAPS_API_KEY: SYNTHETIC.MAPS_SERVER_KEY };

function config(env: Record<string, string> = OPERATOR_ENV) {
  return resolveServerConfig(env, { status: 'missing', path: null, data: emptyStore() });
}

function fakeAdapter(provider: ProviderId, generate: ProviderAdapter['generate'] = async () => complete) {
  return { provider, generate: vi.fn(generate) };
}

/** Resolves only when its signal aborts, then rejects with the abort reason. */
function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
}

function deps(overrides: Partial<AnalysisDependencies> = {}) {
  const gemini = fakeAdapter('gemini');
  const openai = fakeAdapter('openai');
  const d = {
    fetchImage: vi.fn(async () => image),
    adapters: { gemini, openai },
    catalog: TWO_PROVIDER_CATALOG,
    deadlineMs: 60_000,
    imageTimeoutMs: 10_000,
    ...overrides,
  };
  return { ...d, gemini, openai };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

function keyOf(adapter: { generate: ReturnType<typeof vi.fn> }, call = 0): string {
  return (adapter.generate.mock.calls[call][0] as GenerationRequest).apiKey;
}

afterEach(() => vi.useRealTimers());

describe('runSceneAnalysis', () => {
  it('fetches one image and makes one generation with the default entry and operator keys', async () => {
    const d = deps();
    const outcome = await runSceneAnalysis(view, {}, config(), undefined, d);

    expect(outcome).toEqual({
      analysis: SAMPLE_ANALYSIS,
      selection: { provider: 'gemini', model: 'gem-default' },
      credentialSource: 'operator',
    });
    expect(d.fetchImage).toHaveBeenCalledTimes(1);
    expect(d.fetchImage).toHaveBeenCalledWith(view, SYNTHETIC.MAPS_SERVER_KEY, expect.any(AbortSignal));
    expect(d.gemini.generate).toHaveBeenCalledTimes(1);
    expect(d.gemini.generate).toHaveBeenCalledWith({
      model: 'upstream-gem-default',
      image,
      prompt: ANALYSIS_PROMPT,
      schema: ANALYSIS_SCHEMA,
      maxOutputTokens: 1024,
      apiKey: SYNTHETIC.GEMINI_KEY,
      signal: expect.any(AbortSignal),
    });
    expect(d.openai.generate).not.toHaveBeenCalled();
  });

  it.each<[string, AnalysisOptions, number, string]>([
    ['an unknown model', { selection: { provider: 'gemini', model: 'retired' } }, 400, 'unknown_model'],
    ['a mismatched pair', { selection: { provider: 'gemini', model: 'oa-default' } }, 400, 'selection_mismatch'],
    ['a photo-only model', { selection: { provider: 'openai', model: 'oa-default' } }, 400, 'workflow_unsupported'],
    ['a malformed key', { participantKey: { provider: 'gemini', apiKey: 'has spaces in it' } }, 400, 'invalid_participant_key'],
    ['a key for another provider', { participantKey: { provider: 'openai', apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY } }, 400, 'participant_key_mismatch'],
  ])('rejects %s before any external work', async (_label, options, status, code) => {
    const d = deps();
    const err = await failure(runSceneAnalysis(view, options, config(), undefined, d));
    expect([err.status, err.code]).toEqual([status, code]);
    expect(d.fetchImage).not.toHaveBeenCalled();
    expect(d.gemini.generate).not.toHaveBeenCalled();
    expect(d.openai.generate).not.toHaveBeenCalled();
  });

  it('checks inference and image credentials before any external work', async () => {
    const d = deps();
    expect((await failure(runSceneAnalysis(view, {}, config({ GOOGLE_MAPS_API_KEY: 'x' }), undefined, d))).code).toBe('analysis_unconfigured');
    expect((await failure(runSceneAnalysis(view, {}, config({ GOOGLE_GENERATIVE_AI_KEY: 'x' }), undefined, d))).code).toBe('image_service_unconfigured');
    expect(d.fetchImage).not.toHaveBeenCalled();
    expect(d.gemini.generate).not.toHaveBeenCalled();
  });

  it('refuses a provider without an adapter', async () => {
    const d = deps({ adapters: {} });
    const err = await failure(runSceneAnalysis(view, {}, config(), undefined, d));
    expect([err.status, err.code]).toEqual([503, 'provider_unavailable']);
    expect(d.fetchImage).not.toHaveBeenCalled();
  });

  it('uses a participant key for inference while the image still uses the server key', async () => {
    const d = deps();
    const outcome = await runSceneAnalysis(
      view,
      { participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } },
      config({ GOOGLE_MAPS_API_KEY: SYNTHETIC.MAPS_SERVER_KEY }),
      undefined,
      d
    );
    expect(outcome.credentialSource).toBe('participant');
    expect(keyOf(d.gemini)).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    expect(d.fetchImage).toHaveBeenCalledWith(view, SYNTHETIC.MAPS_SERVER_KEY, expect.any(AbortSignal));
  });

  it('stops a slow image fetch at the image timeout without calling the model', async () => {
    vi.useFakeTimers();
    const d = deps({ fetchImage: vi.fn((_v, _k, signal: AbortSignal) => hangUntilAborted(signal)) });
    const result = failure(runSceneAnalysis(view, {}, config(), undefined, d));
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await result;
    expect([err.status, err.code]).toEqual([504, 'deadline_exceeded']);
    expect(d.gemini.generate).not.toHaveBeenCalled();
  });

  it('stops slow inference at the overall deadline', async () => {
    vi.useFakeTimers();
    const gemini = fakeAdapter('gemini', ({ signal }) => hangUntilAborted(signal));
    const d = deps({
      fetchImage: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5_000));
        return image;
      }),
      adapters: { gemini },
    });
    const result = failure(runSceneAnalysis(view, {}, config(), undefined, d));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).code).toBe('deadline_exceeded');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels upstream work when the client disconnects', async () => {
    const client = new AbortController();
    const d = deps({ fetchImage: vi.fn((_v, _k, signal: AbortSignal) => hangUntilAborted(signal)) });
    const result = failure(runSceneAnalysis(view, {}, config(), client.signal, d));
    client.abort();
    expect((await result).code).toBe('client_closed_request');
  });

  it('propagates upstream failures unchanged and does not retry', async () => {
    const quota = new ApiError(429, 'provider_quota', 'limited');
    const gemini = fakeAdapter('gemini', async () => Promise.reject(quota));
    const d = deps({ adapters: { gemini } });
    expect(await failure(runSceneAnalysis(view, {}, config(), undefined, d))).toBe(quota);
    expect(d.fetchImage).toHaveBeenCalledTimes(1);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });
});

describe('runPhotoAnalysis', () => {
  it('makes one generation and no image request', async () => {
    const d = deps();
    const outcome = await runPhotoAnalysis(image, {}, config({ GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY }), undefined, d);
    expect(outcome.analysis).toEqual(SAMPLE_ANALYSIS);
    expect(d.gemini.generate).toHaveBeenCalledTimes(1);
    expect(d.fetchImage).not.toHaveBeenCalled();
  });

  it('requires an effective key for the selected provider', async () => {
    const d = deps();
    const err = await failure(runPhotoAnalysis(image, {}, config({}), undefined, d));
    expect([err.status, err.code]).toEqual([503, 'analysis_unconfigured']);
    expect(err.message).toContain('Enter your own Gemini API key');
    expect(d.gemini.generate).not.toHaveBeenCalled();
  });

  it('selects a validated non-default entry', async () => {
    const d = deps();
    const outcome = await runPhotoAnalysis(image, { selection: { provider: 'gemini', model: 'gem-photo' } }, config(), undefined, d);
    expect(outcome.selection).toEqual({ provider: 'gemini', model: 'gem-photo' });
    expect((d.gemini.generate.mock.calls[0][0] as GenerationRequest).model).toBe('upstream-gem-photo');
  });
});

describe('participant keys', () => {
  const openaiSelection = { provider: 'openai', model: 'oa-default' };

  it('make a provider usable when the server has no credentials for it', async () => {
    const d = deps();
    const outcome = await runPhotoAnalysis(
      image,
      { selection: openaiSelection, participantKey: { provider: 'openai', apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY } },
      config(),
      undefined,
      d
    );
    expect(outcome).toMatchObject({ selection: openaiSelection, credentialSource: 'participant' });
    expect(keyOf(d.openai)).toBe(SYNTHETIC.PARTICIPANT_OPENAI_KEY);
    expect(d.gemini.generate).not.toHaveBeenCalled();
  });

  it('leave a missing provider unavailable without one, and do not disable the other provider', async () => {
    const d = deps();
    expect((await failure(runPhotoAnalysis(image, { selection: openaiSelection }, config(), undefined, d))).code).toBe('analysis_unconfigured');
    expect((await runPhotoAnalysis(image, {}, config(), undefined, d)).credentialSource).toBe('operator');
    expect(d.openai.generate).not.toHaveBeenCalled();
  });

  it('take precedence over operator credentials, and a blank key means operator credentials', async () => {
    const d = deps();
    await runPhotoAnalysis(image, { participantKey: { provider: 'gemini', apiKey: `  ${SYNTHETIC.PARTICIPANT_GEMINI_KEY_A} ` } }, config(), undefined, d);
    await runPhotoAnalysis(image, { participantKey: { provider: 'gemini', apiKey: '   ' } }, config(), undefined, d);
    expect([keyOf(d.gemini, 0), keyOf(d.gemini, 1)]).toEqual([SYNTHETIC.PARTICIPANT_GEMINI_KEY_A, SYNTHETIC.GEMINI_KEY]);
  });

  it('are reported as rejected without retrying on operator credentials', async () => {
    const gemini = fakeAdapter('gemini', async () => {
      throw new ApiError(502, 'provider_rejected', 'rejected', { upstreamStatus: 400 });
    });
    const d = deps({ adapters: { gemini } });
    const err = await failure(
      runPhotoAnalysis(image, { participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } }, config(), undefined, d)
    );
    expect([err.status, err.code, err.upstreamStatus]).toEqual([401, 'participant_key_rejected', 400]);
    expect(err.message).not.toContain(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
    expect(keyOf(gemini)).toBe(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
  });

  it('leave operator-credential rejections as server errors', async () => {
    const gemini = fakeAdapter('gemini', async () => {
      throw new ApiError(502, 'provider_rejected', 'rejected', { upstreamStatus: 403 });
    });
    const err = await failure(runPhotoAnalysis(image, {}, config(), undefined, deps({ adapters: { gemini } })));
    expect([err.status, err.code]).toEqual([502, 'provider_rejected']);
  });

  it.each([
    ['null', null, 'invalid_participant_key'],
    ['a string', SYNTHETIC.PARTICIPANT_GEMINI_KEY_A, 'invalid_participant_key'],
    ['a numeric key', { provider: 'gemini', apiKey: 1234 }, 'invalid_participant_key'],
    ['an oversized key', { provider: 'gemini', apiKey: 'k'.repeat(513) }, 'invalid_participant_key'],
    ['a key with a line break', { provider: 'gemini', apiKey: 'abc\nX-Other: 1' }, 'invalid_participant_key'],
    ['a key without a provider', { apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A }, 'participant_key_mismatch'],
  ])('reject %s without echoing it', async (_label, participantKey, code) => {
    const d = deps();
    const err = await failure(runPhotoAnalysis(image, { participantKey }, config(), undefined, d));
    expect([err.status, err.code]).toEqual([400, code]);
    expect(err.message).not.toContain(SYNTHETIC.PARTICIPANT_GEMINI_KEY_A);
    expect(err.message).not.toContain('abc');
    expect(d.gemini.generate).not.toHaveBeenCalled();
  });

  it('never cross between interleaved requests from different participants and the operator', async () => {
    // Each fake reply is tagged by the key it was called with and completes in
    // reverse start order, so any shared or reused credential shows up as a mismatch.
    const tags = new Map<string, string>([
      [SYNTHETIC.PARTICIPANT_GEMINI_KEY_A, 'participant A'],
      [SYNTHETIC.PARTICIPANT_GEMINI_KEY_B, 'participant B'],
      [SYNTHETIC.GEMINI_KEY, 'operator'],
      [SYNTHETIC.PARTICIPANT_OPENAI_KEY, 'participant C'],
    ]);
    let pending = 0;
    const reply: ProviderAdapter['generate'] = async ({ apiKey }) => {
      const delay = 40 - 10 * pending++;
      await new Promise((r) => setTimeout(r, delay));
      return { status: 'complete', text: JSON.stringify({ ...SAMPLE_ANALYSIS, overallAssessment: tags.get(apiKey) ?? 'unknown' }) };
    };
    const gemini = fakeAdapter('gemini', reply);
    const openai = fakeAdapter('openai', reply);
    const d = deps({ adapters: { gemini, openai } });
    const cfg = config();

    const requests: [AnalysisOptions, string, string][] = [
      [{ participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_A } }, 'participant A', 'participant'],
      [{}, 'operator', 'operator'],
      [{ participantKey: { provider: 'gemini', apiKey: SYNTHETIC.PARTICIPANT_GEMINI_KEY_B } }, 'participant B', 'participant'],
      [
        { selection: openaiSelection, participantKey: { provider: 'openai', apiKey: SYNTHETIC.PARTICIPANT_OPENAI_KEY } },
        'participant C',
        'participant',
      ],
    ];
    const outcomes = await Promise.all(requests.map(([options]) => runPhotoAnalysis(image, options, cfg, undefined, d)));

    expect(outcomes.map((o) => [o.analysis.overallAssessment, o.credentialSource])).toEqual(
      requests.map(([, tag, source]) => [tag, source])
    );
    expect(gemini.generate.mock.calls.map(([r]) => (r as GenerationRequest).apiKey)).toEqual([
      SYNTHETIC.PARTICIPANT_GEMINI_KEY_A,
      SYNTHETIC.GEMINI_KEY,
      SYNTHETIC.PARTICIPANT_GEMINI_KEY_B,
    ]);
    expect(openai.generate.mock.calls.map(([r]) => (r as GenerationRequest).apiKey)).toEqual([SYNTHETIC.PARTICIPANT_OPENAI_KEY]);
    expect(JSON.stringify(outcomes)).not.toMatch(/synthetic-/);
  });
});

describe('parseOutput', () => {
  it('returns the validated analysis', () => {
    expect(parseOutput(complete)).toEqual(SAMPLE_ANALYSIS);
  });

  it.each<[string, GenerationResult, number, string]>([
    ['a refusal', { status: 'refused' }, 422, 'analysis_refused'],
    ['truncated output', { status: 'truncated' }, 502, 'output_truncated'],
    ['empty output', { status: 'complete', text: '  ' }, 502, 'empty_output'],
    ['oversized output', { status: 'complete', text: 'x'.repeat(50_001) }, 502, 'output_too_large'],
    ['malformed JSON', { status: 'complete', text: '{"textAndSigns": "cut' }, 502, 'invalid_output'],
    ['Markdown instead of JSON', { status: 'complete', text: '**Text & Signs**: sign' }, 502, 'invalid_output'],
    ['a missing field', { status: 'complete', text: JSON.stringify({ ...SAMPLE_ANALYSIS, overallAssessment: undefined }) }, 502, 'invalid_output'],
    ['an extra field', { status: 'complete', text: JSON.stringify({ ...SAMPLE_ANALYSIS, confidence: 0.9 }) }, 502, 'invalid_output'],
  ])('rejects %s', (_label, result, status, code) => {
    let err: unknown;
    try {
      parseOutput(result);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect([(err as ApiError).status, (err as ApiError).code]).toEqual([status, code]);
  });
});

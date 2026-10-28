// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPhotoAnalysis, runSceneAnalysis, type AnalysisDependencies } from '../analysis';
import { ApiError } from '../api-error';
import { emptyStore } from '../credential-store';
import { validateImageBytes } from '../image';
import { resolveServerConfig } from '../server-config';
import { parseAnalysis } from '@/lib/gemini';
import { SAMPLE_ANALYSIS_TEXT, SYNTHETIC, syntheticJpeg } from '@/test/fakes';

const view = { lat: 10, lng: 20, heading: 0, pitch: 0 };
const image = validateImageBytes(syntheticJpeg(), 'image/jpeg');
const analysis = parseAnalysis(SAMPLE_ANALYSIS_TEXT);

function config(env: Record<string, string> = { GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY, GOOGLE_MAPS_API_KEY: SYNTHETIC.MAPS_SERVER_KEY }) {
  return resolveServerConfig(env, { status: 'missing', path: null, data: emptyStore() });
}

/** Resolves only when its signal aborts, then rejects with the abort reason. */
function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
}

function deps(overrides: Partial<AnalysisDependencies> = {}): AnalysisDependencies {
  return {
    fetchImage: vi.fn(async () => image),
    analyze: vi.fn(async () => analysis),
    deadlineMs: 60_000,
    imageTimeoutMs: 10_000,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

afterEach(() => vi.useRealTimers());

describe('runSceneAnalysis', () => {
  it('fetches one image and makes one inference call with the server keys', async () => {
    const d = deps();
    await expect(runSceneAnalysis(view, config(), undefined, d)).resolves.toBe(analysis);
    expect(d.fetchImage).toHaveBeenCalledTimes(1);
    expect(d.fetchImage).toHaveBeenCalledWith(view, SYNTHETIC.MAPS_SERVER_KEY, expect.any(AbortSignal));
    expect(d.analyze).toHaveBeenCalledTimes(1);
    expect(d.analyze).toHaveBeenCalledWith(image, { apiKey: SYNTHETIC.GEMINI_KEY, signal: expect.any(AbortSignal) });
  });

  it('checks both credentials before any external work', async () => {
    const d = deps();
    expect((await failure(runSceneAnalysis(view, config({ GOOGLE_MAPS_API_KEY: 'x' }), undefined, d))).code).toBe('analysis_unconfigured');
    expect((await failure(runSceneAnalysis(view, config({ GOOGLE_GENERATIVE_AI_KEY: 'x' }), undefined, d))).code).toBe('image_service_unconfigured');
    expect(d.fetchImage).not.toHaveBeenCalled();
    expect(d.analyze).not.toHaveBeenCalled();
  });

  it('stops a slow image fetch at the image timeout without calling the model', async () => {
    vi.useFakeTimers();
    const d = deps({ fetchImage: vi.fn((_v, _k, signal: AbortSignal) => hangUntilAborted(signal)) });
    const result = failure(runSceneAnalysis(view, config(), undefined, d));
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await result;
    expect([err.status, err.code]).toEqual([504, 'deadline_exceeded']);
    expect(d.analyze).not.toHaveBeenCalled();
  });

  it('stops slow inference at the overall deadline', async () => {
    vi.useFakeTimers();
    const d = deps({
      fetchImage: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5_000));
        return image;
      }),
      analyze: vi.fn((_image, { signal }: { signal: AbortSignal }) => hangUntilAborted(signal)),
    });
    const result = failure(runSceneAnalysis(view, config(), undefined, d));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(d.analyze).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).code).toBe('deadline_exceeded');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels upstream work when the client disconnects', async () => {
    const client = new AbortController();
    const d = deps({ fetchImage: vi.fn((_v, _k, signal: AbortSignal) => hangUntilAborted(signal)) });
    const result = failure(runSceneAnalysis(view, config(), client.signal, d));
    client.abort();
    expect((await result).code).toBe('client_closed_request');
  });

  it('propagates upstream failures unchanged and does not retry', async () => {
    const quota = new ApiError(429, 'provider_quota', 'limited');
    const d = deps({ analyze: vi.fn(async () => Promise.reject(quota)) });
    expect(await failure(runSceneAnalysis(view, config(), undefined, d))).toBe(quota);
    expect(d.fetchImage).toHaveBeenCalledTimes(1);
    expect(d.analyze).toHaveBeenCalledTimes(1);
  });
});

describe('runPhotoAnalysis', () => {
  it('makes one inference call and no image request', async () => {
    const d = deps();
    await expect(runPhotoAnalysis(image, config({ GOOGLE_GENERATIVE_AI_KEY: SYNTHETIC.GEMINI_KEY }), undefined, d)).resolves.toBe(analysis);
    expect(d.analyze).toHaveBeenCalledTimes(1);
    expect(d.fetchImage).not.toHaveBeenCalled();
  });

  it('requires the Gemini key', async () => {
    const d = deps();
    expect((await failure(runPhotoAnalysis(image, config({}), undefined, d))).status).toBe(503);
    expect(d.analyze).not.toHaveBeenCalled();
  });
});

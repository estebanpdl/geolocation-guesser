// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-error';
import { buildStreetViewUrl, fetchStreetViewImage } from '../street-view-image';
import {
  installFakeFetch,
  isStreetView,
  streetViewImage,
  streetViewStatus,
  SYNTHETIC,
  syntheticJpeg,
  syntheticPng,
} from '@/test/fakes';

const view = { lat: 48.8566, lng: 2.3522, heading: 90, pitch: 5 };
const live = () => new AbortController().signal;

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  const apiError = err as ApiError;
  expect(JSON.stringify({ message: apiError.message, code: apiError.code })).not.toContain(SYNTHETIC.MAPS_SERVER_KEY);
  return apiError;
}

describe('fetchStreetViewImage', () => {
  it('requests the fixed endpoint with bounded parameters and error codes enabled', () => {
    const url = buildStreetViewUrl(view, SYNTHETIC.MAPS_SERVER_KEY);
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/streetview');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      size: '640x640',
      location: '48.8566,2.3522',
      heading: '90',
      pitch: '5',
      radius: '50000',
      return_error_code: 'true',
      key: SYNTHETIC.MAPS_SERVER_KEY,
    });
  });

  it('returns validated image bytes from one request', async () => {
    const { calls } = installFakeFetch(streetViewImage(syntheticJpeg(640, 640)));
    const image = await fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live());
    expect(image).toMatchObject({ mimeType: 'image/jpeg', width: 640, height: 640 });
    expect(calls).toHaveLength(1);
    expect(calls[0].init).toMatchObject({ redirect: 'manual', cache: 'no-store' });
  });

  it.each([
    [404, 422, 'no_imagery'],
    [429, 429, 'provider_quota'],
    [403, 502, 'image_unavailable'],
    [500, 502, 'image_unavailable'],
  ])('maps upstream %i to %i %s', async (upstream, status, code) => {
    const { calls } = installFakeFetch(streetViewStatus(upstream));
    const err = await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()));
    expect([err.status, err.code, err.upstreamStatus]).toEqual([status, code, upstream]);
    expect(calls).toHaveLength(1);
  });

  it('rejects non-image, mismatched and oversized responses', async () => {
    installFakeFetch(streetViewImage(new TextEncoder().encode('<html>'), 'text/html'));
    expect((await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()))).code).toBe('image_unavailable');

    installFakeFetch(streetViewImage(syntheticPng(), 'image/jpeg'));
    expect((await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()))).code).toBe('image_unavailable');

    const huge = new Uint8Array(4 * 1024 * 1024 + 1);
    huge.set(syntheticJpeg().subarray(0, 64));
    installFakeFetch(streetViewImage(huge));
    expect((await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()))).code).toBe('image_unavailable');
  });

  it('follows a redirect only to an HTTPS Google image host', async () => {
    const image = syntheticJpeg();
    const { calls } = installFakeFetch(
      (url) => (isStreetView(url) ? new Response(null, { status: 302, headers: { location: 'https://lh3.googleusercontent.com/p/abc' } }) : undefined),
      (url) => (url.hostname === 'lh3.googleusercontent.com' ? new Response(image, { headers: { 'content-type': 'image/jpeg' } }) : undefined)
    );
    await expect(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live())).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    expect(calls.map((c) => c.url.hostname)).toEqual(['maps.googleapis.com', 'lh3.googleusercontent.com']);
  });

  it.each(['https://attacker.example/image.jpg', 'http://lh3.googleusercontent.com/p/abc', 'https://googleusercontent.com.attacker.example/x'])(
    'does not follow a redirect to %s',
    async (location) => {
      const { calls } = installFakeFetch(() => new Response(null, { status: 302, headers: { location } }));
      expect((await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()))).code).toBe('image_unavailable');
      expect(calls).toHaveLength(1);
    }
  );

  it('stops after the redirect limit', async () => {
    const { calls } = installFakeFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://maps.googleapis.com/maps/api/streetview?again=1' } })
    );
    expect((await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()))).code).toBe('image_unavailable');
    expect(calls).toHaveLength(3);
  });

  it('reports a network failure without details', async () => {
    installFakeFetch(() => {
      throw new TypeError(`fetch failed for https://maps.googleapis.com/?key=${SYNTHETIC.MAPS_SERVER_KEY}`);
    });
    const err = await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, live()));
    expect([err.status, err.code]).toEqual([502, 'image_unavailable']);
  });

  it('returns the abort reason when the deadline cancels the request', async () => {
    const controller = new AbortController();
    installFakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          controller.abort(new ApiError(504, 'deadline_exceeded', 'stopped'));
        })
    );
    const err = await failure(fetchStreetViewImage(view, SYNTHETIC.MAPS_SERVER_KEY, controller.signal));
    expect(err.code).toBe('deadline_exceeded');
  });
});

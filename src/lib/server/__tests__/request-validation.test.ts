// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-error';
import { readJsonObject } from '../request-body';
import { parsePhotoRequest, parseScoreRequest, parseStreetViewRequest, parseUsedLocations } from '../validation';
import { syntheticJpeg, syntheticPng, toBase64 } from '@/test/fakes';

async function rejection(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(() => null, (e: unknown) => e);
  if (!(err instanceof ApiError)) throw new Error('expected an ApiError');
  return `${err.status} ${err.code}`;
}

function thrown(fn: () => unknown): Promise<string> {
  return rejection(Promise.resolve().then(fn));
}

function request(body: BodyInit, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return new Request('http://localhost/api/test', { method: 'POST', body, headers });
}

describe('readJsonObject', () => {
  it('returns a parsed JSON object', async () => {
    await expect(readJsonObject(request('{"a":1}'), 100)).resolves.toEqual({ a: 1 });
  });

  it('requires a JSON content type', async () => {
    expect(await rejection(readJsonObject(request('{}', { 'content-type': 'text/plain' }), 100))).toBe('415 unsupported_media_type');
  });

  it('rejects a declared length above the limit before reading', async () => {
    const req = request('{}', { 'content-type': 'application/json', 'content-length': '101' });
    expect(await rejection(readJsonObject(req, 100))).toBe('413 payload_too_large');
  });

  it('stops reading a streamed body once it passes the limit', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(64).fill(0x20));
        if (pulls > 1000) controller.close();
      },
    });
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/json' },
      duplex: 'half',
    } as RequestInit);
    expect(await rejection(readJsonObject(req, 200))).toBe('413 payload_too_large');
    expect(pulls).toBeLessThan(10);
  });

  it.each([
    ['{bad json', '400 invalid_json'],
    ['', '400 invalid_json'],
    ['null', '400 invalid_body'],
    ['[1,2]', '400 invalid_body'],
    ['"text"', '400 invalid_body'],
    ['42', '400 invalid_body'],
  ])('rejects %j', async (body, expected) => {
    expect(await rejection(readJsonObject(request(body), 100))).toBe(expected);
  });
});

describe('coordinate and view validation', () => {
  it('accepts valid score coordinates', () => {
    expect(parseScoreRequest({ guess: { lat: 1, lng: 2 }, actual: { lat: -90, lng: 180 } })).toEqual({
      guess: { lat: 1, lng: 2 },
      actual: { lat: -90, lng: 180 },
    });
  });

  it.each([
    [{ guess: { lat: 1, lng: 2 } }],
    [{ guess: { lat: 1 }, actual: { lat: 1, lng: 2 } }],
    [{ guess: { lat: 91, lng: 0 }, actual: { lat: 0, lng: 0 } }],
    [{ guess: { lat: 0, lng: -180.5 }, actual: { lat: 0, lng: 0 } }],
    [{ guess: { lat: '1', lng: 0 }, actual: { lat: 0, lng: 0 } }],
    [{ guess: { lat: Infinity, lng: 0 }, actual: { lat: 0, lng: 0 } }],
    [{ guess: null, actual: { lat: 0, lng: 0 } }],
    [{ guess: [1, 2], actual: { lat: 0, lng: 0 } }],
  ])('rejects invalid score input %j', async (body) => {
    expect(await thrown(() => parseScoreRequest(body as Record<string, unknown>))).toBe('400 invalid_coordinates');
  });

  it('defaults and bounds the Street View point of view', async () => {
    expect(parseStreetViewRequest({ lat: 10, lng: 20 })).toEqual({ lat: 10, lng: 20, heading: 0, pitch: 0 });
    expect(parseStreetViewRequest({ lat: 10, lng: 20, heading: 360, pitch: -90 })).toMatchObject({ heading: 360, pitch: -90 });
    expect(await thrown(() => parseStreetViewRequest({ lat: 10, lng: 20, heading: 361 }))).toBe('400 invalid_view');
    expect(await thrown(() => parseStreetViewRequest({ lat: 10, lng: 20, pitch: 91 }))).toBe('400 invalid_view');
    expect(await thrown(() => parseStreetViewRequest({ lat: 10, lng: 20, heading: null }))).toBe('400 invalid_view');
    expect(await thrown(() => parseStreetViewRequest({ lat: 100, lng: 20 }))).toBe('400 invalid_coordinates');
  });

  it('bounds usedLocations', async () => {
    expect(parseUsedLocations({})).toEqual([]);
    expect(parseUsedLocations({ usedLocations: [{ lat: 1, lng: 1 }] })).toEqual([{ lat: 1, lng: 1 }]);
    expect(await thrown(() => parseUsedLocations({ usedLocations: 'x' }))).toBe('400 invalid_used_locations');
    expect(await thrown(() => parseUsedLocations({ usedLocations: Array(101).fill({ lat: 0, lng: 0 }) }))).toBe('400 invalid_used_locations');
    expect(await thrown(() => parseUsedLocations({ usedLocations: [{ lat: 0 }] }))).toBe('400 invalid_coordinates');
  });
});

describe('parsePhotoRequest', () => {
  it('accepts a valid photo and returns its decoded bytes', () => {
    const bytes = syntheticJpeg(1200, 800);
    expect(parsePhotoRequest({ image: toBase64(bytes), mimeType: 'image/jpeg' })).toMatchObject({
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
    });
  });

  it.each([
    [{ mimeType: 'image/jpeg' }, '400 missing_image'],
    [{ image: 123, mimeType: 'image/jpeg' }, '400 missing_image'],
    [{ image: 'AQID', mimeType: 'image/gif' }, '415 unsupported_image'],
    [{ image: 'not base64!', mimeType: 'image/jpeg' }, '400 invalid_base64'],
    [{ image: toBase64(syntheticPng()), mimeType: 'image/jpeg' }, '415 image_type_mismatch'],
    [{ image: 'A'.repeat(13_981_020), mimeType: 'image/jpeg' }, '413 image_too_large'],
  ])('rejects %#', async (body, expected) => {
    expect(await thrown(() => parsePhotoRequest(body as Record<string, unknown>))).toBe(expected);
  });
});

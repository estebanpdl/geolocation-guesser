import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-error';
import { decodeBase64Strict, detectImageType, readImageDimensions, validateImageBytes } from '../image';
import { syntheticJpeg, syntheticPng, syntheticWebp } from '@/test/fakes';

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return `${err.status} ${err.code}`;
    throw err;
  }
  throw new Error('expected an ApiError');
}

describe('decodeBase64Strict', () => {
  it('decodes canonical base64', () => {
    expect(Array.from(decodeBase64Strict('AQID') ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(decodeBase64Strict('AQI=') ?? [])).toEqual([1, 2]);
  });

  it.each(['', 'AQI', 'AQ I=', 'AQ\nID', 'AQ-_', 'A===', '=AQI', 'AQID===='])('rejects %j', (value) => {
    expect(decodeBase64Strict(value)).toBeNull();
  });
});

describe('image signatures and dimensions', () => {
  it.each([
    ['image/jpeg', syntheticJpeg(1024, 768), 1024, 768],
    ['image/png', syntheticPng(300, 200), 300, 200],
    ['image/webp', syntheticWebp(800, 600), 800, 600],
  ] as const)('reads %s headers', (type, bytes, width, height) => {
    expect(detectImageType(bytes)).toBe(type);
    expect(readImageDimensions(bytes, type)).toEqual({ width, height });
  });

  it('reads lossy and lossless WebP headers', () => {
    const lossy = syntheticWebp();
    lossy.set([0x56, 0x50, 0x38, 0x20], 12); // 'VP8 '
    lossy.set([0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01], 23); // 640 x 480
    expect(readImageDimensions(lossy, 'image/webp')).toEqual({ width: 640, height: 480 });

    const lossless = syntheticWebp();
    lossless.set([0x56, 0x50, 0x38, 0x4c], 12); // 'VP8L'
    // width-1 = 99 and height-1 = 49 packed as 14-bit fields.
    lossless.set([0x2f, 99 & 0xff, ((99 >> 8) & 0x3f) | ((49 & 0x03) << 6), (49 >> 2) & 0xff, (49 >> 10) & 0x0f], 20);
    expect(readImageDimensions(lossless, 'image/webp')).toEqual({ width: 100, height: 50 });
  });

  it('returns null for unknown or truncated data', () => {
    expect(detectImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(readImageDimensions(syntheticPng().subarray(0, 20), 'image/png')).toBeNull();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
  });
});

describe('validateImageBytes', () => {
  it('accepts a matching, in-range image', () => {
    expect(validateImageBytes(syntheticPng(640, 480), 'image/png')).toMatchObject({ mimeType: 'image/png', width: 640, height: 480 });
  });

  it('rejects content that does not match the declared type', () => {
    expect(errorCode(() => validateImageBytes(syntheticPng(), 'image/jpeg'))).toBe('415 image_type_mismatch');
    expect(errorCode(() => validateImageBytes(new Uint8Array(64), 'image/jpeg'))).toBe('415 unsupported_image');
  });

  it('rejects malformed headers, extreme dimensions and oversize data', () => {
    expect(errorCode(() => validateImageBytes(syntheticPng().subarray(0, 20), 'image/png'))).toBe('400 invalid_image');
    expect(errorCode(() => validateImageBytes(syntheticPng(8, 8), 'image/png'))).toBe('400 image_dimensions_out_of_range');
    expect(errorCode(() => validateImageBytes(syntheticPng(12_001, 100), 'image/png'))).toBe('400 image_dimensions_out_of_range');
    expect(errorCode(() => validateImageBytes(syntheticPng(10_000, 10_000), 'image/png'))).toBe('400 image_dimensions_out_of_range');
    expect(errorCode(() => validateImageBytes(syntheticPng(), 'image/png', 100))).toBe('413 image_too_large');
  });
});

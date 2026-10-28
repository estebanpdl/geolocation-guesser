import { ApiError } from './api-error';
import { PHOTO_LIMITS } from './limits';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export interface ValidatedImage {
  bytes: Uint8Array;
  mimeType: SupportedImageType;
  width: number;
  height: number;
}

export function isSupportedImageType(value: unknown): value is SupportedImageType {
  return typeof value === 'string' && (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(value);
}

/** Canonical base64 only: no whitespace, no URL-safe alphabet, correct padding. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeBase64Strict(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) return null;
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/** Identifies JPEG, PNG and WebP data by file signature, ignoring any declared type. */
export function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Reads pixel dimensions from the image header; returns null for unsupported or truncated data. */
export function readImageDimensions(
  bytes: Uint8Array,
  type: SupportedImageType
): { width: number; height: number } | null {
  switch (type) {
    case 'image/png':
      return readPngDimensions(bytes);
    case 'image/webp':
      return readWebpDimensions(bytes);
    case 'image/jpeg':
      return readJpegDimensions(bytes);
  }
}

/**
 * Checks image bytes against an expected type and the photo bounds.
 * Throws ApiError (415 for type problems, 413 for oversize, 400 for malformed data).
 */
export function validateImageBytes(
  bytes: Uint8Array,
  expectedType: SupportedImageType,
  maxBytes: number = PHOTO_LIMITS.MAX_BYTES
): ValidatedImage {
  if (bytes.length > maxBytes) {
    throw new ApiError(413, 'image_too_large', 'The image is too large.');
  }
  const detected = detectImageType(bytes);
  if (detected === null) {
    throw new ApiError(415, 'unsupported_image', 'The image must be a JPEG, PNG or WebP file.');
  }
  if (detected !== expectedType) {
    throw new ApiError(415, 'image_type_mismatch', 'The image content does not match its declared type.');
  }
  const dimensions = readImageDimensions(bytes, detected);
  if (!dimensions) {
    throw new ApiError(400, 'invalid_image', 'The image data is incomplete or malformed.');
  }
  const { width, height } = dimensions;
  if (
    width < PHOTO_LIMITS.MIN_SIDE_PX ||
    height < PHOTO_LIMITS.MIN_SIDE_PX ||
    width > PHOTO_LIMITS.MAX_SIDE_PX ||
    height > PHOTO_LIMITS.MAX_SIDE_PX ||
    width * height > PHOTO_LIMITS.MAX_PIXELS
  ) {
    throw new ApiError(400, 'image_dimensions_out_of_range', 'The image dimensions are outside the supported range.');
  }
  return { bytes, mimeType: detected, width, height };
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readPngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return nonZero(view.getUint32(16), view.getUint32(20));
}

function readWebpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    // Lossy bitstream: 3-byte frame tag, then the 9D 01 2A start code and 14-bit sizes.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return nonZero(width, height);
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + (((bytes[22] & 0xc0) >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    return { width, height };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  return null;
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    // Markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan data before a frame header
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 8 >= bytes.length) return null;
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return nonZero(width, height);
    }
    offset += 2 + length;
  }
  return null;
}

function nonZero(width: number, height: number) {
  return width > 0 && height > 0 ? { width, height } : null;
}

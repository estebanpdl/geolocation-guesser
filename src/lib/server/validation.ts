import type { Coordinate } from '@/lib/types';
import { ApiError } from './api-error';
import { decodeBase64Strict, isSupportedImageType, validateImageBytes, type ValidatedImage } from './image';
import { MAX_USED_LOCATIONS, PHOTO_LIMITS } from './limits';

export interface StreetViewRequest {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
}

const MAX_PHOTO_BASE64_LENGTH = Math.ceil(PHOTO_LIMITS.MAX_BYTES / 3) * 4;

function invalid(code: string, message: string): ApiError {
  return new ApiError(400, code, message);
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function isValidCoordinate(value: unknown): value is Coordinate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { lat, lng } = value as Record<string, unknown>;
  return isFiniteInRange(lat, -90, 90) && isFiniteInRange(lng, -180, 180);
}

export function parseCoordinate(value: unknown, field: string): Coordinate {
  if (!isValidCoordinate(value)) {
    throw invalid('invalid_coordinates', `${field} must have finite lat (-90 to 90) and lng (-180 to 180).`);
  }
  return { lat: value.lat, lng: value.lng };
}

export function parseScoreRequest(body: Record<string, unknown>): { guess: Coordinate; actual: Coordinate } {
  return {
    guess: parseCoordinate(body.guess, 'guess'),
    actual: parseCoordinate(body.actual, 'actual'),
  };
}

export function parseUsedLocations(body: Record<string, unknown>): Coordinate[] {
  const value = body.usedLocations;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalid('invalid_used_locations', 'usedLocations must be an array of coordinates.');
  }
  if (value.length > MAX_USED_LOCATIONS) {
    throw invalid('invalid_used_locations', `usedLocations accepts at most ${MAX_USED_LOCATIONS} entries.`);
  }
  return value.map((entry) => parseCoordinate(entry, 'usedLocations entry'));
}

export function parseStreetViewRequest(body: Record<string, unknown>): StreetViewRequest {
  const { lat, lng } = parseCoordinate({ lat: body.lat, lng: body.lng }, 'The location');
  const heading = body.heading === undefined ? 0 : body.heading;
  const pitch = body.pitch === undefined ? 0 : body.pitch;
  if (!isFiniteInRange(heading, 0, 360)) {
    throw invalid('invalid_view', 'heading must be a number from 0 to 360.');
  }
  if (!isFiniteInRange(pitch, -90, 90)) {
    throw invalid('invalid_view', 'pitch must be a number from -90 to 90.');
  }
  return { lat, lng, heading, pitch };
}

export function parsePhotoRequest(body: Record<string, unknown>): ValidatedImage {
  const { image, mimeType } = body;
  if (typeof image !== 'string' || image.length === 0) {
    throw invalid('missing_image', 'Missing image data.');
  }
  if (!isSupportedImageType(mimeType)) {
    throw new ApiError(415, 'unsupported_image', 'The image must be a JPEG, PNG or WebP file.');
  }
  if (image.length > MAX_PHOTO_BASE64_LENGTH) {
    throw new ApiError(413, 'image_too_large', 'The image is too large (max 10 MB).');
  }
  const bytes = decodeBase64Strict(image);
  if (!bytes) {
    throw invalid('invalid_base64', 'The image data is not valid base64.');
  }
  return validateImageBytes(bytes, mimeType);
}

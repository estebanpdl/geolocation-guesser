import { ApiError } from './api-error';
import { abortError } from './deadline';
import { isSupportedImageType, validateImageBytes, type ValidatedImage } from './image';
import { STREET_VIEW_LIMITS } from './limits';
import { readStreamBounded } from './request-body';
import type { StreetViewRequest } from './validation';

const STATIC_ENDPOINT = 'https://maps.googleapis.com/maps/api/streetview';
const REDIRECT_HOSTS = /(^|\.)(googleapis\.com|googleusercontent\.com|gstatic\.com|ggpht\.com)$/i;

function imageUnavailable(upstreamStatus?: number): ApiError {
  return new ApiError(502, 'image_unavailable', 'The Street View image could not be retrieved.', { upstreamStatus });
}

function statusError(status: number): ApiError {
  if (status === 404) {
    return new ApiError(422, 'no_imagery', 'No Street View imagery is available for this location.', { upstreamStatus: status });
  }
  if (status === 429) {
    return new ApiError(429, 'provider_quota', 'The image service is rate limited. Try again later.', { upstreamStatus: status });
  }
  return imageUnavailable(status);
}

export function buildStreetViewUrl(view: StreetViewRequest, apiKey: string): URL {
  const url = new URL(STATIC_ENDPOINT);
  url.search = new URLSearchParams({
    size: '640x640',
    location: `${view.lat},${view.lng}`,
    heading: String(view.heading),
    pitch: String(view.pitch),
    radius: '50000',
    // Missing imagery returns 404 instead of a grey placeholder image.
    return_error_code: 'true',
    key: apiKey,
  }).toString();
  return url;
}

/**
 * Fetches one Street View Static image from the fixed Google endpoint.
 * Redirects are followed only to HTTPS Google image hosts, the body is size-bounded,
 * and the bytes must be a JPEG/PNG/WebP whose signature matches the response type.
 * The request URL carries the key, so neither it nor upstream bodies appear in errors.
 */
export async function fetchStreetViewImage(
  view: StreetViewRequest,
  apiKey: string,
  signal: AbortSignal
): Promise<ValidatedImage> {
  let url = buildStreetViewUrl(view, apiKey);

  for (let redirects = 0; ; redirects++) {
    let response: Response;
    try {
      response = await fetch(url, { signal, redirect: 'manual', cache: 'no-store' });
    } catch {
      if (signal.aborted) throw abortError(signal);
      throw imageUnavailable();
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const next = redirectTarget(response.headers.get('location'), url);
      if (!next || redirects >= STREET_VIEW_LIMITS.MAX_REDIRECTS) throw imageUnavailable(response.status);
      url = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw statusError(response.status);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!isSupportedImageType(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw imageUnavailable(response.status);
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await readStreamBounded(response.body, STREET_VIEW_LIMITS.MAX_BYTES);
    } catch {
      if (signal.aborted) throw abortError(signal);
      throw imageUnavailable(response.status);
    }
    if (!bytes) throw imageUnavailable(response.status);

    try {
      return validateImageBytes(bytes, contentType, STREET_VIEW_LIMITS.MAX_BYTES);
    } catch {
      throw imageUnavailable(response.status);
    }
  }
}

function redirectTarget(location: string | null, base: URL): URL | null {
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    return null;
  }
  return next.protocol === 'https:' && REDIRECT_HOSTS.test(next.hostname) ? next : null;
}

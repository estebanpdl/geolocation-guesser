import { ApiError } from './api-error';

/**
 * Reads a JSON object body without buffering more than `maxBytes`.
 * The size bound is enforced on the raw stream, before parsing.
 */
export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new ApiError(415, 'unsupported_media_type', 'Requests must be sent as application/json.');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw tooLarge();
  }

  const bytes = await readStreamBounded(request.body, maxBytes);
  if (!bytes) throw tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid_body', 'The request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/** Reads a byte stream, returning null (and cancelling the stream) once it exceeds `maxBytes`. */
export async function readStreamBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function tooLarge() {
  return new ApiError(413, 'payload_too_large', 'The request body is too large.');
}

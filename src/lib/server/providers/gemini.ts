import { ApiError as GenAIError, FinishReason, GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { ApiError } from '../api-error';
import type { AnalysisOutputSchema } from '../analysis-prompt';
import { abortError } from '../deadline';
import type { GenerationResult, ProviderAdapter } from './types';

/** Fixed endpoint, so neither a key nor an image can be sent elsewhere through SDK environment settings. */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/';

/** `attempts` counts the first request; 1 means no retries. */
const NO_RETRIES = { attempts: 1 };

/** The provider-neutral schema is plain JSON Schema, which `responseJsonSchema` accepts as is. */
export function toGeminiSchema(schema: AnalysisOutputSchema): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, field]) => [key, { type: 'string', description: field.description }])
    ),
    required: [...schema.required],
    additionalProperties: false,
  };
}

const REFUSAL_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.LANGUAGE,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
  FinishReason.IMAGE_RECITATION,
]);

/** Both mean the answer is incomplete; continuing it would be a second billed request. */
const TRUNCATION_REASONS = new Set<string>([FinishReason.MAX_TOKENS, FinishReason.CONTINUATION]);

/** Classifies a response by finish reason, reading text parts directly rather than through `text`. */
export function readGeminiResponse(response: GenerateContentResponse): GenerationResult {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    if (response.promptFeedback?.blockReason) return { status: 'refused' };
    return { status: 'complete', text: '' };
  }
  const reason = candidate.finishReason;
  if (reason && REFUSAL_REASONS.has(reason)) return { status: 'refused' };
  if (reason && TRUNCATION_REASONS.has(reason)) return { status: 'truncated' };
  if (reason && reason !== FinishReason.STOP && reason !== FinishReason.FINISH_REASON_UNSPECIFIED) {
    throw new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
  }
  // Thought summaries, when a model returns them, are not part of the answer.
  const parts = candidate.content?.parts ?? [];
  return { status: 'complete', text: parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('') };
}

/**
 * Sends one image plus the prompt as a single request with JSON output.
 * A new client is created per call, so a key never outlives its request.
 * Retries and automatic continuation are both off: one call, one request.
 */
export const geminiAdapter: ProviderAdapter = {
  provider: 'gemini',
  async generate({ model, image, prompt, schema, maxOutputTokens, apiKey, signal }) {
    if (signal.aborted) throw abortError(signal);

    const client = new GoogleGenAI({
      apiKey,
      vertexai: false,
      httpOptions: { baseUrl: GEMINI_BASE_URL, retryOptions: NO_RETRIES },
    });

    let response: GenerateContentResponse;
    try {
      response = await client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: Buffer.from(image.bytes).toString('base64') } }],
          },
        ],
        config: {
          maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: toGeminiSchema(schema),
          automaticContinuation: false,
          abortSignal: signal,
        },
      });
    } catch (err) {
      throw providerError(err, signal);
    }
    return readGeminiResponse(response);
  },
};

/** Maps SDK failures to safe errors; provider messages can echo request details and are dropped. */
function providerError(err: unknown, signal: AbortSignal): ApiError {
  if (signal.aborted) return abortError(signal);
  if (err instanceof GenAIError) {
    const upstreamStatus = err.status;
    if (upstreamStatus === 429) {
      return new ApiError(429, 'provider_quota', 'The AI provider is rate limited or out of quota. Try again later.', { upstreamStatus });
    }
    if (isCredentialRejection(err)) {
      return new ApiError(502, 'provider_rejected', 'The AI provider rejected the request.', { upstreamStatus });
    }
    return new ApiError(502, 'provider_error', 'The AI provider failed to respond.', { upstreamStatus });
  }
  return new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
}

/**
 * 401 and 403 concern the key. The Gemini API also reports an invalid key as
 * 400 INVALID_ARGUMENT, so a 400 counts only when its error details carry the
 * `API_KEY_INVALID` reason; other 400s are request problems, not the key's.
 */
function isCredentialRejection(err: GenAIError): boolean {
  if (err.status === 401 || err.status === 403) return true;
  return err.status === 400 && errorReasons(err.message).includes('API_KEY_INVALID');
}

/** The SDK's error message is the JSON error body; only `details[].reason` is read from it. */
function errorReasons(message: string): string[] {
  let body: unknown;
  try {
    body = JSON.parse(message);
  } catch {
    return [];
  }
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return [];
  return details
    .map((detail) => (detail as { reason?: unknown } | null)?.reason)
    .filter((reason): reason is string => typeof reason === 'string');
}

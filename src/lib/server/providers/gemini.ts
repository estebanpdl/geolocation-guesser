import {
  FinishReason,
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
  SchemaType,
  type GenerateContentResponse,
  type ObjectSchema,
} from '@google/generative-ai';
import { ApiError } from '../api-error';
import type { AnalysisOutputSchema } from '../analysis-prompt';
import { abortError } from '../deadline';
import type { GenerationResult, ProviderAdapter } from './types';

/** Gemini's response schema is an OpenAPI subset without `additionalProperties`; extra keys are rejected locally. */
export function toGeminiSchema(schema: AnalysisOutputSchema): ObjectSchema {
  return {
    type: SchemaType.OBJECT,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, field]) => [key, { type: SchemaType.STRING, description: field.description }])
    ),
    required: [...schema.required],
  };
}

const REFUSAL_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.LANGUAGE,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  // Newer API versions report image-specific blocks with reasons this SDK version does not list.
  'IMAGE_SAFETY',
]);

/** Classifies a response by finish reason, reading text parts directly rather than through `text()`. */
export function readGeminiResponse(response: GenerateContentResponse): GenerationResult {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    if (response.promptFeedback?.blockReason) return { status: 'refused' };
    return { status: 'complete', text: '' };
  }
  const reason = candidate.finishReason;
  if (reason && REFUSAL_REASONS.has(reason)) return { status: 'refused' };
  if (reason === FinishReason.MAX_TOKENS) return { status: 'truncated' };
  if (reason && reason !== FinishReason.STOP && reason !== FinishReason.FINISH_REASON_UNSPECIFIED) {
    throw new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
  }
  // Thought summaries, when a model returns them, are not part of the answer.
  const parts = (candidate.content?.parts ?? []) as { text?: string; thought?: boolean }[];
  return { status: 'complete', text: parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('') };
}

/**
 * Sends one image plus the prompt as a single request with JSON output.
 * A new client is created per call, so a key never outlives its request.
 * The SDK performs no automatic retries.
 */
export const geminiAdapter: ProviderAdapter = {
  provider: 'gemini',
  async generate({ model, image, prompt, schema, maxOutputTokens, apiKey, signal }) {
    if (signal.aborted) throw abortError(signal);

    const client = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model,
      generationConfig: {
        maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    });

    let response: GenerateContentResponse;
    try {
      const result = await client.generateContent(
        [prompt, { inlineData: { data: Buffer.from(image.bytes).toString('base64'), mimeType: image.mimeType } }],
        { signal }
      );
      response = result.response;
    } catch (err) {
      throw providerError(err, signal);
    }
    return readGeminiResponse(response);
  },
};

/** Maps SDK failures to safe errors; provider messages can echo request details and are dropped. */
function providerError(err: unknown, signal: AbortSignal): ApiError {
  if (signal.aborted) return abortError(signal);
  if (err instanceof GoogleGenerativeAIResponseError) {
    return new ApiError(422, 'analysis_refused', 'The AI provider declined to analyze this image.');
  }
  if (err instanceof GoogleGenerativeAIFetchError) {
    const upstreamStatus = err.status;
    if (upstreamStatus === 429) {
      return new ApiError(429, 'provider_quota', 'The AI provider is rate limited or out of quota. Try again later.', { upstreamStatus });
    }
    if (upstreamStatus === 400 || upstreamStatus === 401 || upstreamStatus === 403) {
      return new ApiError(502, 'provider_rejected', 'The AI provider rejected the request.', { upstreamStatus });
    }
    return new ApiError(502, 'provider_error', 'The AI provider failed to respond.', { upstreamStatus });
  }
  return new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
}

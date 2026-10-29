import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai';
import { ApiError } from '../api-error';
import type { AnalysisOutputSchema } from '../analysis-prompt';
import { abortError, deadlineExceeded } from '../deadline';
import { ANALYSIS_LIMITS } from '../limits';
import type { GenerationResult, ProviderAdapter } from './types';

/** Fixed endpoint, so neither a key nor an image can be sent elsewhere through SDK environment settings. */
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * `high` bounds the image the model sees (and its token cost) to a fixed size
 * class, so a large photo is scaled down rather than rejected or billed at full resolution.
 */
const IMAGE_DETAIL = 'high';

/** Strict structured output requires every property and `additionalProperties: false`, as the shared schema already has. */
export function toOpenAISchema(schema: AnalysisOutputSchema): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, field]) => [key, { type: 'string', description: field.description }])
    ),
    required: [...schema.required],
    additionalProperties: false,
  };
}

/** Classifies a Responses API result; reasoning items and other non-message output are ignored. */
export function readOpenAIResponse(response: OpenAI.Responses.Response): GenerationResult {
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    if (reason === 'content_filter') return { status: 'refused' };
    if (reason === 'max_output_tokens') return { status: 'truncated' };
    throw new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
  }
  if (response.status !== undefined && response.status !== 'completed') {
    throw new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
  }

  let text = '';
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type === 'refusal') return { status: 'refused' };
      if (part.type === 'output_text') text += part.text;
    }
  }
  return { status: 'complete', text };
}

/**
 * Sends one image plus the prompt as a single Responses API request with
 * strict JSON output. A new client is created per call, so a key never
 * outlives its request. Retries are off, and the response is not stored upstream.
 */
export const openaiAdapter: ProviderAdapter = {
  provider: 'openai',
  async generate({ model, image, prompt, schema, maxOutputTokens, reasoningEffort, apiKey, signal }) {
    if (signal.aborted) throw abortError(signal);

    // Options the SDK would otherwise read from the environment are set explicitly: an
    // operator's organization or project header must never accompany a participant's key.
    const client = new OpenAI({
      apiKey,
      baseURL: OPENAI_BASE_URL,
      organization: null,
      project: null,
      adminAPIKey: null,
      maxRetries: 0,
      timeout: ANALYSIS_LIMITS.DEADLINE_MS,
      logLevel: 'off',
    });

    let response: OpenAI.Responses.Response;
    try {
      response = await client.responses.create(
        {
          model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: prompt },
                {
                  type: 'input_image',
                  image_url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`,
                  detail: IMAGE_DETAIL,
                },
              ],
            },
          ],
          text: { format: { type: 'json_schema', name: 'geolocation_analysis', schema: toOpenAISchema(schema), strict: true } },
          max_output_tokens: maxOutputTokens,
          ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
          store: false,
        },
        { signal, maxRetries: 0 }
      );
    } catch (err) {
      throw providerError(err, signal);
    }
    return readOpenAIResponse(response);
  },
};

/** Maps SDK failures to safe errors; provider messages can echo request details and are dropped. */
function providerError(err: unknown, signal: AbortSignal): ApiError {
  if (signal.aborted) return abortError(signal);
  if (err instanceof APIConnectionTimeoutError) return deadlineExceeded();
  if (err instanceof APIError && typeof err.status === 'number') {
    const upstreamStatus = err.status;
    if (upstreamStatus === 429) {
      return new ApiError(429, 'provider_quota', 'The AI provider is rate limited or out of quota. Try again later.', { upstreamStatus });
    }
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return new ApiError(502, 'provider_rejected', 'The AI provider rejected the request.', { upstreamStatus });
    }
    return new ApiError(502, 'provider_error', 'The AI provider failed to respond.', { upstreamStatus });
  }
  return new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
}

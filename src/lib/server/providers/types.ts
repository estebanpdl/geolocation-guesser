import type { ProviderId } from '@/lib/analysis/contract';
import type { AnalysisOutputSchema } from '../analysis-prompt';
import type { ValidatedImage } from '../image';

export type ReasoningEffort = 'none' | 'low' | 'medium';

/** Everything one generation needs. The key belongs to this request only. */
export interface GenerationRequest {
  /** Exact upstream model ID from the server catalog. */
  model: string;
  image: ValidatedImage;
  prompt: string;
  schema: AnalysisOutputSchema;
  maxOutputTokens: number;
  /** Reasoning effort for providers that expose one; others ignore it. */
  reasoningEffort?: ReasoningEffort;
  apiKey: string;
  /** Aborts the provider call; aborting does not cancel work already billed upstream. */
  signal: AbortSignal;
}

/**
 * What the model produced. Parsing and contract validation happen in the
 * orchestration layer, so every provider is held to the same rules.
 */
export type GenerationResult =
  | { status: 'complete'; text: string }
  | { status: 'truncated' }
  | { status: 'refused' };

/**
 * One provider's transport. An adapter makes exactly one upstream request per
 * call, with no retries, and must not keep clients or keys between calls.
 * Transport failures throw ApiErrors without provider messages; credential
 * rejection uses the code `provider_rejected`.
 */
export interface ProviderAdapter {
  provider: ProviderId;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

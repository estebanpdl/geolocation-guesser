/**
 * Orchestrates the two analysis entry points: resolve the selection and
 * credentials, obtain one validated image, make one generation with the
 * selected provider, and validate the output against the shared contract.
 * Everything that can fail without external work fails before any.
 */
import {
  validateAnalysis,
  type Analysis,
  type AnalysisSelection,
  type AnalysisWorkflow,
  type CredentialSource,
  type ProviderId,
} from '@/lib/analysis/contract';
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from './analysis-prompt';
import { ApiError } from './api-error';
import { CATALOG, resolveSelection, type Catalog, type ResolvedSelection } from './catalog';
import { abortError, createDeadline } from './deadline';
import type { ValidatedImage } from './image';
import { attributeCredentialError, resolveInferenceCredential, type InferenceCredential } from './inference-credential';
import { ANALYSIS_LIMITS, STREET_VIEW_LIMITS } from './limits';
import { geminiAdapter } from './providers/gemini';
import type { ProviderAdapter } from './providers/types';
import type { ServerConfig } from './server-config';
import { fetchStreetViewImage } from './street-view-image';
import type { StreetViewRequest } from './validation';

export interface AnalysisDependencies {
  fetchImage: typeof fetchStreetViewImage;
  adapters: Partial<Record<ProviderId, ProviderAdapter>>;
  catalog: Catalog;
  deadlineMs: number;
  imageTimeoutMs: number;
}

const DEFAULT_DEPENDENCIES: AnalysisDependencies = {
  fetchImage: fetchStreetViewImage,
  adapters: { gemini: geminiAdapter },
  catalog: CATALOG,
  deadlineMs: ANALYSIS_LIMITS.DEADLINE_MS,
  imageTimeoutMs: STREET_VIEW_LIMITS.FETCH_TIMEOUT_MS,
};

/** The request fields that choose a model and, optionally, a participant's key. */
export interface AnalysisOptions {
  selection?: unknown;
  participantKey?: unknown;
}

export interface AnalysisOutcome {
  analysis: Analysis;
  selection: AnalysisSelection;
  credentialSource: CredentialSource;
}

interface PreparedAnalysis {
  selected: ResolvedSelection;
  adapter: ProviderAdapter;
  credential: InferenceCredential;
}

function prepare(options: AnalysisOptions, workflow: AnalysisWorkflow, config: ServerConfig, deps: AnalysisDependencies): PreparedAnalysis {
  const selected = resolveSelection(options.selection, workflow, deps.catalog);
  const adapter = deps.adapters[selected.provider.id];
  if (!adapter) {
    throw new ApiError(503, 'provider_unavailable', 'The selected AI provider is not available on this server.');
  }
  const credential = resolveInferenceCredential(options.participantKey, selected.provider, config);
  return { selected, adapter, credential };
}

/** One generation, then the same output rules for every provider. */
async function generate(prepared: PreparedAnalysis, image: ValidatedImage, signal: AbortSignal): Promise<AnalysisOutcome> {
  const { selected, adapter, credential } = prepared;
  let result;
  try {
    result = await adapter.generate({
      model: selected.model.upstreamModel,
      image,
      prompt: ANALYSIS_PROMPT,
      schema: ANALYSIS_SCHEMA,
      maxOutputTokens: selected.model.maxOutputTokens,
      apiKey: credential.apiKey,
      signal,
    });
  } catch (err) {
    throw attributeCredentialError(err, credential);
  }

  return {
    analysis: parseOutput(result),
    selection: { provider: selected.provider.id, model: selected.model.id },
    credentialSource: credential.source,
  };
}

/** Refusals, truncation and malformed output are errors, never placeholder analyses. */
export function parseOutput(result: Awaited<ReturnType<ProviderAdapter['generate']>>): Analysis {
  if (result.status === 'refused') {
    throw new ApiError(422, 'analysis_refused', 'The AI provider declined to analyze this image.');
  }
  if (result.status === 'truncated') {
    throw new ApiError(502, 'output_truncated', 'The AI provider stopped before finishing the analysis.');
  }
  const text = result.text.trim();
  if (!text) throw new ApiError(502, 'empty_output', 'The AI provider returned no analysis.');
  if (text.length > ANALYSIS_LIMITS.MAX_OUTPUT_CHARS) {
    throw new ApiError(502, 'output_too_large', 'The AI provider returned an oversized analysis.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidOutput();
  }
  const checked = validateAnalysis(parsed);
  if (!checked.ok) throw invalidOutput();
  return checked.analysis;
}

function invalidOutput(): ApiError {
  return new ApiError(502, 'invalid_output', 'The AI provider returned an analysis in an unexpected format.');
}

/** Street View image, then one inference call, inside one deadline. */
export async function runSceneAnalysis(
  view: StreetViewRequest,
  options: AnalysisOptions,
  config: ServerConfig,
  cancel?: AbortSignal,
  deps: AnalysisDependencies = DEFAULT_DEPENDENCIES
): Promise<AnalysisOutcome> {
  const prepared = prepare(options, 'scene', config, deps);
  // The Street View image always uses the operator's server key; participant keys are for inference only.
  const mapsKey = config.credentials.mapsServerKey?.value;
  if (!mapsKey) {
    throw new ApiError(503, 'image_service_unconfigured', 'Street View analysis is not configured on this server.');
  }

  const deadline = createDeadline(deps.deadlineMs, cancel);
  try {
    const stage = deadline.stage(deps.imageTimeoutMs);
    let image: ValidatedImage;
    try {
      image = await deps.fetchImage(view, mapsKey, stage.signal);
    } finally {
      stage.dispose();
    }
    if (deadline.signal.aborted) throw abortError(deadline.signal);
    return await generate(prepared, image, deadline.signal);
  } finally {
    deadline.dispose();
  }
}

/** One inference call on an already validated photo, inside the analysis deadline. */
export async function runPhotoAnalysis(
  image: ValidatedImage,
  options: AnalysisOptions,
  config: ServerConfig,
  cancel?: AbortSignal,
  deps: AnalysisDependencies = DEFAULT_DEPENDENCIES
): Promise<AnalysisOutcome> {
  const prepared = prepare(options, 'photo', config, deps);
  const deadline = createDeadline(deps.deadlineMs, cancel);
  try {
    return await generate(prepared, image, deadline.signal);
  } finally {
    deadline.dispose();
  }
}

/**
 * The server-owned model catalog. Browsers select entries by catalog ID; the
 * exact upstream model name never comes from a request.
 */
import {
  isProviderId,
  type AnalysisSelection,
  type AnalysisWorkflow,
  type ProviderId,
  type PublicCatalog,
} from '@/lib/analysis/contract';
import { ApiError } from './api-error';
import type { CredentialField } from './credential-store';
import { ANALYSIS_LIMITS } from './limits';
import type { ReasoningEffort } from './providers/types';
import type { ServerConfig } from './server-config';

export interface CatalogProvider {
  id: ProviderId;
  label: string;
  /** False while the provider has no server adapter; its entries are hidden and refused. */
  enabled: boolean;
  credentialField: CredentialField;
  participantKeys: boolean;
  /**
   * Whether Street View Static imagery may be sent to this provider. When false,
   * the provider's entries are offered for photos only and scene requests are refused.
   */
  streetViewImagery: boolean;
}

export interface CatalogModel {
  /** Stable public ID, independent of the upstream name. */
  id: string;
  provider: ProviderId;
  label: string;
  upstreamModel: string;
  workflows: AnalysisWorkflow[];
  /** Entries must accept image input and structured JSON output to be listed. */
  capabilities: { imageInput: boolean; structuredOutput: boolean };
  maxOutputTokens: number;
  reasoningEffort?: ReasoningEffort;
  /** One default per enabled provider. */
  default: boolean;
}

export interface Catalog {
  providers: CatalogProvider[];
  models: CatalogModel[];
  /** The selection used when a request names none. */
  defaultSelection: AnalysisSelection;
}

/**
 * Upstream names use explicit model IDs rather than "latest" aliases. Provider
 * behavior and availability can still change. Each entry's image input and
 * structured output support is taken from the provider's model documentation;
 * docs/providers.md records the sources and review dates.
 */
export const CATALOG: Catalog = {
  providers: [
    { id: 'gemini', label: 'Gemini', enabled: true, credentialField: 'geminiApiKey', participantKeys: true, streetViewImagery: true },
    { id: 'openai', label: 'OpenAI', enabled: true, credentialField: 'openaiApiKey', participantKeys: true, streetViewImagery: true },
  ],
  models: [
    {
      id: 'gemini-3.5-flash-lite',
      provider: 'gemini',
      label: 'Gemini 3.5 Flash-Lite',
      upstreamModel: 'gemini-3.5-flash-lite',
      workflows: ['scene', 'photo'],
      capabilities: { imageInput: true, structuredOutput: true },
      maxOutputTokens: ANALYSIS_LIMITS.MAX_OUTPUT_TOKENS,
      default: true,
    },
    {
      id: 'gemini-3.8-flash',
      provider: 'gemini',
      label: 'Gemini 3.8 Flash',
      upstreamModel: 'gemini-3.8-flash',
      workflows: ['scene', 'photo'],
      capabilities: { imageInput: true, structuredOutput: true },
      maxOutputTokens: ANALYSIS_LIMITS.MAX_OUTPUT_TOKENS,
      default: false,
    },
    {
      id: 'gpt-6-luna',
      provider: 'openai',
      label: 'GPT-6 Luna',
      upstreamModel: 'gpt-6-luna',
      workflows: ['scene', 'photo'],
      capabilities: { imageInput: true, structuredOutput: true },
      maxOutputTokens: ANALYSIS_LIMITS.MAX_OUTPUT_TOKENS,
      // Reasoning tokens count toward the output limit and are billed as output.
      reasoningEffort: 'low',
      default: true,
    },
    {
      id: 'gpt-6.1-terra',
      provider: 'openai',
      label: 'GPT-6.1 Terra',
      upstreamModel: 'gpt-6.1-terra',
      workflows: ['scene', 'photo'],
      capabilities: { imageInput: true, structuredOutput: true },
      maxOutputTokens: ANALYSIS_LIMITS.MAX_OUTPUT_TOKENS,
      reasoningEffort: 'low',
      default: false,
    },
  ],
  defaultSelection: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
};

/** The workflows an entry is offered for: its own, less scenes when the provider may not receive Street View imagery. */
export function allowedWorkflows(provider: CatalogProvider, model: CatalogModel): AnalysisWorkflow[] {
  return model.workflows.filter((workflow) => workflow !== 'scene' || provider.streetViewImagery);
}

/** Structural rules every catalog must satisfy; returns problems rather than throwing. */
export function catalogProblems(catalog: Catalog): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const model of catalog.models) {
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(model.id)) problems.push(`invalid id ${model.id}`);
    if (ids.has(model.id)) problems.push(`duplicate id ${model.id}`);
    ids.add(model.id);
    if (!catalog.providers.some((p) => p.id === model.provider)) problems.push(`unknown provider for ${model.id}`);
    if (!model.upstreamModel.trim()) problems.push(`missing upstream model for ${model.id}`);
    if (model.workflows.length === 0) problems.push(`no workflows for ${model.id}`);
  }
  for (const provider of catalog.providers.filter((p) => p.enabled)) {
    const listed = catalog.models.filter((m) => m.provider === provider.id && isListed(m));
    if (listed.length > 0 && listed.filter((m) => m.default).length !== 1) {
      problems.push(`provider ${provider.id} needs exactly one default`);
    }
  }
  const fallback = catalog.models.find((m) => m.id === catalog.defaultSelection.model);
  const fallbackProvider = catalog.providers.find((p) => p.id === catalog.defaultSelection.provider);
  if (!fallback || !fallbackProvider || fallback.provider !== fallbackProvider.id || !fallback.default || !isListed(fallback)) {
    problems.push('defaultSelection must name a listed default entry');
  } else if (allowedWorkflows(fallbackProvider, fallback).length !== 2) {
    problems.push('defaultSelection must support both workflows');
  }
  return problems;
}

function isListed(model: CatalogModel): boolean {
  return model.capabilities.imageInput && model.capabilities.structuredOutput;
}

/**
 * The catalog as browsers see it: enabled providers and listed entries only,
 * each with the workflows it is offered for.
 * Operator-credential availability and participant-key support are reported
 * separately, so a provider without server credentials stays visible when a
 * participant can supply a key. No credential value is included.
 */
export function publicCatalog(config: ServerConfig, catalog: Catalog = CATALOG): PublicCatalog {
  return {
    providers: catalog.providers
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        operatorCredentials: Boolean(config.credentials[provider.credentialField]),
        participantKeys: provider.participantKeys,
        models: catalog.models
          .filter((m) => m.provider === provider.id && isListed(m) && allowedWorkflows(provider, m).length > 0)
          .map((m) => ({ id: m.id, label: m.label, workflows: allowedWorkflows(provider, m), default: m.default })),
      }))
      .filter((provider) => provider.models.length > 0),
    defaultSelection: { ...catalog.defaultSelection },
  };
}

export interface ResolvedSelection {
  provider: CatalogProvider;
  model: CatalogModel;
}

function badSelection(code: string, message: string): ApiError {
  return new ApiError(400, code, message);
}

/**
 * Resolves a request's `selection` for a workflow. An omitted selection uses the
 * catalog default; a provided one must match an entry exactly and never falls back.
 */
export function resolveSelection(input: unknown, workflow: AnalysisWorkflow, catalog: Catalog = CATALOG): ResolvedSelection {
  const requested =
    input === undefined ? catalog.defaultSelection : (input as Record<string, unknown> | null);
  if (requested === null || typeof requested !== 'object' || Array.isArray(requested)) {
    throw badSelection('invalid_selection', 'selection must be an object with provider and model.');
  }
  const { provider: providerId, model: modelId } = requested as Record<string, unknown>;
  if (typeof providerId !== 'string' || typeof modelId !== 'string') {
    throw badSelection('invalid_selection', 'selection must be an object with provider and model.');
  }

  const provider = isProviderId(providerId) ? catalog.providers.find((p) => p.id === providerId) : undefined;
  if (!provider) throw badSelection('unknown_provider', 'The selected AI provider is not supported.');
  if (!provider.enabled) {
    throw new ApiError(503, 'provider_unavailable', 'The selected AI provider is not available on this server.');
  }

  const model = catalog.models.find((m) => m.id === modelId);
  if (!model || !isListed(model)) {
    throw badSelection('unknown_model', 'The selected model is not available. Reload the page to refresh the model list.');
  }
  if (model.provider !== provider.id) {
    throw badSelection('selection_mismatch', 'The selected model does not belong to the selected provider.');
  }
  if (!model.workflows.includes(workflow)) {
    throw badSelection('workflow_unsupported', 'The selected model is not available for this kind of analysis.');
  }
  if (!allowedWorkflows(provider, model).includes(workflow)) {
    throw new ApiError(
      403,
      'street_view_not_permitted',
      `${provider.label} is not available for Street View analysis on this server. Choose another provider, or use it for photo analysis.`
    );
  }
  return { provider, model };
}

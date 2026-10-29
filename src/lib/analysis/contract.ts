/**
 * The analysis contract shared by the browser and the server: result fields,
 * model selection, participant keys, the public model catalog and error codes.
 *
 * This module must stay importable from client components, so it imports
 * nothing: no SDK, server configuration or credential code.
 */

export const PROVIDER_IDS = ['gemini', 'openai'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** The two analysis entry points: a Street View scene in the game, or an uploaded photo. */
export type AnalysisWorkflow = 'scene' | 'photo';

// ---------------------------------------------------------------------------
// Result

export const ANALYSIS_FIELDS = [
  { key: 'textAndSigns', label: 'Text & Signs' },
  { key: 'landmarksAndBuildings', label: 'Landmarks & Buildings' },
  { key: 'roadAndInfrastructure', label: 'Road & Infrastructure' },
  { key: 'vehiclesAndPlates', label: 'Vehicles & Plates' },
  { key: 'vegetationAndTerrain', label: 'Vegetation & Terrain' },
  { key: 'culturalIndicators', label: 'Cultural Indicators' },
  { key: 'overallAssessment', label: 'Overall Assessment' },
] as const;

export type AnalysisField = (typeof ANALYSIS_FIELDS)[number]['key'];
export type Analysis = Record<AnalysisField, string>;

/** Per-field bound; the seven fields together stay below the server's total output bound. */
export const ANALYSIS_FIELD_MAX_CHARS = 4000;

/** The text a model is told to use when a category has no evidence. */
export const NO_CLEAR_INDICATORS = 'No clear indicators.';

export type AnalysisValidation =
  | { ok: true; analysis: Analysis }
  | { ok: false; problem: 'not_object' | 'missing_field' | 'invalid_field' | 'field_too_long' | 'unexpected_field' };

/**
 * Checks a parsed model output (or an API response's `analysis`) against the
 * contract: exactly the seven fields, each a non-blank bounded string.
 */
export function validateAnalysis(value: unknown): AnalysisValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, problem: 'not_object' };
  const record = value as Record<string, unknown>;
  const known = new Set<string>(ANALYSIS_FIELDS.map((f) => f.key));
  if (Object.keys(record).some((key) => !known.has(key))) return { ok: false, problem: 'unexpected_field' };

  const analysis = {} as Analysis;
  for (const { key } of ANALYSIS_FIELDS) {
    const field = record[key];
    if (field === undefined) return { ok: false, problem: 'missing_field' };
    if (typeof field !== 'string' || !field.trim()) return { ok: false, problem: 'invalid_field' };
    if (field.length > ANALYSIS_FIELD_MAX_CHARS) return { ok: false, problem: 'field_too_long' };
    analysis[key] = field.trim();
  }
  return { ok: true, analysis };
}

// ---------------------------------------------------------------------------
// Selection and participant keys

/** A provider plus a catalog model ID (not an upstream model name). */
export interface AnalysisSelection {
  provider: ProviderId;
  model: string;
}

export type CredentialSource = 'participant' | 'operator';

/** Optional key a participant supplies for the selected provider; sent only with their own request. */
export interface ParticipantKeyInput {
  provider: ProviderId;
  apiKey: string;
}

export const PARTICIPANT_KEY_MAX_LENGTH = 512;

/**
 * Shape check only: bounded length and printable ASCII without spaces, so a key
 * can never inject header content. No provider-specific prefix rules are applied.
 */
export function isWellFormedParticipantKey(key: string): boolean {
  return key.length > 0 && key.length <= PARTICIPANT_KEY_MAX_LENGTH && /^[\x21-\x7e]+$/.test(key);
}

// ---------------------------------------------------------------------------
// Public catalog: safe to send to any browser

export interface PublicCatalogModel {
  id: string;
  label: string;
  workflows: AnalysisWorkflow[];
  default: boolean;
}

export interface PublicCatalogProvider {
  id: ProviderId;
  label: string;
  /** Whether the server has its own credentials for this provider. */
  operatorCredentials: boolean;
  /** Whether a participant may use their own key for this provider. */
  participantKeys: boolean;
  models: PublicCatalogModel[];
}

export interface PublicCatalog {
  providers: PublicCatalogProvider[];
  /** Used by the server when a request names no selection. */
  defaultSelection: AnalysisSelection;
}

// ---------------------------------------------------------------------------
// Responses and errors

export interface AnalysisResponse {
  analysis: Analysis;
  selection: AnalysisSelection;
  credentialSource: CredentialSource;
  requestId: string;
}

/** Validates a successful analysis response body before it is shown. */
export function parseAnalysisResponse(data: unknown): AnalysisResponse | null {
  if (data === null || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  const checked = validateAnalysis(body.analysis);
  if (!checked.ok) return null;
  const selection = body.selection as Record<string, unknown> | null | undefined;
  if (!selection || !isProviderId(selection.provider) || typeof selection.model !== 'string') return null;
  if (body.credentialSource !== 'participant' && body.credentialSource !== 'operator') return null;
  if (typeof body.requestId !== 'string') return null;
  return {
    analysis: checked.analysis,
    selection: { provider: selection.provider, model: selection.model },
    credentialSource: body.credentialSource,
    requestId: body.requestId,
  };
}

/** Error codes the analysis routes return that the browser acts on. */
export const ANALYSIS_ERROR_CODES = {
  TRAINING_SESSION_REQUIRED: 'training_session_required',
  PARTICIPANT_KEY_REJECTED: 'participant_key_rejected',
  ANALYSIS_UNCONFIGURED: 'analysis_unconfigured',
} as const;

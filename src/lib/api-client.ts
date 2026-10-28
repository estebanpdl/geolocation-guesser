import {
  ANALYSIS_ERROR_CODES,
  parseAnalysisResponse,
  type AnalysisResponse,
  type AnalysisSelection,
  type PublicCatalog,
} from '@/lib/analysis/contract';
import { participantKeyField } from '@/lib/participant-keys';

/** Error code returned by the analysis routes when a training session is required. */
export const TRAINING_SESSION_REQUIRED = ANALYSIS_ERROR_CODES.TRAINING_SESSION_REQUIRED;

export interface ApiErrorInfo {
  message: string;
  code: string | null;
}

/** Reads `{ error, code }` from a failed API response, tolerating non-JSON bodies. */
export async function readApiError(res: Response, fallback: string): Promise<ApiErrorInfo> {
  try {
    const data = await res.json();
    return {
      message: typeof data?.error === 'string' ? data.error : fallback,
      code: typeof data?.code === 'string' ? data.code : null,
    };
  } catch {
    return { message: fallback, code: null };
  }
}

/** An API failure with the server's safe message and code. */
export class AnalysisRequestError extends Error {
  readonly code: string | null;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = 'AnalysisRequestError';
    this.code = info.code;
  }
}

/**
 * Posts one analysis request. The participant key for the selected provider,
 * if one is set, is read at call time and goes only into this request body.
 * Without a selection the server uses its default model and credentials.
 */
export async function requestAnalysis(
  endpoint: '/api/ai-analysis' | '/api/ai-analysis-upload',
  payload: Record<string, unknown>,
  selection: AnalysisSelection | null
): Promise<AnalysisResponse> {
  const body: Record<string, unknown> = { ...payload };
  if (selection) {
    body.selection = selection;
    const participantKey = participantKeyField(selection.provider);
    if (participantKey) body.participantKey = participantKey;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AnalysisRequestError(await readApiError(res, 'Analysis failed'));

  const parsed = parseAnalysisResponse(await res.json().catch(() => null));
  if (!parsed) throw new AnalysisRequestError({ message: 'The analysis response was not in the expected format.', code: null });
  return parsed;
}

let catalogRequest: Promise<PublicCatalog | null> | null = null;

/** The server's public model catalog, fetched once per page load; null when unavailable. */
export function fetchCatalog(): Promise<PublicCatalog | null> {
  catalogRequest ??= fetch('/api/analysis/catalog', { cache: 'no-store' })
    .then(async (res) => (res.ok ? ((await res.json()).catalog as PublicCatalog) : null))
    .catch(() => null)
    .then((catalog) => {
      if (!catalog) catalogRequest = null;
      return catalog;
    });
  return catalogRequest;
}

/** Forgets the cached catalog (for tests). */
export function resetCatalogCache(): void {
  catalogRequest = null;
}

export type TrainingStatusMode = 'off' | 'open' | 'closed' | 'unavailable';

/** The training mode from the server's public status; null when it cannot be read. */
export async function fetchTrainingMode(): Promise<TrainingStatusMode | null> {
  try {
    const res = await fetch('/api/training/session', { cache: 'no-store' });
    if (!res.ok) return null;
    const mode = (await res.json())?.training?.mode;
    return mode === 'off' || mode === 'open' || mode === 'closed' || mode === 'unavailable' ? mode : null;
  } catch {
    return null;
  }
}

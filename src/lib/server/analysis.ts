import { analyzeImage, type SceneAnalysis } from '@/lib/gemini';
import { ApiError } from './api-error';
import { abortError, createDeadline } from './deadline';
import type { ValidatedImage } from './image';
import { ANALYSIS_LIMITS, STREET_VIEW_LIMITS } from './limits';
import type { ServerConfig } from './server-config';
import { fetchStreetViewImage } from './street-view-image';
import type { StreetViewRequest } from './validation';

export interface AnalysisDependencies {
  fetchImage: typeof fetchStreetViewImage;
  analyze: typeof analyzeImage;
  deadlineMs: number;
  imageTimeoutMs: number;
}

const DEFAULT_DEPENDENCIES: AnalysisDependencies = {
  fetchImage: fetchStreetViewImage,
  analyze: analyzeImage,
  deadlineMs: ANALYSIS_LIMITS.DEADLINE_MS,
  imageTimeoutMs: STREET_VIEW_LIMITS.FETCH_TIMEOUT_MS,
};

function requireGeminiKey(config: ServerConfig): string {
  const key = config.credentials.geminiApiKey?.value;
  if (!key) throw new ApiError(503, 'analysis_unconfigured', 'AI analysis is not configured on this server.');
  return key;
}

/** Street View image, then one inference call, inside one deadline. Credentials are checked before either. */
export async function runSceneAnalysis(
  view: StreetViewRequest,
  config: ServerConfig,
  cancel?: AbortSignal,
  deps: AnalysisDependencies = DEFAULT_DEPENDENCIES
): Promise<SceneAnalysis> {
  const geminiKey = requireGeminiKey(config);
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
    return await deps.analyze(image, { apiKey: geminiKey, signal: deadline.signal });
  } finally {
    deadline.dispose();
  }
}

/** One inference call on an already validated photo, inside the analysis deadline. */
export async function runPhotoAnalysis(
  image: ValidatedImage,
  config: ServerConfig,
  cancel?: AbortSignal,
  deps: AnalysisDependencies = DEFAULT_DEPENDENCIES
): Promise<SceneAnalysis> {
  const geminiKey = requireGeminiKey(config);
  const deadline = createDeadline(deps.deadlineMs, cancel);
  try {
    return await deps.analyze(image, { apiKey: geminiKey, signal: deadline.signal });
  } finally {
    deadline.dispose();
  }
}

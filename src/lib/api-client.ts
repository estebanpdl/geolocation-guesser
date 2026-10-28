/** Error code returned by the analysis routes when a training session is required. */
export const TRAINING_SESSION_REQUIRED = 'training_session_required';

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

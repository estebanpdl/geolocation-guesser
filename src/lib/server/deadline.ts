import { ApiError } from './api-error';

export function deadlineExceeded(): ApiError {
  return new ApiError(504, 'deadline_exceeded', 'The analysis took too long and was stopped. A retry may be billed again.');
}

function clientClosed(): ApiError {
  return new ApiError(499, 'client_closed_request', 'The request was cancelled.');
}

export interface Stage {
  signal: AbortSignal;
  dispose(): void;
}

export interface Deadline {
  signal: AbortSignal;
  /** A signal that aborts at the earlier of the overall deadline and `stageMs` from now. */
  stage(stageMs: number): Stage;
  dispose(): void;
}

/**
 * One end-to-end time budget for a request. Aborting carries an ApiError as the
 * abort reason, so a cancelled fetch rejects with a ready-to-return error.
 * A client disconnect (the parent signal) aborts the same way.
 */
export function createDeadline(totalMs: number, parent?: AbortSignal): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(deadlineExceeded()), totalMs);
  const onParentAbort = () => controller.abort(clientClosed());
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });

  return {
    signal: controller.signal,
    stage(stageMs: number): Stage {
      const stageController = new AbortController();
      const stageTimer = setTimeout(() => stageController.abort(deadlineExceeded()), stageMs);
      const forward = () => stageController.abort(controller.signal.reason);
      if (controller.signal.aborted) forward();
      else controller.signal.addEventListener('abort', forward, { once: true });
      return {
        signal: stageController.signal,
        dispose() {
          clearTimeout(stageTimer);
          controller.signal.removeEventListener('abort', forward);
        },
      };
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

/** The ApiError an aborted signal carries, or a deadline error if it carries something else. */
export function abortError(signal: AbortSignal): ApiError {
  return signal.reason instanceof ApiError ? signal.reason : deadlineExceeded();
}

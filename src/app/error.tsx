'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-tactical-bg flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-tactical-red text-sm font-mono mb-2">System Error</div>
        <div className="text-tactical-muted text-xs mb-6">
          {error.message || 'An unexpected error occurred'}
        </div>
        <button onClick={reset} className="btn-primary text-sm">
          Reset
        </button>
      </div>
    </div>
  );
}

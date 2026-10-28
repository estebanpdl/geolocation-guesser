'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { readApiError } from '@/lib/api-client';

type TrainingMode = 'off' | 'open' | 'closed' | 'unavailable';

interface TrainingState {
  mode: TrainingMode;
  active: boolean;
  expiresAt: number | null;
}

const STATUS_TEXT: Record<Exclude<TrainingMode, 'open'>, string> = {
  off: 'This server does not require a training access code.',
  closed: 'Training is closed. AI analysis is unavailable.',
  unavailable: 'Training access is not configured on this server. AI analysis is unavailable.',
};

export default function TrainingAccessPage() {
  const [state, setState] = useState<TrainingState | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/training/session', { cache: 'no-store' });
      if (!res.ok) throw new Error((await readApiError(res, 'Training status is unavailable.')).message);
      setState((await res.json()).training);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Training status is unavailable.');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/training/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error((await readApiError(res, 'The access code could not be checked.')).message);
      setState((await res.json()).training);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The access code could not be checked.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnd = async () => {
    await fetch('/api/training/session', { method: 'DELETE' }).catch(() => undefined);
    setError(null);
    await refresh();
  };

  return (
    <div className="min-h-screen bg-tactical-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Training Access</h1>
          <p className="text-tactical-muted text-sm">
            Enter the access code from your training organizer to use AI analysis.
          </p>
        </div>

        <div className="card space-y-4">
          {!state && !error && <div className="text-xs text-tactical-muted font-mono">Checking access...</div>}

          {state && state.mode !== 'open' && (
            <p className="text-sm text-slate-300">{STATUS_TEXT[state.mode]}</p>
          )}

          {state?.mode === 'open' && state.active && (
            <div className="space-y-3">
              <p className="text-sm text-tactical-green">
                Access active
                {state.expiresAt ? ` until ${new Date(state.expiresAt).toLocaleTimeString()}` : ''}.
              </p>
              <p className="text-xs text-tactical-muted">
                You can close this tab and retry the analysis.
              </p>
              <button onClick={handleEnd} className="btn-secondary w-full">
                End Session
              </button>
            </div>
          )}

          {state?.mode === 'open' && !state.active && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="training-code"
                  className="block text-xs text-tactical-muted uppercase tracking-wider mb-1.5"
                >
                  Access Code
                </label>
                <input
                  id="training-code"
                  type="password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  maxLength={256}
                  className="input-field w-full"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={!code.trim() || submitting} className="btn-primary w-full">
                {submitting ? 'Checking...' : 'Continue'}
              </button>
            </form>
          )}

          {error && <div className="text-xs text-tactical-red font-mono">{error}</div>}
        </div>

        <div className="text-center">
          <Link href="/" className="text-xs text-tactical-green hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

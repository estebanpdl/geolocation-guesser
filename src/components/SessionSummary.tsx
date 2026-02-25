'use client';

import type { GameSession } from '@/lib/types';
import { formatDistance, formatScore } from '@/utils/formatters';
import { SCORING } from '@/utils/constants';

interface SessionSummaryProps {
  session: GameSession;
  totalScore: number;
  onNewSession: () => void;
}

const categoryColors: Record<string, string> = {
  Excellent: 'text-tactical-green',
  Good: 'text-tactical-green/80',
  Fair: 'text-tactical-amber',
  Poor: 'text-tactical-red',
};

export default function SessionSummary({ session, totalScore, onNewSession }: SessionSummaryProps) {
  const maxPossible = session.totalRounds * SCORING.MAX_SCORE;
  const avgDistance =
    session.rounds.length > 0
      ? session.rounds.reduce((sum, r) => sum + r.distanceKm, 0) / session.rounds.length
      : 0;

  return (
    <div className="min-h-screen bg-tactical-bg p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-slate-100">Session Complete</h1>
          <p className="text-tactical-muted">
            Player: <span className="text-slate-300">{session.playerName}</span>
          </p>
        </div>

        {/* Overall score */}
        <div className="card text-center py-8">
          <div className="text-5xl font-bold font-mono text-tactical-green">
            {formatScore(totalScore)}
          </div>
          <div className="text-sm text-tactical-muted mt-1">
            out of {formatScore(maxPossible)} possible
          </div>
          <div className="text-lg text-slate-300 mt-3">
            Average distance: <span className="font-mono text-tactical-amber">{formatDistance(avgDistance)}</span>
          </div>
        </div>

        {/* Round-by-round table */}
        <div className="card overflow-hidden">
          <h2 className="text-sm font-semibold text-tactical-amber uppercase tracking-wider mb-3">
            Round Breakdown
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tactical-border text-tactical-muted text-left">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Score</th>
                  <th className="pb-2 pr-4">Distance</th>
                  <th className="pb-2 pr-4">Rating</th>
                  <th className="pb-2 pr-4">Hypothesis</th>
                  <th className="pb-2">AI</th>
                </tr>
              </thead>
              <tbody>
                {session.rounds.map((round) => (
                  <tr key={round.roundNumber} className="border-b border-tactical-border/50">
                    <td className="py-2 pr-4 font-mono text-tactical-muted">
                      {round.roundNumber}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-200">
                      {formatScore(round.score)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-300">
                      {formatDistance(round.distanceKm)}
                    </td>
                    <td className={`py-2 pr-4 font-semibold ${categoryColors[round.category]}`}>
                      {round.category}
                    </td>
                    <td className="py-2 pr-4 text-tactical-muted">
                      {round.hypothesis?.country || '—'}
                    </td>
                    <td className="py-2">
                      {round.usedAI ? (
                        <span className="text-tactical-amber">Yes</span>
                      ) : (
                        <span className="text-tactical-muted">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Hypotheses detail */}
        {session.rounds.some((r) => r.hypothesis?.evidenceNotes) && (
          <div className="card">
            <h2 className="text-sm font-semibold text-tactical-amber uppercase tracking-wider mb-3">
              Evidence Notes
            </h2>
            <div className="space-y-3">
              {session.rounds
                .filter((r) => r.hypothesis?.evidenceNotes)
                .map((round) => (
                  <div key={round.roundNumber} className="text-sm">
                    <span className="text-tactical-muted font-mono">Round {round.roundNumber}:</span>{' '}
                    <span className="text-slate-300">{round.hypothesis!.evidenceNotes}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Saved notice */}
        <div className="text-center text-xs text-tactical-muted">
          Session saved automatically
        </div>

        {/* Actions */}
        <div className="flex justify-center gap-4">
          <a href={`/history/${session.id}`} className="btn-secondary">
            View in History
          </a>
          <button onClick={onNewSession} className="btn-primary">
            New Session
          </button>
        </div>
      </div>
    </div>
  );
}

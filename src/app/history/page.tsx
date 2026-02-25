'use client';

import Link from 'next/link';
import { useSessionHistory } from '@/hooks/useSessionHistory';
import { formatScore, formatDate, formatDistance } from '@/utils/formatters';
import { SCORING } from '@/utils/constants';

export default function HistoryPage() {
  const { sessions, deleteSession } = useSessionHistory();

  return (
    <div className="min-h-screen bg-tactical-bg p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Session History</h1>
            <p className="text-tactical-muted text-sm mt-1">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
          <Link href="/" className="btn-secondary text-sm">
            New Session
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-tactical-muted text-sm">No sessions yet.</div>
            <Link href="/" className="btn-primary inline-block mt-4">
              Start Training
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const totalScore = session.rounds.reduce((s, r) => s + r.score, 0);
              const maxScore = session.totalRounds * SCORING.MAX_SCORE;
              const avgDistance =
                session.rounds.length > 0
                  ? session.rounds.reduce((s, r) => s + r.distanceKm, 0) / session.rounds.length
                  : 0;
              const aiRounds = session.rounds.filter((r) => r.usedAI).length;

              return (
                <Link
                  key={session.id}
                  href={`/history/${session.id}`}
                  className="card block relative hover:border-tactical-green/30 transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-200">
                          {session.playerName}
                        </span>
                      </div>
                      <div className="text-xs text-tactical-muted">
                        {formatDate(session.startedAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold font-mono text-tactical-green">
                        {formatScore(totalScore)}
                      </div>
                      <div className="text-[10px] text-tactical-muted">
                        / {formatScore(maxScore)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-tactical-muted">
                    <span>{session.rounds.length} rounds</span>
                    <span>Avg: {formatDistance(avgDistance)}</span>
                    {aiRounds > 0 && (
                      <span className="text-tactical-blue">AI: {aiRounds} rounds</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm('Delete this session?')) {
                        deleteSession(session.id);
                      }
                    }}
                    className="absolute top-3 right-3 text-tactical-muted hover:text-tactical-red opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  >
                    Delete
                  </button>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

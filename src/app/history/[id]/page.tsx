'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { GameSession } from '@/lib/types';
import { getSession } from '@/lib/session-storage';
import { formatScore, formatDate, formatDistance } from '@/utils/formatters';
import { SCORING } from '@/utils/constants';

const categoryColors: Record<string, string> = {
  Excellent: 'text-tactical-green',
  Good: 'text-tactical-green/80',
  Fair: 'text-tactical-amber',
  Poor: 'text-tactical-red',
};

export default function SessionDetailPage() {
  const params = useParams();
  const [session, setSession] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = params.id as string;
    const found = getSession(id);
    setSession(found);
    setLoading(false);
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-tactical-bg flex items-center justify-center">
        <div className="text-tactical-muted font-mono text-sm">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-tactical-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-tactical-muted text-sm mb-4">Session not found</div>
          <Link href="/history" className="btn-secondary text-sm">
            Back to History
          </Link>
        </div>
      </div>
    );
  }

  const totalScore = session.rounds.reduce((s, r) => s + r.score, 0);
  const maxScore = session.totalRounds * SCORING.MAX_SCORE;
  const avgDistance =
    session.rounds.length > 0
      ? session.rounds.reduce((s, r) => s + r.distanceKm, 0) / session.rounds.length
      : 0;

  return (
    <div className="min-h-screen bg-tactical-bg p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Navigation */}
        <div className="flex items-center gap-2 text-xs text-tactical-muted">
          <Link href="/history" className="hover:text-slate-300 transition-colors">
            History
          </Link>
          <span>/</span>
          <span className="text-slate-400">Session Detail</span>
        </div>

        {/* Header */}
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-100">{session.playerName}</h1>
              <div className="text-xs text-tactical-muted mt-1">
                {formatDate(session.startedAt)} &middot; {session.locationSetId}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold font-mono text-tactical-green">
                {formatScore(totalScore)}
              </div>
              <div className="text-xs text-tactical-muted">
                / {formatScore(maxScore)} &middot; Avg {formatDistance(avgDistance)}
              </div>
            </div>
          </div>
        </div>

        {/* Round-by-round */}
        {session.rounds.map((round) => (
          <div key={round.roundNumber} className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-tactical-muted bg-tactical-bg px-2 py-0.5 rounded">
                  R{round.roundNumber}
                </span>
                <span className={`text-sm font-semibold ${categoryColors[round.category]}`}>
                  {round.category}
                </span>
                {round.usedAI && (
                  <span className="text-[10px] text-tactical-blue font-mono bg-tactical-blue/10 px-1.5 py-0.5 rounded">
                    AI
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="text-lg font-bold font-mono text-slate-200">
                  {formatScore(round.score)}
                </span>
                <span className="text-xs text-tactical-muted ml-2">
                  {formatDistance(round.distanceKm)}
                </span>
              </div>
            </div>

            {/* Coordinates */}
            <div className="flex gap-4 text-xs">
              <div>
                <span className="text-tactical-muted">Guess: </span>
                <span className="font-mono text-tactical-amber">
                  {round.guess.lat.toFixed(4)}°, {round.guess.lng.toFixed(4)}°
                </span>
              </div>
              <div>
                <span className="text-tactical-muted">Actual: </span>
                <span className="font-mono text-tactical-green">
                  {round.actual.lat.toFixed(4)}°, {round.actual.lng.toFixed(4)}°
                </span>
              </div>
            </div>

            {/* Hypothesis */}
            {round.hypothesis && (round.hypothesis.country || round.hypothesis.city || round.hypothesis.evidenceNotes) && (
              <div className="bg-tactical-bg/50 rounded p-3 space-y-1">
                <div className="text-[10px] text-tactical-amber uppercase tracking-wider font-semibold">
                  Hypothesis
                </div>
                {round.hypothesis.country && (
                  <div className="text-xs">
                    <span className="text-tactical-muted">Country:</span>{' '}
                    <span className="text-slate-300">{round.hypothesis.country}</span>
                  </div>
                )}
                {round.hypothesis.city && (
                  <div className="text-xs">
                    <span className="text-tactical-muted">City:</span>{' '}
                    <span className="text-slate-300">{round.hypothesis.city}</span>
                  </div>
                )}
                {round.hypothesis.landmark && (
                  <div className="text-xs">
                    <span className="text-tactical-muted">Landmark:</span>{' '}
                    <span className="text-slate-300">{round.hypothesis.landmark}</span>
                  </div>
                )}
                <div className="text-xs">
                  <span className="text-tactical-muted">Confidence:</span>{' '}
                  <span className="text-tactical-amber">{round.hypothesis.confidence}/5</span>
                </div>
                {round.hypothesis.evidenceNotes && (
                  <div className="text-xs text-slate-400 mt-1 italic">
                    {round.hypothesis.evidenceNotes}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Actions */}
        <div className="flex justify-center gap-4">
          <Link href="/history" className="btn-secondary text-sm">
            Back to History
          </Link>
          <Link href="/" className="btn-primary text-sm">
            New Session
          </Link>
        </div>
      </div>
    </div>
  );
}

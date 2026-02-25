'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DEFAULTS } from '@/utils/constants';
import { getSessions } from '@/lib/session-storage';
import { formatScore, formatDate } from '@/utils/formatters';
import type { GameSession } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState('');
  const [roundCount, setRoundCount] = useState<number>(DEFAULTS.ROUND_COUNT);
  const [recentSessions, setRecentSessions] = useState<GameSession[]>([]);

  useEffect(() => {
    setRecentSessions(getSessions().slice(0, 3));
  }, []);

  const handleStart = () => {
    if (!playerName.trim()) return;
    const params = new URLSearchParams({
      player: playerName.trim(),
      rounds: roundCount.toString(),
    });
    router.push(`/game?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-tactical-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">
            GeoINT Trainer
          </h1>
          <p className="text-tactical-muted text-sm">
            OSINT Geolocation Training Platform
          </p>
          <div className="w-16 h-px bg-tactical-green mx-auto mt-4" />
        </div>

        {/* Setup form */}
        <div className="card space-y-5">
          {/* Player name */}
          <div>
            <label className="block text-xs text-tactical-muted uppercase tracking-wider mb-1.5">
              Call Sign
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your alias"
              maxLength={30}
              className="input-field w-full"
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
              autoFocus
            />
          </div>

          {/* Round count */}
          <div>
            <label className="block text-xs text-tactical-muted uppercase tracking-wider mb-1.5">
              Rounds: {roundCount}
            </label>
            <input
              type="range"
              min={DEFAULTS.MIN_ROUNDS}
              max={DEFAULTS.MAX_ROUNDS}
              value={roundCount}
              onChange={(e) => setRoundCount(parseInt(e.target.value))}
              className="w-full accent-tactical-green"
            />
            <div className="flex justify-between text-[10px] text-tactical-muted mt-0.5">
              <span>{DEFAULTS.MIN_ROUNDS}</span>
              <span>{DEFAULTS.MAX_ROUNDS}</span>
            </div>
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={!playerName.trim()}
            className="btn-primary w-full text-base"
          >
            Begin Training
          </button>
        </div>

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-tactical-muted uppercase tracking-wider">Recent Sessions</span>
              <Link href="/history" className="text-xs text-tactical-green hover:underline">
                View All
              </Link>
            </div>
            {recentSessions.map((s) => {
              const score = s.rounds.reduce((sum, r) => sum + r.score, 0);
              return (
                <Link
                  key={s.id}
                  href={`/history/${s.id}`}
                  className="block bg-tactical-surface border border-tactical-border rounded px-3 py-2 hover:border-tactical-green/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">{s.playerName}</span>
                    <span className="text-xs font-mono text-tactical-green">{formatScore(score)}</span>
                  </div>
                  <div className="text-[10px] text-tactical-muted mt-0.5">
                    {formatDate(s.startedAt)} &middot; {s.rounds.length} rounds
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[11px] text-tactical-muted/60">
          Develop geolocation analysis skills through structured hypothesis-driven practice
        </p>
      </div>
    </div>
  );
}

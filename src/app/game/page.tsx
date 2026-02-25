'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useGameSession } from '@/hooks/useGameSession';
import GameLayout from '@/components/GameLayout';
import StreetViewCanvas from '@/components/StreetViewCanvas';
import GuessMap from '@/components/GuessMap';
import HypothesisPanel from '@/components/HypothesisPanel';
import AIAssistantPanel from '@/components/AIAssistantPanel';
import RoundResult from '@/components/RoundResult';
import SessionSummary from '@/components/SessionSummary';
import type { Coordinate } from '@/lib/types';
import { formatScore } from '@/utils/formatters';
import { DEFAULTS } from '@/utils/constants';

function GameContent() {
  const searchParams = useSearchParams();
  const {
    session,
    startSession,
    updateHypothesis,
    submitGuess,
    revealResult,
    nextRound,
    completeSession,
    markAIUsed,
    retryLocation,
    totalScore,
  } = useGameSession();
  const [hasGuessed, setHasGuessed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'hypothesis' | 'ai'>('hypothesis');
  const [aiUsedThisRound, setAiUsedThisRound] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Start session from URL params on mount
  useEffect(() => {
    const player = searchParams.get('player') || 'Anonymous';
    const rounds = parseInt(searchParams.get('rounds') || String(DEFAULTS.ROUND_COUNT));
    startSession(player, rounds);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state on new round
  useEffect(() => {
    if (session.phase === 'playing') {
      setHasGuessed(false);
      setAiUsedThisRound(false);
      setSidebarTab('hypothesis');
    }
  }, [session.phase, session.currentRound]);

  const handleGuess = useCallback((position: Coordinate) => {
    if (session.phase !== 'playing' && session.phase !== 'guessed') return;
    submitGuess(position);
    setHasGuessed(true);
  }, [session.phase, submitGuess]);

  const handleConfirmGuess = () => {
    revealResult();
  };

  const handleNextRound = () => {
    setCountdown(5);
  };

  // Countdown timer effect
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      nextRound();
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, nextRound]);

  const handleNewSession = () => {
    window.location.href = '/';
  };

  const handleAIUsed = () => {
    setAiUsedThisRound(true);
    markAIUsed();
  };

  // Session complete — show summary
  if (session.phase === 'complete') {
    return (
      <SessionSummary
        session={session}
        totalScore={totalScore}
        onNewSession={handleNewSession}
      />
    );
  }

  // Not yet started
  if (session.phase === 'idle') {
    return (
      <div className="min-h-screen bg-tactical-bg flex items-center justify-center">
        <div className="text-tactical-muted font-mono text-sm">Initializing session...</div>
      </div>
    );
  }

  const lastRound = session.rounds[session.rounds.length - 1];
  const isPlaying = session.phase === 'playing';
  const isGuessed = session.phase === 'guessed';
  const isRevealed = session.phase === 'revealed';

  return (
    <>
    {/* Countdown overlay */}
    {countdown !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-tactical-bg/90 backdrop-blur-sm">
        <div className="text-center">
          {countdown > 0 ? (
            <div
              key={countdown}
              className="text-8xl font-black font-mono text-tactical-green animate-countdown-ping"
            >
              {countdown}
            </div>
          ) : (
            <div className="text-7xl font-black font-mono text-tactical-green animate-countdown-ping">
              GO
            </div>
          )}
          <div className="mt-4 text-sm text-tactical-muted font-mono">
            Round {session.currentRound + 1}/{session.totalRounds}
          </div>
        </div>
      </div>
    )}
    <GameLayout
      header={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-slate-200">GeoINT</span>
            <span className="text-xs text-tactical-muted font-mono">
              Round {session.currentRound}/{session.totalRounds}
            </span>
            {aiUsedThisRound && (
              <span className="text-[10px] text-tactical-blue font-mono bg-tactical-blue/10 px-1.5 py-0.5 rounded">
                AI
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-tactical-muted">
              Score: <span className="text-tactical-green font-mono">{formatScore(totalScore)}</span>
            </span>
            <span className="text-xs text-tactical-muted">
              {session.playerName}
            </span>
          </div>
        </div>
      }
      panorama={
        <div className="w-full h-full flex flex-col">
          {/* Street View panorama */}
          <div className="flex-1 relative bg-tactical-bg border-b border-tactical-border min-h-0">
            {session.currentLocation ? (
              <StreetViewCanvas
                key={`sv-round-${session.currentRound}-${session.currentLocation.lat}-${session.currentLocation.lng}`}
                location={session.currentLocation}
                onError={retryLocation}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-tactical-green border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <div className="text-tactical-muted font-mono text-xs">Loading location...</div>
                </div>
              </div>
            )}
          </div>

          {/* Guess map */}
          <div className="h-[250px] shrink-0 p-2">
            <GuessMap
              key={`map-round-${session.currentRound}`}
              onGuess={handleGuess}
              disabled={!isPlaying && !isGuessed}
              guessPosition={session.currentGuess?.position}
              actualPosition={session.currentLocation}
              showResult={isRevealed}
            />
          </div>

          {/* Confirm guess button */}
          {hasGuessed && isGuessed && (
            <div className="shrink-0 p-2 pt-0">
              <button onClick={handleConfirmGuess} className="btn-primary w-full">
                Confirm Guess
              </button>
            </div>
          )}
        </div>
      }
      sidebar={
        <div className="h-full flex flex-col">
          {/* Sidebar tabs (only when playing/guessed) */}
          {(isPlaying || isGuessed) && (
            <div className="flex border-b border-tactical-border shrink-0">
              <button
                onClick={() => setSidebarTab('hypothesis')}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'hypothesis'
                    ? 'text-tactical-amber border-b-2 border-tactical-amber'
                    : 'text-tactical-muted hover:text-slate-300'
                }`}
              >
                Hypothesis
              </button>
              <button
                onClick={() => setSidebarTab('ai')}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'ai'
                    ? 'text-tactical-blue border-b-2 border-tactical-blue'
                    : 'text-tactical-muted hover:text-slate-300'
                }`}
              >
                AI Analysis
              </button>
            </div>
          )}

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto">
            {isRevealed && lastRound ? (
              <RoundResult
                result={lastRound}
                onNextRound={handleNextRound}
                onFinish={completeSession}
                isLastRound={session.currentRound >= session.totalRounds}
              />
            ) : isGuessed ? (
              <>
                {sidebarTab === 'hypothesis' ? (
                  <HypothesisPanel
                    onUpdate={updateHypothesis}
                    roundNumber={session.currentRound}
                    disabled
                  />
                ) : (
                  <AIAssistantPanel
                    location={session.currentLocation}
                    disabled
                  />
                )}
                <div className="p-4 pt-0">
                  <div className="text-xs text-tactical-muted text-center">
                    Confirm your guess to see results
                  </div>
                </div>
              </>
            ) : sidebarTab === 'hypothesis' ? (
              <HypothesisPanel
                onUpdate={updateHypothesis}
                roundNumber={session.currentRound}
              />
            ) : (
              <AIAssistantPanel
                location={session.currentLocation}
                onAnalysisUsed={handleAIUsed}
              />
            )}
          </div>
        </div>
      }
    />
    </>
  );
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-tactical-bg flex items-center justify-center">
          <div className="text-tactical-muted font-mono text-sm">Loading...</div>
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}

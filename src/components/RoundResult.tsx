'use client';

import type { RoundResult as RoundResultType } from '@/lib/types';
import { formatDistance } from '@/utils/formatters';
import ScoreAnimation from './ScoreAnimation';

interface RoundResultProps {
  result: RoundResultType;
  onNextRound?: () => void;
  onFinish?: () => void;
  isLastRound: boolean;
}

export default function RoundResult({ result, onNextRound, onFinish, isLastRound }: RoundResultProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Animated score display */}
      <ScoreAnimation
        score={result.score}
        distanceKm={result.distanceKm}
        category={result.category}
      />

      {/* Distance */}
      <div className="card">
        <div className="text-xs text-tactical-muted uppercase tracking-wider mb-1">Distance</div>
        <div className="text-xl font-mono text-slate-200">
          {formatDistance(result.distanceKm)}
        </div>
      </div>

      {/* Coordinates comparison */}
      <div className="card space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-tactical-amber" />
          <span className="text-xs text-tactical-muted">Your guess:</span>
          <span className="text-xs font-mono text-slate-300 ml-auto">
            {result.guess.lat.toFixed(4)}°, {result.guess.lng.toFixed(4)}°
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-tactical-green" />
          <span className="text-xs text-tactical-muted">Actual:</span>
          <span className="text-xs font-mono text-slate-300 ml-auto">
            {result.actual.lat.toFixed(4)}°, {result.actual.lng.toFixed(4)}°
          </span>
        </div>
      </div>

      {/* Hypothesis recap */}
      {result.hypothesis && (result.hypothesis.country || result.hypothesis.city) && (
        <div className="card">
          <div className="text-xs text-tactical-muted uppercase tracking-wider mb-2">Your Hypothesis</div>
          {result.hypothesis.country && (
            <div className="text-sm">
              <span className="text-tactical-muted">Country:</span>{' '}
              <span className="text-slate-300">{result.hypothesis.country}</span>
            </div>
          )}
          {result.hypothesis.city && (
            <div className="text-sm">
              <span className="text-tactical-muted">City:</span>{' '}
              <span className="text-slate-300">{result.hypothesis.city}</span>
            </div>
          )}
          {result.hypothesis.landmark && (
            <div className="text-sm">
              <span className="text-tactical-muted">Landmark:</span>{' '}
              <span className="text-slate-300">{result.hypothesis.landmark}</span>
            </div>
          )}
          <div className="text-sm mt-1">
            <span className="text-tactical-muted">Confidence:</span>{' '}
            <span className="text-tactical-amber">{result.hypothesis.confidence}/5</span>
          </div>
        </div>
      )}

      {/* Action button */}
      <button
        onClick={isLastRound ? onFinish : onNextRound}
        className="btn-primary w-full"
      >
        {isLastRound ? 'View Session Summary' : 'Next Round'}
      </button>
    </div>
  );
}

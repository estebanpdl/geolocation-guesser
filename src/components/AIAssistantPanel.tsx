'use client';

import { useState, useCallback } from 'react';
import { AnalysisRequestError, requestAnalysis, TRAINING_SESSION_REQUIRED } from '@/lib/api-client';
import { useAnalysisTarget } from '@/hooks/useAnalysisCatalog';
import type { Coordinate } from '@/lib/types';
import AnalysisSections from './AnalysisSections';
import type { AnalysisResult } from './AnalysisSections';
import ParticipantKeyField from './ParticipantKeyField';
import TrainingAccessLink from './TrainingAccessLink';

interface AIAssistantPanelProps {
  location: Coordinate | null;
  disabled?: boolean;
  onAnalysisUsed?: () => void;
}

export default function AIAssistantPanel({ location, disabled = false, onAnalysisUsed }: AIAssistantPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const { selection, provider } = useAnalysisTarget();

  const handleAnalyze = useCallback(async () => {
    if (!location || loading || disabled) return;

    setLoading(true);
    setError(null);
    setNeedsAccess(false);

    try {
      const result = await requestAnalysis(
        '/api/ai-analysis',
        { lat: location.lat, lng: location.lng, heading: 0, pitch: 0 },
        selection
      );
      setAnalysis(result.analysis);
      onAnalysisUsed?.();
    } catch (err) {
      setNeedsAccess(err instanceof AnalysisRequestError && err.code === TRAINING_SESSION_REQUIRED);
      setError(err instanceof Error ? err.message : 'Analysis unavailable');
    } finally {
      setLoading(false);
    }
  }, [location, loading, disabled, onAnalysisUsed, selection]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-tactical-blue" />
        <h3 className="text-sm font-semibold text-tactical-blue uppercase tracking-wider">
          AI Analysis
        </h3>
      </div>

      {provider && !analysis && <ParticipantKeyField provider={provider} disabled={loading || disabled} />}

      {!analysis && !loading && !error && (
        <button
          onClick={handleAnalyze}
          disabled={disabled || !location}
          className="w-full py-3 px-4 rounded border border-tactical-blue/30 bg-tactical-blue/5
                     text-tactical-blue text-sm font-medium
                     hover:bg-tactical-blue/10 hover:border-tactical-blue/50
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          Analyze Scene
        </button>
      )}

      <AnalysisSections
        analysis={analysis}
        loading={loading}
        error={error}
        onRetry={handleAnalyze}
        onClear={() => {
          setAnalysis(null);
          setError(null);
        }}
      />

      {needsAccess && error && <TrainingAccessLink />}
    </div>
  );
}

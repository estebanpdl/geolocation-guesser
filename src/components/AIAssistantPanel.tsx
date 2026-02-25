'use client';

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Coordinate } from '@/lib/types';

interface AnalysisResult {
  textAndSigns: string;
  landmarksAndBuildings: string;
  roadAndInfrastructure: string;
  vehiclesAndPlates: string;
  vegetationAndTerrain: string;
  culturalIndicators: string;
  overallAssessment: string;
}

interface AIAssistantPanelProps {
  location: Coordinate | null;
  disabled?: boolean;
  onAnalysisUsed?: () => void;
}

const SECTIONS: { key: keyof AnalysisResult; label: string; icon: string }[] = [
  { key: 'textAndSigns', label: 'Text & Signs', icon: 'Aa' },
  { key: 'landmarksAndBuildings', label: 'Landmarks & Buildings', icon: '#' },
  { key: 'roadAndInfrastructure', label: 'Road & Infrastructure', icon: '=' },
  { key: 'vehiclesAndPlates', label: 'Vehicles & Plates', icon: '[]' },
  { key: 'vegetationAndTerrain', label: 'Vegetation & Terrain', icon: '~' },
  { key: 'culturalIndicators', label: 'Cultural Indicators', icon: '*' },
  { key: 'overallAssessment', label: 'Overall Assessment', icon: '>' },
];

export default function AIAssistantPanel({ location, disabled = false, onAnalysisUsed }: AIAssistantPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overallAssessment']));

  const handleAnalyze = useCallback(async () => {
    if (!location || loading || disabled) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: location.lat,
          lng: location.lng,
          heading: 0,
          pitch: 0,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Analysis failed');
      }

      const data = await res.json();
      setAnalysis(data.analysis);
      setExpandedSections(new Set(['overallAssessment', 'textAndSigns']));
      onAnalysisUsed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis unavailable');
    } finally {
      setLoading(false);
    }
  }, [location, loading, disabled, onAnalysisUsed]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-tactical-blue" />
        <h3 className="text-sm font-semibold text-tactical-blue uppercase tracking-wider">
          AI Analysis
        </h3>
      </div>

      {!analysis && !loading && (
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

      {loading && (
        <div className="space-y-3">
          {SECTIONS.map((section) => (
            <div key={section.key} className="animate-pulse">
              <div className="h-4 bg-tactical-border rounded w-1/3 mb-2" />
              <div className="h-3 bg-tactical-border/50 rounded w-full mb-1" />
              <div className="h-3 bg-tactical-border/50 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-3 rounded bg-tactical-red/10 border border-tactical-red/30">
          <div className="text-xs text-tactical-red font-mono">{error}</div>
          <button
            onClick={handleAnalyze}
            className="text-xs text-tactical-muted hover:text-tactical-red mt-2 underline"
          >
            Retry
          </button>
        </div>
      )}

      {analysis && (
        <div className="space-y-1">
          {SECTIONS.map((section) => {
            const content = analysis[section.key];
            const isExpanded = expandedSections.has(section.key);
            const isAssessment = section.key === 'overallAssessment';

            return (
              <div
                key={section.key}
                className={`rounded border transition-colors ${
                  isAssessment
                    ? 'border-tactical-green/30 bg-tactical-green/5'
                    : 'border-tactical-border bg-tactical-bg/50'
                }`}
              >
                <button
                  onClick={() => toggleSection(section.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="text-[10px] font-mono text-tactical-muted w-5 shrink-0">
                    {section.icon}
                  </span>
                  <span className={`text-xs font-medium flex-1 ${
                    isAssessment ? 'text-tactical-green' : 'text-slate-300'
                  }`}>
                    {section.label}
                  </span>
                  <span className="text-tactical-muted text-[10px]">
                    {isExpanded ? '−' : '+'}
                  </span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0">
                    <div className="text-xs text-slate-400 leading-relaxed prose-tactical">
                      <ReactMarkdown>{content}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={() => {
              setAnalysis(null);
              setError(null);
            }}
            className="text-[10px] text-tactical-muted hover:text-slate-400 mt-2"
          >
            Clear analysis
          </button>
        </div>
      )}
    </div>
  );
}

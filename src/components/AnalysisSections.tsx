'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ANALYSIS_FIELDS, type Analysis, type AnalysisField } from '@/lib/analysis/contract';

/** The analysis shape shared with the server contract. */
export type AnalysisResult = Analysis;

const ICONS: Record<AnalysisField, string> = {
  textAndSigns: 'Aa',
  landmarksAndBuildings: '#',
  roadAndInfrastructure: '=',
  vehiclesAndPlates: '[]',
  vegetationAndTerrain: '~',
  culturalIndicators: '*',
  overallAssessment: '>',
};

const SECTIONS = ANALYSIS_FIELDS.map(({ key, label }) => ({ key, label, icon: ICONS[key] }));

interface AnalysisSectionsProps {
  analysis: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onClear?: () => void;
}

export default function AnalysisSections({ analysis, loading, error, onRetry, onClear }: AnalysisSectionsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overallAssessment', 'textAndSigns']));

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

  if (loading) {
    return (
      <div className="space-y-3">
        {SECTIONS.map((section) => (
          <div key={section.key} className="animate-pulse">
            <div className="h-4 bg-tactical-border rounded w-1/3 mb-2" />
            <div className="h-3 bg-tactical-border/50 rounded w-full mb-1" />
            <div className="h-3 bg-tactical-border/50 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 rounded bg-tactical-red/10 border border-tactical-red/30">
        <div className="text-xs text-tactical-red font-mono">{error}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs text-tactical-muted hover:text-tactical-red mt-2 underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!analysis) return null;

  return (
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

      {onClear && (
        <button
          onClick={onClear}
          className="text-[10px] text-tactical-muted hover:text-slate-400 mt-2"
        >
          Clear analysis
        </button>
      )}
    </div>
  );
}

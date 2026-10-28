'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import PhotoDropZone from '@/components/PhotoDropZone';
import AnalysisSections from '@/components/AnalysisSections';
import type { AnalysisResult } from '@/components/AnalysisSections';
import ParticipantKeyField from '@/components/ParticipantKeyField';
import TrainingAccessLink from '@/components/TrainingAccessLink';
import TrainingNavLink from '@/components/TrainingNavLink';
import { useAnalysisTarget } from '@/hooks/useAnalysisCatalog';
import { AnalysisRequestError, requestAnalysis, TRAINING_SESSION_REQUIRED } from '@/lib/api-client';

interface ImageData {
  base64: string;
  mimeType: string;
  fileName: string;
}

export default function AnalyzePage() {
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const { selection, provider } = useAnalysisTarget();

  const handleImageSelected = useCallback((base64: string, mimeType: string, fileName: string) => {
    setImageData({ base64, mimeType, fileName });
    setPreviewUrl(`data:${mimeType};base64,${base64}`);
    setAnalysis(null);
    setError(null);
  }, []);

  const handleClear = useCallback(() => {
    setImageData(null);
    setPreviewUrl(null);
    setAnalysis(null);
    setError(null);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!imageData || loading) return;

    setLoading(true);
    setError(null);
    setNeedsAccess(false);

    try {
      const result = await requestAnalysis(
        '/api/ai-analysis-upload',
        { image: imageData.base64, mimeType: imageData.mimeType },
        selection
      );
      setAnalysis(result.analysis);
    } catch (err) {
      setNeedsAccess(err instanceof AnalysisRequestError && err.code === TRAINING_SESSION_REQUIRED);
      setError(err instanceof Error ? err.message : 'Analysis unavailable');
    } finally {
      setLoading(false);
    }
  }, [imageData, loading, selection]);

  return (
    <div className="min-h-screen bg-tactical-bg">
      {/* Header */}
      <header className="border-b border-tactical-border bg-tactical-surface">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center gap-3">
          <Link href="/" className="text-sm font-bold text-slate-100 hover:text-tactical-green transition-colors">
            GeoINT Trainer
          </Link>
          <span className="text-tactical-muted">/</span>
          <span className="text-xs text-tactical-muted uppercase tracking-wider">Photo Analysis</span>
          <TrainingNavLink newTab className="ml-auto" />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto p-4 pt-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column — upload */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-tactical-blue" />
              <h2 className="text-sm font-semibold text-tactical-blue uppercase tracking-wider">
                Upload Image
              </h2>
            </div>

            <PhotoDropZone
              onImageSelected={handleImageSelected}
              disabled={loading}
              currentPreview={previewUrl}
              onClear={handleClear}
            />

            {provider && <ParticipantKeyField provider={provider} disabled={loading} />}

            {imageData && !loading && (
              <button
                onClick={handleAnalyze}
                className="w-full py-3 px-4 rounded border border-tactical-green/30 bg-tactical-green/5
                           text-tactical-green text-sm font-medium
                           hover:bg-tactical-green/10 hover:border-tactical-green/50
                           transition-colors"
              >
                {analysis ? 'Re-analyze Photo' : 'Analyze Photo'}
              </button>
            )}
          </div>

          {/* Right column — results */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-tactical-green" />
              <h2 className="text-sm font-semibold text-tactical-green uppercase tracking-wider">
                Analysis
              </h2>
            </div>

            {!analysis && !loading && !error && (
              <div className="flex items-center justify-center h-48 rounded border border-dashed border-tactical-border">
                <p className="text-xs text-tactical-muted">
                  Upload a photo and click &ldquo;Analyze Photo&rdquo; to begin
                </p>
              </div>
            )}

            <AnalysisSections
              analysis={analysis}
              loading={loading}
              error={error}
              onRetry={handleAnalyze}
              onClear={() => setAnalysis(null)}
            />

            {needsAccess && error && <TrainingAccessLink />}
          </div>
        </div>
      </main>
    </div>
  );
}

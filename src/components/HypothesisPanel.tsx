'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Hypothesis } from '@/lib/types';
import { DEFAULTS } from '@/utils/constants';

interface HypothesisPanelProps {
  onUpdate: (hypothesis: Hypothesis) => void;
  roundNumber: number;
  disabled?: boolean;
}

const STORAGE_KEY = 'geoint_current_hypothesis';

const emptyHypothesis: Hypothesis = {
  country: '',
  city: '',
  landmark: '',
  confidence: 3,
  evidenceNotes: '',
};

export default function HypothesisPanel({ onUpdate, roundNumber, disabled = false }: HypothesisPanelProps) {
  const [hypothesis, setHypothesis] = useState<Hypothesis>(emptyHypothesis);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.roundNumber === roundNumber) {
          setHypothesis(parsed.hypothesis);
          onUpdate(parsed.hypothesis);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // ignore parse errors
    }
  }, [roundNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave to localStorage
  const saveAndUpdate = useCallback(
    (updated: Hypothesis) => {
      setHypothesis(updated);
      onUpdate(updated);
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ roundNumber, hypothesis: updated })
        );
      } catch {
        // storage full — ignore
      }
    },
    [onUpdate, roundNumber]
  );

  const handleChange = useCallback(
    (field: keyof Hypothesis, value: string | number) => {
      saveAndUpdate({ ...hypothesis, [field]: value });
    },
    [hypothesis, saveAndUpdate]
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-tactical-amber" />
        <h3 className="text-sm font-semibold text-tactical-amber uppercase tracking-wider">
          Hypothesis
        </h3>
        <span className="text-xs text-tactical-muted ml-auto">Optional</span>
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-xs text-tactical-muted mb-1">Country</label>
          <input
            type="text"
            value={hypothesis.country}
            onChange={(e) => handleChange('country', e.target.value)}
            disabled={disabled}
            placeholder="e.g., France"
            className="input-field w-full text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-tactical-muted mb-1">City</label>
          <input
            type="text"
            value={hypothesis.city}
            onChange={(e) => handleChange('city', e.target.value)}
            disabled={disabled}
            placeholder="e.g., Paris"
            className="input-field w-full text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-tactical-muted mb-1">Landmark</label>
          <input
            type="text"
            value={hypothesis.landmark}
            onChange={(e) => handleChange('landmark', e.target.value)}
            disabled={disabled}
            placeholder="e.g., Eiffel Tower"
            className="input-field w-full text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-tactical-muted mb-1">
            Confidence: {hypothesis.confidence}/{DEFAULTS.CONFIDENCE_MAX}
          </label>
          <input
            type="range"
            min={DEFAULTS.CONFIDENCE_MIN}
            max={DEFAULTS.CONFIDENCE_MAX}
            value={hypothesis.confidence}
            onChange={(e) => handleChange('confidence', parseInt(e.target.value))}
            disabled={disabled}
            className="w-full accent-tactical-amber"
          />
          <div className="flex justify-between text-[10px] text-tactical-muted">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-tactical-muted mb-1">Evidence Notes</label>
          <textarea
            value={hypothesis.evidenceNotes}
            onChange={(e) => handleChange('evidenceNotes', e.target.value)}
            disabled={disabled}
            placeholder="What clues did you observe? Road signs, language, architecture, vegetation..."
            rows={3}
            className="input-field w-full text-sm resize-none"
          />
        </div>
      </div>
    </div>
  );
}

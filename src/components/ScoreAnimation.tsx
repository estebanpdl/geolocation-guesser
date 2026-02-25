'use client';

import { useState, useEffect } from 'react';
import type { AccuracyCategory } from '@/lib/types';

interface ScoreAnimationProps {
  score: number;
  distanceKm: number;
  category: AccuracyCategory;
  onComplete?: () => void;
}

const categoryConfig: Record<AccuracyCategory, { color: string; bg: string }> = {
  Excellent: { color: 'text-tactical-green', bg: 'bg-tactical-green/10' },
  Good: { color: 'text-tactical-green/80', bg: 'bg-tactical-green/5' },
  Fair: { color: 'text-tactical-amber', bg: 'bg-tactical-amber/10' },
  Poor: { color: 'text-tactical-red', bg: 'bg-tactical-red/10' },
};

export default function ScoreAnimation({ score, category, onComplete }: ScoreAnimationProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const [showCategory, setShowCategory] = useState(false);

  useEffect(() => {
    const duration = 1200;
    const steps = 30;
    const increment = score / steps;
    let current = 0;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      // Ease-out curve
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      current = Math.round(score * eased);
      setDisplayScore(Math.min(current, score));

      if (step >= steps) {
        clearInterval(interval);
        setDisplayScore(score);
        setTimeout(() => {
          setShowCategory(true);
          onComplete?.();
        }, 200);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [score, onComplete]);

  const config = categoryConfig[category];

  return (
    <div className={`text-center py-6 rounded-lg ${config.bg} transition-all duration-500`}>
      <div className={`text-5xl font-bold font-mono ${config.color} transition-all`}>
        {displayScore.toLocaleString()}
      </div>
      <div className="text-sm text-tactical-muted mt-1">points</div>
      <div
        className={`text-lg font-semibold mt-2 ${config.color} transition-all duration-300 ${
          showCategory ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        {category}
      </div>
    </div>
  );
}

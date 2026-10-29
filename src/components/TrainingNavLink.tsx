'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchTrainingMode } from '@/lib/api-client';

interface TrainingNavLinkProps {
  /** Open in a new tab, so a round in progress or an uploaded photo is kept. */
  newTab?: boolean;
  className?: string;
}

/** Header entry to the training access page, shown only while training is open. */
export default function TrainingNavLink({ newTab = false, className = '' }: TrainingNavLinkProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchTrainingMode().then((mode) => {
      if (active) setOpen(mode === 'open');
    });
    return () => {
      active = false;
    };
  }, []);

  if (!open) return null;
  return (
    <Link
      href="/training"
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      className={`text-xs text-tactical-blue hover:underline ${className}`}
    >
      Training access
    </Link>
  );
}

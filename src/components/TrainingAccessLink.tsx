import Link from 'next/link';

/** Opens code entry in a new tab so the current round or uploaded photo is kept. */
export default function TrainingAccessLink() {
  return (
    <Link
      href="/training"
      target="_blank"
      rel="noopener"
      className="block text-xs text-tactical-blue hover:underline"
    >
      Enter the training access code (opens a new tab), then retry
    </Link>
  );
}

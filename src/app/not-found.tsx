import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-tactical-bg flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl font-bold font-mono text-tactical-muted/20 mb-4">404</div>
        <div className="text-sm text-tactical-muted mb-6">Location not found</div>
        <Link href="/" className="btn-primary text-sm">
          Return to Base
        </Link>
      </div>
    </div>
  );
}

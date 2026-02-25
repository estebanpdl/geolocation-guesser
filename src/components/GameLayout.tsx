'use client';

import { ReactNode } from 'react';

interface GameLayoutProps {
  panorama: ReactNode;
  sidebar: ReactNode;
  header: ReactNode;
}

export default function GameLayout({ panorama, sidebar, header }: GameLayoutProps) {
  return (
    <div className="h-screen flex flex-col bg-tactical-bg">
      {/* Header bar */}
      <div className="shrink-0 border-b border-tactical-border bg-tactical-surface px-4 py-2">
        {header}
      </div>

      {/* Main content: panorama + sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Panorama area */}
        <div className="flex-1 min-w-0 relative">
          {panorama}
        </div>

        {/* Sidebar */}
        <div className="w-[400px] shrink-0 border-l border-tactical-border bg-tactical-surface overflow-y-auto">
          {sidebar}
        </div>
      </div>
    </div>
  );
}

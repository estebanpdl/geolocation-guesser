'use client';

import { useRef, useEffect, useState } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import type { Coordinate } from '@/lib/types';

interface StreetViewCanvasProps {
  location: Coordinate;
  onPanoramaChange?: (heading: number, pitch: number) => void;
  /** Called when no panorama can be loaded — lets the game request a new location. */
  onError?: () => void;
}

export default function StreetViewCanvas({ location, onPanoramaChange, onError }: StreetViewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const { isLoaded, error } = useGoogleMaps();
  const [isLoading, setIsLoading] = useState(true);
  const [svError, setSvError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !containerRef.current) return;

    let cancelled = false;

    setIsLoading(true);
    setSvError(null);

    const sv = new google.maps.StreetViewService();

    sv.getPanorama(
      {
        location: { lat: location.lat, lng: location.lng },
        // Resolve imagery near the candidate coordinate; the pool does not guarantee availability.
        radius: 1000,
      },
      (data, status) => {
        if (cancelled) return;

        if (status === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
          if (!containerRef.current) return;

          // Clean up previous instance before creating new one
          if (panoramaRef.current) {
            google.maps.event.clearInstanceListeners(panoramaRef.current);
            panoramaRef.current.setVisible(false);
            panoramaRef.current = null;
          }

          panoramaRef.current = new google.maps.StreetViewPanorama(
            containerRef.current,
            {
              position: data.location.latLng,
              pov: { heading: 0, pitch: 0 },
              zoom: 1,
              addressControl: false,
              showRoadLabels: false,
              motionTracking: false,
              motionTrackingControl: false,
            }
          );

          if (onPanoramaChange) {
            panoramaRef.current.addListener('pov_changed', () => {
              const pov = panoramaRef.current?.getPov();
              if (pov) {
                onPanoramaChange(pov.heading, pov.pitch);
              }
            });
          }

          setIsLoading(false);
        } else {
          setSvError('Retrying...');
          setIsLoading(false);
          onError?.();
          setTimeout(() => {
            if (!cancelled) {
              setSvError((prev) => prev === 'Retrying...' ? 'No panorama found — place your best guess using the map below' : prev);
            }
          }, 5000);
        }
      }
    );

    // Cleanup: hide panorama and clear listeners on unmount
    return () => {
      cancelled = true;
      if (panoramaRef.current) {
        google.maps.event.clearInstanceListeners(panoramaRef.current);
        panoramaRef.current.setVisible(false);
        panoramaRef.current = null;
      }
    };
  }, [isLoaded, location.lat, location.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-tactical-bg">
        <div className="text-center">
          <div className="text-tactical-red text-sm font-mono mb-2">Maps Error</div>
          <div className="text-tactical-muted text-xs max-w-xs">{error}</div>
        </div>
      </div>
    );
  }

  if (svError) {
    const isRetrying = svError === 'Retrying...';
    return (
      <div className="w-full h-full flex items-center justify-center bg-tactical-bg">
        <div className="text-center">
          {isRetrying ? (
            <>
              <div className="w-8 h-8 border-2 border-tactical-green border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <div className="text-tactical-muted text-xs font-mono">Finding new location...</div>
            </>
          ) : (
            <div className="text-tactical-muted text-xs font-mono px-4">{svError}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-tactical-bg z-10">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-tactical-green border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <div className="text-tactical-muted text-xs font-mono">Loading panorama...</div>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import type { Coordinate } from '@/lib/types';
import { MAP_DEFAULTS } from '@/utils/constants';

interface GuessMapProps {
  onGuess: (position: Coordinate) => void;
  disabled?: boolean;
  guessPosition?: Coordinate | null;
  actualPosition?: Coordinate | null;
  showResult?: boolean;
}

export default function GuessMap({
  onGuess,
  disabled = false,
  guessPosition = null,
  actualPosition = null,
  showResult = false,
}: GuessMapProps) {
  const { isLoaded, error } = useGoogleMaps();

  if (isLoaded && !error) {
    return (
      <GoogleGuessMap
        onGuess={onGuess}
        disabled={disabled}
        guessPosition={guessPosition}
        actualPosition={actualPosition}
        showResult={showResult}
      />
    );
  }

  return (
    <FallbackGuessMap
      onGuess={onGuess}
      disabled={disabled}
      guessPosition={guessPosition}
      actualPosition={actualPosition}
      showResult={showResult}
    />
  );
}

// ─── Google Maps Implementation ───────────────────────────────────────────────

function GoogleGuessMap({
  onGuess,
  disabled,
  guessPosition,
  actualPosition,
  showResult,
}: GuessMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const guessMarkerRef = useRef<google.maps.Marker | null>(null);
  const actualMarkerRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = new google.maps.Map(containerRef.current, {
      center: MAP_DEFAULTS.CENTER,
      zoom: MAP_DEFAULTS.ZOOM,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1a2235' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a2235' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8896b0' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1525' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a6080' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3a52' }] },
        { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7a8ba0' }] },
        { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#162030' }] },
        { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3a4f6a' }] },
        { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#8896b0' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4a6080' }] },
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      ],
    });

    return () => {
      mapRef.current = null;
    };
  }, []);

  // Click handler
  useEffect(() => {
    if (!mapRef.current) return;

    const listener = mapRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (disabled || !e.latLng) return;
      const coord: Coordinate = {
        lat: parseFloat(e.latLng.lat().toFixed(4)),
        lng: parseFloat(e.latLng.lng().toFixed(4)),
      };
      onGuess(coord);
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [disabled, onGuess]);

  // Update guess marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (guessMarkerRef.current) {
      guessMarkerRef.current.setMap(null);
      guessMarkerRef.current = null;
    }

    if (guessPosition) {
      guessMarkerRef.current = new google.maps.Marker({
        position: guessPosition,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#f59e0b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        title: 'Your guess',
      });
    }
  }, [guessPosition]);

  // Show result (actual marker + line)
  useEffect(() => {
    if (!mapRef.current) return;

    // Clean up previous
    if (actualMarkerRef.current) {
      actualMarkerRef.current.setMap(null);
      actualMarkerRef.current = null;
    }
    if (lineRef.current) {
      lineRef.current.setMap(null);
      lineRef.current = null;
    }

    if (showResult && actualPosition) {
      actualMarkerRef.current = new google.maps.Marker({
        position: actualPosition,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#22c55e',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        title: 'Actual location',
      });

      if (guessPosition) {
        lineRef.current = new google.maps.Polyline({
          path: [guessPosition, actualPosition],
          geodesic: true,
          strokeColor: '#f59e0b',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          map: mapRef.current,
        });

        // Fit bounds to show both markers
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(guessPosition);
        bounds.extend(actualPosition);
        mapRef.current.fitBounds(bounds, 50);
      }
    }
  }, [showResult, actualPosition, guessPosition]);

  return (
    <div className="w-full h-full relative">
      <div
        ref={containerRef}
        className={`w-full h-full rounded border border-tactical-border ${disabled ? 'pointer-events-none opacity-70' : ''}`}
      />
      {disabled && !showResult && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-tactical-muted/50 text-xs font-mono bg-black/50 px-2 py-1 rounded">
            MAP LOCKED
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Fallback (no Google Maps API key) ────────────────────────────────────────

function FallbackGuessMap({
  onGuess,
  disabled = false,
  guessPosition = null,
  actualPosition = null,
  showResult = false,
}: GuessMapProps) {
  const [markerPos, setMarkerPos] = useState<{ x: number; y: number } | null>(null);

  const pixelToCoord = useCallback((x: number, y: number, width: number, height: number): Coordinate => {
    const lng = (x / width) * 360 - 180;
    const lat = 90 - (y / height) * 180;
    return { lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) };
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const coord = pixelToCoord(x, y, rect.width, rect.height);
      setMarkerPos({ x, y });
      onGuess(coord);
    },
    [disabled, onGuess, pixelToCoord]
  );

  return (
    <div className="relative w-full h-full min-h-[200px]">
      <div
        className={`w-full h-full bg-tactical-bg border border-tactical-border rounded relative overflow-hidden
          ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-crosshair'}`}
        onClick={handleClick}
      >
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 360 180" preserveAspectRatio="none">
          {Array.from({ length: 13 }, (_, i) => i * 30).map((lng) => (
            <line key={`lng-${lng}`} x1={lng} y1={0} x2={lng} y2={180} stroke="#1e293b" strokeWidth={0.5} />
          ))}
          {Array.from({ length: 7 }, (_, i) => i * 30).map((lat) => (
            <line key={`lat-${lat}`} x1={0} y1={lat} x2={360} y2={lat} stroke="#1e293b" strokeWidth={0.5} />
          ))}
          <line x1={0} y1={90} x2={360} y2={90} stroke="#334155" strokeWidth={0.8} />
          <line x1={180} y1={0} x2={180} y2={180} stroke="#334155" strokeWidth={0.8} />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-tactical-muted/30 text-sm font-mono select-none">
            {disabled ? 'MAP LOCKED' : 'CLICK TO PLACE GUESS'}
          </span>
        </div>

        {markerPos && !showResult && (
          <div
            className="absolute pointer-events-none -translate-x-2.5 -translate-y-2.5"
            style={{ left: markerPos.x, top: markerPos.y }}
          >
            <div className="w-5 h-5 rounded-full bg-tactical-amber border-2 border-white shadow-lg" />
          </div>
        )}

        {showResult && guessPosition && (
          <FallbackResultOverlay guess={guessPosition} actual={actualPosition} />
        )}
      </div>
    </div>
  );
}

function FallbackResultOverlay({ guess, actual }: { guess: Coordinate; actual: Coordinate | null }) {
  const guessPos = { x: ((guess.lng + 180) / 360) * 100, y: ((90 - guess.lat) / 180) * 100 };
  const actualPos = actual
    ? { x: ((actual.lng + 180) / 360) * 100, y: ((90 - actual.lat) / 180) * 100 }
    : null;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      {actualPos && (
        <line x1={guessPos.x} y1={guessPos.y} x2={actualPos.x} y2={actualPos.y}
          stroke="#f59e0b" strokeWidth={0.3} strokeDasharray="1 0.5" />
      )}
      <circle cx={guessPos.x} cy={guessPos.y} r={1} fill="#f59e0b" stroke="white" strokeWidth={0.3} />
      {actualPos && (
        <circle cx={actualPos.x} cy={actualPos.y} r={1} fill="#22c55e" stroke="white" strokeWidth={0.3} />
      )}
    </svg>
  );
}

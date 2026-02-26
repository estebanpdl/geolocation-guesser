'use client';

import { useState, useRef, useCallback } from 'react';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

interface PhotoDropZoneProps {
  onImageSelected: (base64: string, mimeType: string, fileName: string) => void;
  disabled?: boolean;
  currentPreview?: string | null;
  onClear?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PhotoDropZone({ onImageSelected, disabled, currentPreview, onClear }: PhotoDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Invalid file type. Use JPEG, PNG, or WebP.');
      return;
    }

    if (file.size > MAX_SIZE) {
      setError(`File too large (${formatFileSize(file.size)}). Max 10 MB.`);
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // dataUrl format: "data:<mime>;base64,<data>"
      const commaIndex = dataUrl.indexOf(',');
      const base64 = dataUrl.slice(commaIndex + 1);
      onImageSelected(base64, file.type, file.name);
    };
    reader.readAsDataURL(file);
  }, [onImageSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [disabled, processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleClear = () => {
    setFileName(null);
    setFileSize(null);
    setError(null);
    onClear?.();
  };

  if (currentPreview) {
    return (
      <div className="space-y-3">
        <div className="relative rounded border border-tactical-border overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPreview}
            alt="Uploaded photo"
            className="w-full max-h-[400px] object-contain bg-black/50"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-tactical-muted font-mono truncate max-w-[70%]">
            {fileName}{fileSize != null && ` (${formatFileSize(fileSize)})`}
          </div>
          <button
            onClick={handleClear}
            disabled={disabled}
            className="text-xs text-tactical-red hover:text-tactical-red/80 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
        {error && (
          <div className="text-xs text-tactical-red font-mono">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          flex flex-col items-center justify-center gap-3 p-8
          rounded border-2 border-dashed cursor-pointer transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${dragging
            ? 'border-tactical-green bg-tactical-green/5'
            : 'border-tactical-border hover:border-tactical-muted'
          }
        `}
      >
        <div className="text-3xl text-tactical-muted">
          {dragging ? '+' : '^'}
        </div>
        <div className="text-sm text-slate-300">
          {dragging ? 'Drop image here' : 'Drag & drop a photo'}
        </div>
        <div className="text-xs text-tactical-muted">
          or click to browse
        </div>
        <div className="text-[10px] text-tactical-muted/60">
          JPEG, PNG, or WebP &middot; max 10 MB
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleInputChange}
        className="hidden"
      />

      {error && (
        <div className="text-xs text-tactical-red font-mono p-2 rounded bg-tactical-red/10 border border-tactical-red/30">
          {error}
        </div>
      )}
    </div>
  );
}

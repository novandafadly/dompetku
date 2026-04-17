'use client';

import React, { useEffect, useRef, useState } from 'react';
import { renderPageToCanvas, PdfPage } from '@/lib/pdf-utils';

interface Props {
  page: PdfPage;
  index: number;
  onToggle: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  isDragOver: boolean;
}

export default function PageCard({
  page, index, onToggle, onDragStart, onDragOver, onDrop, isDragOver
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    renderPageToCanvas(page, 0.55).then(canvas => {
      if (cancelled || !canvasRef.current) return;
      canvasRef.current.innerHTML = '';
      canvas.style.width = '100%';
      canvas.style.display = 'block';
      canvas.style.background = '#fff';
      canvasRef.current.appendChild(canvas);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.rotation]);

  const shortName = page.srcName.length > 14
    ? page.srcName.slice(0, 12) + '…'
    : page.srcName;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onToggle}
      className={[
        'group relative rounded-xl overflow-hidden cursor-pointer select-none transition-all duration-150',
        'border-2 bg-surface',
        page.selected
          ? 'border-accent shadow-md shadow-accent/20'
          : 'border-border hover:border-muted',
        isDragOver ? 'border-dashed !border-blue-400 scale-[1.02]' : '',
      ].join(' ')}
    >
      <div className={[
        'absolute top-2 left-2 z-10 w-5 h-5 rounded-md flex items-center justify-center transition-all',
        'border text-xs font-mono',
        page.selected
          ? 'bg-accent border-accent text-white'
          : 'bg-white/80 border-border text-transparent group-hover:border-muted',
      ].join(' ')}>
        ✓
      </div>

      <div className="absolute top-2 right-2 z-10 text-[9px] font-mono px-1.5 py-0.5 rounded bg-ink/40 text-white/90 max-w-[80px] truncate">
        {shortName}
      </div>

      <div ref={canvasRef} className="w-full">
        {loading && (
          <div className="skeleton w-full" style={{ aspectRatio: '1/1.414', minHeight: 120 }} />
        )}
      </div>

      <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border bg-surface">
        <span className="text-[11px] font-mono text-muted">p.{index + 1}</span>
        {page.rotation !== 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-muted">
            {page.rotation}°
          </span>
        )}
      </div>
    </div>
  );
}

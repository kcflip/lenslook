import { useEffect } from 'react';

export type GallerySource = 'reddit' | 'amazon' | 'bh' | 'adorama';

export interface GalleryTile {
  src: string;
  source: GallerySource;
  linkUrl: string;
  linkLabel: string;
  title: string;
  meta?: Array<{ label: string; value: string }>;
}

const SOURCE_LABEL: Record<GallerySource, string> = {
  reddit: 'Reddit',
  amazon: 'Amazon',
  bh: 'B&H',
  adorama: 'Adorama',
};
const SOURCE_COLOR: Record<GallerySource, string> = {
  reddit: '#ff4500',
  amazon: '#ff9900',
  bh: '#0066cc',
  adorama: '#e11d2c',
};

interface Props {
  tiles: GalleryTile[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}

export function GalleryLightbox({ tiles, index, onClose, onIndex }: Props) {
  const tile = tiles[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + tiles.length) % tiles.length);
      else if (e.key === 'ArrowRight') onIndex((index + 1) % tiles.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, tiles.length, onClose, onIndex]);

  // Lock body scroll while open so the grid behind doesn't move under the overlay.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!tile) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const prev = () => onIndex((index - 1 + tiles.length) % tiles.length);
  const next = () => onIndex((index + 1) % tiles.length);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <button
        type="button"
        onClick={(e) => { stop(e); onClose(); }}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: 'rgba(255, 255, 255, 0.1)',
          border: 'none',
          borderRadius: '50%',
          width: 40,
          height: 40,
          color: '#fff',
          fontSize: '1.3rem',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ×
      </button>

      {tiles.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { stop(e); prev(); }}
            aria-label="Previous image"
            style={{
              position: 'absolute',
              top: '50%',
              left: '1rem',
              transform: 'translateY(-50%)',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '50%',
              width: 48,
              height: 48,
              color: '#fff',
              fontSize: '1.6rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => { stop(e); next(); }}
            aria-label="Next image"
            style={{
              position: 'absolute',
              top: '50%',
              right: '1rem',
              transform: 'translateY(-50%)',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '50%',
              width: 48,
              height: 48,
              color: '#fff',
              fontSize: '1.6rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ›
          </button>
        </>
      )}

      <div
        onClick={stop}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          maxWidth: 'min(1100px, 90vw)',
          width: '100%',
        }}
      >
        <img
          src={tile.src}
          alt={tile.title}
          referrerPolicy="no-referrer"
          style={{
            maxWidth: '100%',
            maxHeight: '72vh',
            objectFit: 'contain',
            borderRadius: 4,
            background: '#111',
          }}
        />
        <div
          style={{
            background: '#111',
            border: '1px solid #222',
            borderRadius: 4,
            padding: '0.8rem 1rem',
            width: '100%',
            color: '#d0d0d0',
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
            <span
              style={{
                background: SOURCE_COLOR[tile.source],
                color: '#fff',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: '0.7rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {SOURCE_LABEL[tile.source]}
            </span>
            <span style={{ color: '#888', fontSize: '0.75rem', marginLeft: 'auto' }}>
              {index + 1} / {tiles.length}
            </span>
          </div>
          <div style={{ fontWeight: 600, color: '#e8e8e8', marginBottom: '0.4rem' }}>
            {tile.title}
          </div>
          {tile.meta && tile.meta.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '0.9rem',
                flexWrap: 'wrap',
                color: '#aaa',
                fontSize: '0.78rem',
                marginBottom: '0.5rem',
              }}
            >
              {tile.meta.map((m, i) => (
                <span key={i}>
                  <span style={{ color: '#666' }}>{m.label}:</span> {m.value}
                </span>
              ))}
            </div>
          )}
          <a href={tile.linkUrl} target="_blank" rel="noopener" style={{ fontSize: '0.8rem' }}>
            {tile.linkLabel} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

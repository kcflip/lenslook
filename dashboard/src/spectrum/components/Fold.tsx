import { useState } from 'react';
import { BORDER, FONT_MONO, TEXT_DIM, TEXT_FAINT } from '../tokens';

interface FoldProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  alwaysOpen?: boolean;
  children: React.ReactNode;
}

export function Fold({ title, count, defaultOpen = false, alwaysOpen = false, children }: FoldProps) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen);

  const header = (
    <div
      onClick={alwaysOpen ? undefined : () => setOpen(o => !o)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 0',
        borderBottom: `1px solid ${BORDER}`,
        cursor: alwaysOpen ? 'default' : 'pointer',
        userSelect: 'none',
      }}
      onMouseEnter={e => {
        if (!alwaysOpen) (e.currentTarget.querySelector('.fold-title') as HTMLElement | null)?.style.setProperty('color', 'rgba(255,255,255,0.7)');
      }}
      onMouseLeave={e => {
        if (!alwaysOpen) (e.currentTarget.querySelector('.fold-title') as HTMLElement | null)?.style.setProperty('color', TEXT_DIM);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="fold-title"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: TEXT_DIM,
            transition: 'color 0.15s ease',
          }}
        >
          {title}
        </span>
        {count !== undefined && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: TEXT_FAINT,
              background: 'rgba(255,255,255,0.06)',
              padding: '1px 6px',
              borderRadius: 999,
            }}
          >
            {count}
          </span>
        )}
      </div>
      {!alwaysOpen && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 14,
            color: TEXT_FAINT,
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
            display: 'inline-block',
            lineHeight: 1,
          }}
        >
          +
        </span>
      )}
    </div>
  );

  return (
    <div style={{ marginBottom: 20 }}>
      {header}
      {(open || alwaysOpen) && (
        <div
          style={{
            animation: 'fadeUp 0.5s ease',
            paddingTop: 16,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

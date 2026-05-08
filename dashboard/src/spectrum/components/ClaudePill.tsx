import { FONT_DISPLAY } from '../tokens';

interface ClaudePillProps {
  score: number;
  size?: 'sm' | 'lg';
}

export function ClaudePill({ score, size = 'sm' }: ClaudePillProps) {
  const positive = score >= 0;
  const border = positive ? 'oklch(50% 0.16 150)' : 'oklch(50% 0.17 28)';
  const bg     = positive ? 'oklch(94% 0.05 150)' : 'oklch(94% 0.05 28)';
  const color  = positive ? 'oklch(35% 0.16 150)' : 'oklch(35% 0.17 28)';
  const fontSize = size === 'lg' ? 22 : 11;
  const padding  = size === 'lg' ? '4px 12px' : '2px 8px';

  return (
    <span
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize,
        fontWeight: 700,
        color,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 999,
        padding,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {score >= 0 ? '+' : ''}{score.toFixed(2)}
    </span>
  );
}

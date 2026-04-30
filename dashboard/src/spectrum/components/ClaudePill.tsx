import { CLAUDE_POS, CLAUDE_NEG } from '../utils/colors';

interface Props {
  value: number | null;
}

export function ClaudePill({ value }: Props) {
  if (value == null) {
    return <span style={{ color: 'var(--dimmer)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>—</span>;
  }
  const palette = value >= 0 ? CLAUDE_POS : CLAUDE_NEG;
  const label = (value >= 0 ? '+' : '') + value.toFixed(2);
  return (
    <span
      className="spectrum-claude-pill"
      style={{
        color: palette.text,
        background: palette.bg,
        borderColor: palette.border,
      }}
    >
      {label}
    </span>
  );
}

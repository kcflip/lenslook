import { typographyFor, FONT_FAMILY_STACK } from '../brands';

interface Props {
  brand: string;
  size?: number;
  tone?: string;
  variant?: 'plain' | 'pill' | 'underline';
}

export function BrandMark({ brand, size = 12, tone = 'currentColor', variant = 'plain' }: Props) {
  const t = typographyFor(brand);
  const base: React.CSSProperties = {
    fontFamily: FONT_FAMILY_STACK[t.family],
    fontWeight: t.weight,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform,
    fontSize: size,
    color: tone,
    lineHeight: 1,
    display: 'inline-block',
  };
  if (variant === 'pill') {
    return (
      <span
        style={{
          ...base,
          padding: '2px 8px',
          border: `1px solid ${tone}`,
          borderRadius: 999,
        }}
      >
        {brand}
      </span>
    );
  }
  if (variant === 'underline') {
    return <span style={{ ...base, borderBottom: `1px solid ${tone}` }}>{brand}</span>;
  }
  return <span style={base}>{brand}</span>;
}

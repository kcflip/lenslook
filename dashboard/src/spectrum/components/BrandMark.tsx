import { brandColor, FONT_DISPLAY, FONT_MONO } from '../tokens';

interface BrandMarkProps {
  brand: string;
  size?: number;
  style?: React.CSSProperties;
}

export function BrandMark({ brand, size = 14, style }: BrandMarkProps) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: size,
        fontWeight: 700,
        color: brandColor(brand),
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {brand}
    </span>
  );
}

// Brand dot — small circle in brand color
export function BrandDot({ brand, size = 10 }: { brand: string; size?: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: brandColor(brand),
        flexShrink: 0,
      }}
    />
  );
}

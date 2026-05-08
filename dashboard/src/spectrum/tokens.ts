// Dark theme design tokens — single source of truth for all spectrum pages.

export const FONT_DISPLAY = "'DM Sans', sans-serif";
export const FONT_MONO    = "'Space Mono', monospace";

// ---------- Background tones (user-selectable) ----------
export const BG_TONES = {
  black:    '#0a0a0a',
  midnight: '#111111',
  charcoal: '#1a1a1a',
  graphite: '#222222',
  slate:    '#2a2a2a',
} as const;
export type BgTone = keyof typeof BG_TONES;

// ---------- Accent colors (user-selectable) ----------
export const ACCENTS = {
  green: '#4ADE80',
  amber: '#FBBF24',
  cyan:  '#22D3EE',
  rose:  '#FB7185',
  white: '#E8E8E8',
} as const;
export type Accent = keyof typeof ACCENTS;

// ---------- Source colors (fixed) ----------
export const SOURCE_COLORS: Record<string, string> = {
  reddit:   '#FF6B35',
  amazon:   '#FBBF24',
  bh:       '#22D3EE',
  adorama:  '#A78BFA',
  youtube:  '#FB7185',
};

// ---------- Category badge colors (fixed) ----------
export const CATEGORY_COLORS: Record<string, string> = {
  prime:      '#4ADE80',
  telephoto:  '#22D3EE',
  zoom:       '#FBBF24',
  'ultra-wide': '#FB7185',
  wide:       '#FB7185',
  macro:      '#A78BFA',
  'aps-c':    '#A78BFA',
};

// ---------- Sentiment colors (fixed) ----------
export const POSITIVE_COLOR = '#4ADE80';
export const NEGATIVE_COLOR = '#F87171';
export const STAR_COLOR     = '#FBBF24';

// ---------- Semantic tokens (relative to bg) ----------
export const TEXT_PRIMARY  = '#e8e8e8';
export const TEXT_DIM      = 'rgba(255,255,255,0.5)';
export const TEXT_DIMMER   = 'rgba(255,255,255,0.35)';
export const TEXT_MUTED    = 'rgba(255,255,255,0.3)';
export const TEXT_FAINT    = 'rgba(255,255,255,0.2)';
export const BORDER        = 'rgba(255,255,255,0.06)';
export const BORDER_MED    = 'rgba(255,255,255,0.08)';
export const HOVER_BG      = 'rgba(255,255,255,0.06)';
export const ACTIVE_PILL   = 'rgba(255,255,255,0.12)';
export const INACTIVE_PILL = 'rgba(255,255,255,0.06)';

// ---------- Brand hues ----------
const BRAND_HUES: Record<string, number> = {
  Sony:      12,
  Tamron:    220,
  Samyang:   280,
  Sigma:     185,
  Viltrox:   150,
  Zeiss:     80,
  Laowa:     40,
  TTArtisan: 320,
};

export function brandColor(brand: string): string {
  const hue = BRAND_HUES[brand] ?? 0;
  return `oklch(65% 0.18 ${hue})`;
}

// Fallback hex values for browsers that don't support oklch (rare but safe)
const BRAND_HEX_FALLBACKS: Record<string, string> = {
  Sony:      '#e05a3a',
  Tamron:    '#3a7ae0',
  Samyang:   '#8b3ae0',
  Sigma:     '#2bb5a8',
  Viltrox:   '#3ae08b',
  Zeiss:     '#a8e03a',
  Laowa:     '#e07a3a',
  TTArtisan: '#e03ab0',
};

export function brandColorFallback(brand: string): string {
  return BRAND_HEX_FALLBACKS[brand] ?? '#e8e8e8';
}

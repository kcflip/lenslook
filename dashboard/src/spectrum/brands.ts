// Brand identity constants for the Spectrum variant.
// Hues and typographic treatments come straight from the design spec.

export type BrandName =
  | 'Sony'
  | 'Tamron'
  | 'Samyang'
  | 'Sigma'
  | 'Viltrox'
  | 'Zeiss'
  | 'Laowa'
  | 'TTArtisan'
  | 'Voigtlander';

export const BRAND_ORDER: BrandName[] = [
  'Sony', 'Tamron', 'Samyang', 'Sigma', 'Viltrox', 'Zeiss', 'Laowa', 'TTArtisan', 'Voigtlander',
];

export const BRAND_HUES: Record<BrandName, number> = {
  Sony: 12,
  Tamron: 220,
  Samyang: 280,
  Sigma: 0,
  Viltrox: 150,
  Zeiss: 80,
  Laowa: 40,
  TTArtisan: 320,
  Voigtlander: 260,
};

type FontFamily = 'neue' | 'grotesk' | 'serif';

export interface BrandTypography {
  family: FontFamily;
  weight: number;
  letterSpacing: string;
  textTransform: 'uppercase' | 'none';
}

export const BRAND_TYPOGRAPHY: Record<BrandName, BrandTypography> = {
  Sony:      { family: 'neue',    weight: 700, letterSpacing: '-0.01em', textTransform: 'uppercase' },
  Tamron:    { family: 'grotesk', weight: 600, letterSpacing: '0',       textTransform: 'none' },
  Samyang:   { family: 'serif',   weight: 500, letterSpacing: '0.01em',  textTransform: 'none' },
  Sigma:     { family: 'neue',    weight: 800, letterSpacing: '0.06em',  textTransform: 'uppercase' },
  Viltrox:   { family: 'grotesk', weight: 600, letterSpacing: '-0.02em', textTransform: 'uppercase' },
  Zeiss:     { family: 'serif',   weight: 600, letterSpacing: '0.12em',  textTransform: 'uppercase' },
  Laowa:     { family: 'grotesk', weight: 500, letterSpacing: '0.02em',  textTransform: 'none' },
  TTArtisan: { family: 'serif',   weight: 500, letterSpacing: '0',       textTransform: 'none' },
  Voigtlander: { family: 'serif', weight: 500, letterSpacing: '0.02em',  textTransform: 'none' },
};

export const FONT_FAMILY_STACK: Record<FontFamily, string> = {
  neue:    `'Inter Tight', 'Neue Haas Grotesk', 'Inter', sans-serif`,
  grotesk: `'Inter', 'Söhne', -apple-system, sans-serif`,
  serif:   `'Instrument Serif', 'Canela', Georgia, serif`,
};

// Any brand outside the canonical 8 gets a deterministic hue so the layout
// never breaks. Hash by code points → 0–359.
function fallbackHue(brand: string): number {
  let h = 0;
  for (let i = 0; i < brand.length; i++) h = (h * 31 + brand.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

export function isKnownBrand(brand: string): brand is BrandName {
  return brand in BRAND_HUES;
}

export function hueFor(brand: string): number {
  return isKnownBrand(brand) ? BRAND_HUES[brand] : fallbackHue(brand);
}

export function typographyFor(brand: string): BrandTypography {
  if (isKnownBrand(brand)) return BRAND_TYPOGRAPHY[brand];
  return { family: 'grotesk', weight: 600, letterSpacing: '0', textTransform: 'none' };
}

import { hueFor } from '../brands';

export function brandColor(brand: string, lightness = 55, chroma = 0.18, hueShift = 0): string {
  return `oklch(${lightness}% ${chroma} ${hueFor(brand) + hueShift})`;
}

export function brandSoft(brand: string, hueShift = 0): string {
  return `oklch(94% 0.04 ${hueFor(brand) + hueShift})`;
}

export function brandHover(brand: string, hueShift = 0): string {
  return `oklch(97% 0.02 ${hueFor(brand) + hueShift})`;
}

export type HeatMode = 'warm' | 'cool' | 'brand';

const HEAT_HUES: Record<Exclude<HeatMode, 'brand'>, number> = {
  warm: 65,
  cool: 240,
};

// Bucketed 4-stop scale from the spec. `t` is normalized 0–1.
export function heat(t: number, mode: HeatMode = 'warm', brand?: string): string {
  const hue = mode === 'brand' && brand ? hueFor(brand) : HEAT_HUES[mode === 'brand' ? 'warm' : mode];
  if (t < 0.25) return `oklch(97% 0.01 ${hue})`;
  if (t < 0.50) return `oklch(92% 0.06 ${hue})`;
  if (t < 0.75) return `oklch(84% 0.11 ${hue})`;
  return `oklch(74% 0.16 ${hue})`;
}

export const CLAUDE_POS = {
  border: 'oklch(50% 0.16 150)',
  bg:     'oklch(94% 0.05 150)',
  text:   'oklch(50% 0.16 150)',
};

export const CLAUDE_NEG = {
  border: 'oklch(50% 0.17 28)',
  bg:     'oklch(94% 0.05 28)',
  text:   'oklch(50% 0.17 28)',
};

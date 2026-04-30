// Design tokens. Kept in one place so components can pull constants directly
// instead of magic-numbering CSS. Spacing values match the "compact" density
// from the spec; tweak the DENSITY export to switch.

export const COLORS = {
  bg:         '#FBF8F2',
  paper:      '#FFFFFF',
  text:       '#18140F',
  dim:        '#6B6458',
  dimmer:     '#A8A092',
  line:       'rgba(24, 20, 15, 0.08)',
  lineStrong: 'rgba(24, 20, 15, 0.16)',
  hoverBg:    'rgba(24, 20, 15, 0.03)',
  theadBg:    'rgba(24, 20, 15, 0.025)',
};

export const DENSITY = {
  tight:    { rowPadY: 4,  cellPadX: 8,  gridGap: 8,  sectionGap: 24, rootPadX: 28, rootPadY: 20 },
  compact:  { rowPadY: 5,  cellPadX: 10, gridGap: 10, sectionGap: 28, rootPadX: 36, rootPadY: 24 },
  balanced: { rowPadY: 8,  cellPadX: 14, gridGap: 12, sectionGap: 32, rootPadX: 44, rootPadY: 32 },
  spacious: { rowPadY: 12, cellPadX: 20, gridGap: 16, sectionGap: 40, rootPadX: 56, rootPadY: 40 },
} as const;

export type Density = keyof typeof DENSITY;

export const TYPE = {
  title:        { size: 36,   weight: 600, tracking: '-0.02em', family: 'display' },
  subtitle:     { size: 10.5, weight: 400, tracking: 'normal',  family: 'mono' },
  kpiLabel:     { size: 9,    weight: 400, tracking: '0.12em',  family: 'mono' },
  kpiValue:     { size: 19,   weight: 600, tracking: '-0.01em', family: 'display' },
  kpiDelta:     { size: 10,   weight: 400, tracking: 'normal',  family: 'mono' },
  sectionTitle: { size: 11,   weight: 600, tracking: '0.14em',  family: 'mono' },
  sectionMeta:  { size: 10,   weight: 400, tracking: 'normal',  family: 'mono' },
  th:           { size: 9.5,  weight: 500, tracking: '0.08em',  family: 'mono' },
  td:           { size: 11.5, weight: 400, tracking: 'normal',  family: 'mono' },
  postQuote:    { size: 13,   weight: 400, tracking: 'normal',  family: 'display' },
  legend:       { size: 9.5,  weight: 400, tracking: 'normal',  family: 'mono' },
  pill:         { size: 10,   weight: 400, tracking: 'normal',  family: 'mono' },
  chip:         { size: 9.5,  weight: 400, tracking: 'normal',  family: 'mono' },
  logo:         { size: 11,   weight: 600, tracking: '0.1em',   family: 'mono' },
} as const;

export const BORDERS = {
  brandWidth: 3,
  radiusChip: 2,
  radiusCard: 0,
  radiusPill: 999,
};

export const TRANSITIONS = {
  hover:    '0.15s ease',
  collapse: '0.25s ease',
  drawer:   '0.2s ease-out',
};

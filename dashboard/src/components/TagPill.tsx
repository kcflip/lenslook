// Feature-tag palette. Only renders pills for the classifier-emitted tags
// (prime, zoom, ultra-wide, …); legacy per-brand tags like "Sony FE
// Full-Frame Primes" are filtered out since they duplicate the BrandBadge.

const STYLES: Record<string, { bg: string; color: string; border: string }> = {
  prime:            { bg: '#14301f', color: '#4ade80', border: '#1d4a30' },
  zoom:             { bg: '#0f2a30', color: '#22d3ee', border: '#174049' },
  superzoom:        { bg: '#2d1f10', color: '#fb923c', border: '#47311a' },
  'ultra-wide':     { bg: '#172037', color: '#60a5fa', border: '#1f2f55' },
  wide:             { bg: '#1a2836', color: '#7dd3fc', border: '#223a4f' },
  standard:         { bg: '#242424', color: '#d4d4d4', border: '#333' },
  telephoto:        { bg: '#2a1f0a', color: '#fbbf24', border: '#3f2f12' },
  'super-telephoto':{ bg: '#2e1a1a', color: '#f87171', border: '#4a2424' },
  macro:            { bg: '#2d1522', color: '#f472b6', border: '#481e37' },
  'aps-c':          { bg: '#0e2a26', color: '#2dd4bf', border: '#15413a' },
};

export const FEATURE_TAGS = Object.keys(STYLES);

export function TagPill({ tag }: { tag: string }) {
  const s = STYLES[tag];
  if (!s) return null;
  return (
    <span
      style={{
        display: 'inline-block',
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {tag}
    </span>
  );
}

export function TagPillRow({ tags }: { tags: string[] }) {
  const feature = tags.filter(t => STYLES[t]);
  if (feature.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
      {feature.map(t => <TagPill key={t} tag={t} />)}
    </div>
  );
}

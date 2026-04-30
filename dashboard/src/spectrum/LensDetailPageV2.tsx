import { useEffect, useMemo, useState } from 'react';
import type { DashboardData, Post, ReviewSource, SentimentCitation, ReviewItem, BHProperty } from '../types';
import { GalleryLightbox, type GalleryTile } from '../components/GalleryLightbox';
import { brandOf, calcWeight, buildCloudData, postCommentsUrl, commentPermalink } from '../utils';
import { brandHref } from '../hooks/useHashRoute';
import { KPITile } from './components/KPITile';
import { CollapsibleSection } from './components/CollapsibleSection';
import { ClaudePill } from './components/ClaudePill';
import { brandColor, CLAUDE_POS, CLAUDE_NEG } from './utils/colors';
import { BRAND_ORDER } from './brands';

interface Props {
  data: DashboardData;
  lensId: string;
}

// ── Shared helpers (mirrors LensDetailPage) ────────────────────────────────

function normalizeRetailerImage(src: string): string {
  const stripped = src.replace(/\._[^.]+(\.\w+)$/, '$1');
  const bhMatch = stripped.match(/^\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/);
  return bhMatch ? bhMatch[1] : stripped;
}

function resolveCitationUrl(
  citation: SentimentCitation,
  lensId: string,
  reviews: ReviewItem[],
  posts: Post[],
): string | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(citation.quote);
  if (!needle) return null;

  if (citation.source === 'amazon' || citation.source === 'bh' || citation.source === 'adorama') {
    for (const r of reviews) {
      if (r.sourceType !== citation.source) continue;
      if (norm(r.text).includes(needle)) return r.url ?? null;
    }
    return null;
  }
  if (citation.source === 'reddit_post') {
    for (const post of posts) {
      if (!post.postLensIds?.includes(lensId)) continue;
      const text = post.title + (post.selftext && post.selftext !== '[removed]' ? ': ' + post.selftext.slice(0, 300) : '');
      if (norm(text).includes(needle)) return post.id && post.subreddit ? postCommentsUrl(post) : post.url;
    }
    return null;
  }
  if (citation.source === 'reddit_comment') {
    for (const post of posts) {
      if (!post.commentLensIds?.includes(lensId)) continue;
      for (const c of post.matchedComments ?? []) {
        if (c.lensIds && !c.lensIds.includes(lensId)) continue;
        if (norm(c.body).includes(needle)) {
          if (c.id && post.id && post.subreddit) return commentPermalink(post, c.id);
          return post.id && post.subreddit ? postCommentsUrl(post) : post.url;
        }
      }
    }
    return null;
  }
  return null;
}

const SOURCE_LABEL: Record<ReviewSource, string> = {
  reddit_post: 'Reddit post',
  reddit_comment: 'Reddit comment',
  amazon: 'Amazon',
  bh: 'B&H',
  adorama: 'Adorama',
  youtube: 'YouTube',
};

// ── B&H Specs table ───────────────────────────────────────────────────────

const SPEC_LABELS: Array<[keyof BHProperty, string]> = [
  ['focalLength',          'Focal Length'],
  ['maxAperture',          'Max Aperture'],
  ['minAperture',          'Min Aperture'],
  ['mount',                'Mount'],
  ['format',               'Format'],
  ['angleOfView',          'Angle of View'],
  ['minimumFocusDistance', 'Min Focus'],
  ['magnification',        'Magnification'],
  ['opticalDesign',        'Optical Design'],
  ['apertureBlades',       'Aperture Blades'],
  ['focusType',            'Focus Type'],
  ['imageStabilization',   'Stabilization'],
  ['filterSize',           'Filter Thread'],
  ['dimensions',           'Dimensions'],
  ['weight',               'Weight'],
];

function BHSpecsTableV2({ props }: { props: BHProperty }) {
  const rows = SPEC_LABELS.map(([key, label]) => [label, props[key]] as [string, string | undefined]).filter(([, v]) => v != null);
  if (!rows.length) return null;
  return (
    <div style={{ flexShrink: 0 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--dimmer)', paddingRight: 12, paddingTop: 2, paddingBottom: 2, whiteSpace: 'nowrap' as const, verticalAlign: 'top' }}>
                {label}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text)', paddingTop: 2, paddingBottom: 2, lineHeight: 1.3, maxWidth: 200 }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sentiment label badge ──────────────────────────────────────────────────

function SentimentBadge({ label }: { label: string }) {
  const styles: Record<string, { border: string; color: string; bg: string }> = {
    positive: { border: CLAUDE_POS.border, color: CLAUDE_POS.text, bg: CLAUDE_POS.bg },
    negative: { border: CLAUDE_NEG.border, color: CLAUDE_NEG.text, bg: CLAUDE_NEG.bg },
    mixed:    { border: 'oklch(65% 0.15 65)', color: 'oklch(50% 0.15 65)', bg: 'oklch(95% 0.04 65)' },
    neutral:  { border: 'var(--line-strong)', color: 'var(--dim)', bg: 'transparent' },
  };
  const s = styles[label] ?? styles.neutral;
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase' as const,
      border: `1px solid ${s.border}`,
      color: s.color,
      background: s.bg,
      borderRadius: 2,
    }}>
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LensDetailPageV2({ data, lensId }: Props) {
  const { results, lensById, sentiment, claudeSentiment, youtubeSentiment, reviews, lenses } = data;
  const lens = lensById[lensId];
  const stat = results.stats.find(s => s.lensId === lensId);
  const claude = claudeSentiment[lensId];
  const lexicon = sentiment[lensId];
  const youtube = youtubeSentiment[lensId];
  const youtubeVideos = youtube?.videos.filter(v => v.mentionCount > 0) ?? [];

  const topPosts = useMemo(() => {
    const matched: Array<{ post: Post; weight: number }> = [];
    for (const post of results.posts) {
      if (post.postLensIds.includes(lensId)) matched.push({ post, weight: calcWeight(post) });
    }
    matched.sort((a, b) => b.weight - a.weight);
    return matched.slice(0, 10);
  }, [results.posts, lensId]);

  const gallery = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    const matched: Array<{ post: Post; weight: number }> = [];
    for (const post of results.posts) {
      if (post.postLensIds.includes(lensId)) matched.push({ post, weight: calcWeight(post) });
    }
    matched.sort((a, b) => b.weight - a.weight);
    for (const { post } of matched) {
      const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
      const meta = [
        { label: 'subreddit', value: `r/${post.subreddit}` },
        { label: 'score', value: post.score.toLocaleString() },
        { label: 'comments', value: post.num_comments.toLocaleString() },
      ];
      const pushTile = (src: string) => tiles.push({ src, source: 'reddit', linkUrl: postUrl, linkLabel: 'View post on Reddit', title: post.title, meta });
      if (post.images?.length) {
        for (const img of post.images) { pushTile(img.url); if (tiles.length >= 30) break; }
      } else if (!post.is_self && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(post.url)) {
        pushTile(post.url);
      }
      if (tiles.length >= 30) break;
    }
    return tiles;
  }, [results.posts, lensId]);

  const amazonGallery = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    for (const item of reviews[lensId] ?? []) {
      if (item.sourceType !== 'amazon' || !item.images?.length) continue;
      const caption = item.text.length > 160 ? item.text.slice(0, 157) + '…' : item.text;
      const meta: Array<{ label: string; value: string }> = [];
      if (item.rating != null) meta.push({ label: 'rating', value: `${item.rating}★` });
      if (item.verifiedPurchase) meta.push({ label: 'purchase', value: 'verified' });
      if (item.date) meta.push({ label: 'date', value: item.date });
      for (const src of item.images) tiles.push({ src: normalizeRetailerImage(src), source: 'amazon', linkUrl: item.url ?? '#', linkLabel: 'View review on Amazon', title: caption, meta });
    }
    return tiles;
  }, [reviews, lensId]);

  const bhGallery = useMemo((): GalleryTile[] => {
    const bh = lens?.bh;
    if (!bh) return [];
    const meta: Array<{ label: string; value: string }> = [];
    if (bh.starCount != null) meta.push({ label: 'avg rating', value: `${bh.starCount}★` });
    if (bh.ratingCount != null) meta.push({ label: 'reviews', value: bh.ratingCount.toLocaleString() });
    if (bh.official) meta.push({ label: 'seller', value: 'authorized' });
    return (bh.images ?? []).map((src): GalleryTile => ({
      src: normalizeRetailerImage(src), source: 'bh', linkUrl: bh.url, linkLabel: 'View product on B&H',
      title: bh.title ?? `${lens.brand} ${lens.name}`, meta,
    }));
  }, [lens]);


  const combinedGallery = useMemo((): GalleryTile[] => {
    const result: GalleryTile[] = [];
    const max = Math.max(gallery.length, amazonGallery.length, bhGallery.length);
    for (let i = 0; i < max; i++) {
      if (i < gallery.length) result.push(gallery[i]);
      if (i < amazonGallery.length) result.push(amazonGallery[i]);
      if (i < bhGallery.length) result.push(bhGallery[i]);
    }
    return result;
  }, [gallery, amazonGallery, bhGallery]);

  const [sourceFilter, setSourceFilter] = useState<'all' | 'reddit' | 'amazon' | 'bh'>('all');
  const toggleSource = (s: 'reddit' | 'amazon' | 'bh') => setSourceFilter(prev => prev === s ? 'all' : s);

  const sourceCounts = useMemo(() => {
    const items = reviews[lensId] ?? [];
    let amazon = 0, bh = 0, adorama = 0;
    for (const item of items) {
      if (item.sourceType === 'amazon') amazon++;
      else if (item.sourceType === 'bh') bh++;
      else if (item.sourceType === 'adorama') adorama++;
    }
    let reddit = 0;
    for (const post of results.posts) {
      if (post.postLensIds.includes(lensId)) reddit++;
      for (const c of post.matchedComments ?? []) {
        const attributed = c.lensIds ? c.lensIds.includes(lensId) : post.commentLensIds.includes(lensId);
        if (attributed) reddit++;
      }
    }
    return { amazon, bh, adorama, reddit };
  }, [reviews, lensId, results.posts]);

  const retailerReviews = useMemo(() => {
    return (reviews[lensId] ?? [])
      .filter(r => r.sourceType === 'amazon' || r.sourceType === 'bh' || r.sourceType === 'adorama')
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }, [reviews, lensId]);

  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [galleryGridEl, setGalleryGridEl] = useState<HTMLDivElement | null>(null);
  const [galleryCols, setGalleryCols] = useState(4);
  useEffect(() => {
    if (!galleryGridEl) return;
    const measure = () => {
      const n = window.getComputedStyle(galleryGridEl).getPropertyValue('grid-template-columns').split(' ').filter(Boolean).length;
      if (n > 0) setGalleryCols(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(galleryGridEl);
    return () => ro.disconnect();
  }, [galleryGridEl]);
  useEffect(() => { setGalleryExpanded(false); }, [sourceFilter]);

  const activeGallery = sourceFilter === 'all' ? combinedGallery : sourceFilter === 'reddit' ? gallery : sourceFilter === 'amazon' ? amazonGallery : bhGallery;
  const collapsedCount = galleryCols * 2;
  const canExpandGallery = activeGallery.length > collapsedCount;
  const visibleCount = galleryExpanded ? activeGallery.length : collapsedCount;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; postTitle: string; postUrl: string; subreddit: string; commentPermalink?: string }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        const attributed = c.lensIds ? c.lensIds.includes(lensId) : post.commentLensIds.includes(lensId);
        if (!attributed) continue;
        const permalink = c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : undefined;
        const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
        items.push({ body: c.body, score: c.score, postTitle: post.title, postUrl, subreddit: post.subreddit, commentPermalink: permalink });
      }
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, 10);
  }, [results.posts, lensId]);

  const related = useMemo(() => {
    if (!lens) return [];
    return lenses
      .filter(l => l.brand === lens.brand && l.id !== lens.id)
      .map(l => {
        const s = results.stats.find(x => x.lensId === l.id);
        return { lens: l, mentions: (s?.postCount ?? 0) + (s?.commentCount ?? 0) };
      })
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 6);
  }, [lens, lenses, results.stats]);

  if (!lens) {
    return (
      <div className="spectrum">
        <a href="#" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--dim)', textDecoration: 'none' }}>← back</a>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: '2rem', color: 'var(--dim)' }}>
          Lens not found: <code>{lensId}</code>
        </p>
      </div>
    );
  }

  const brand = brandOf(lensId, lensById);
  const mentions = (stat?.postCount ?? 0) + (stat?.commentCount ?? 0);
  const bColor = brandColor(brand);
  const brandsInData = useMemo(() => {
    const present = new Set(results.stats.map(s => brandOf(s.lensId, lensById)));
    const known = BRAND_ORDER.filter(b => present.has(b));
    const other = [...present].filter(b => !BRAND_ORDER.includes(b as never)).sort();
    return [...known, ...other];
  }, [results.stats, lensById]);

  const renderCitation = (c: SentimentCitation, i: number) => {
    const url = resolveCitationUrl(c, lensId, reviews[lensId] ?? [], results.posts);
    const sourceLabel = SOURCE_LABEL[c.source] ?? c.source;
    return (
      <li key={i} style={{ marginBottom: '0.9rem', listStyle: 'none' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>{c.aspect}</div>
        {url ? (
          <a href={url} target="_blank" rel="noopener" style={{ display: 'block', fontFamily: 'var(--font-serif)', fontSize: 13, fontStyle: 'italic', color: 'var(--dim)', textDecoration: 'none', lineHeight: 1.5 }}>
            &ldquo;{c.quote}&rdquo;
          </a>
        ) : (
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, fontStyle: 'italic', color: 'var(--dim)', lineHeight: 1.5 }}>&ldquo;{c.quote}&rdquo;</div>
        )}
        {url ? (
          <a href={url} target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dimmer)', textDecoration: 'none', marginTop: 3, display: 'inline-block' }}>
            {sourceLabel} ↗
          </a>
        ) : (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dimmer)', marginTop: 3 }}>{sourceLabel}</div>
        )}
      </li>
    );
  };

  const hasRetailers = !!(lens.amazon?.asins?.length || lens.bh || lens.adorama || lens.retailers);
  const hasGallery = gallery.length > 0 || amazonGallery.length > 0 || bhGallery.length > 0;

  return (
    <div className="spectrum">
      {/* Topbar */}
      <div className="spectrum-topbar">
        <div className="spectrum-topbar-left">
          <div className="spectrum-logo-dots">
            {brandsInData.slice(0, 4).map(b => (
              <span key={b} style={{ background: brandColor(b) }} />
            ))}
          </div>
          <span className="spectrum-logo-text">LENSLOOK</span>
          <span className="spectrum-breadcrumb">
            / <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>lens-popularity</a>
            {' '}/ {lens.brand} {lens.name}
          </span>
        </div>
        <a href="#" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dim)', textDecoration: 'none', letterSpacing: '0.04em' }}>
          ← back
        </a>
      </div>

      {/* Hero: specs left, title + pills right */}
      <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ flex: '1 1 260px', minWidth: '200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: bColor, display: 'inline-block', flexShrink: 0 }} />
            <a href={brandHref(lens.brand)} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dim)', textDecoration: 'none', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {lens.brand}
            </a>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dimmer)' }}>· {lens.mount}</span>
          </div>
          <h1 className="spectrum-title" style={{ fontSize: 32, marginBottom: 8 }}>{lens.name}</h1>
          <div className="spectrum-subtitle" style={{ marginBottom: 14 }}>
            {lens.focalLength} · {lens.maxAperture}
            {lens.bh?.price != null && (
              <> · <span style={{ color: 'var(--text)', fontWeight: 600 }}>${lens.bh.price.toFixed(0)}</span></>
            )}
          </div>
          {(lens.category ?? []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {(lens.category ?? []).map(t => (
                <span key={t} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                  border: '1px solid var(--line)', padding: '2px 7px', borderRadius: 2, color: 'var(--dim)',
                }}>
                  {t}
                </span>
              ))}
            </div>
          )}
          {lens.aliases.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {lens.aliases.map(a => (
                <span key={a} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em',
                  border: '1px dashed var(--line)', padding: '2px 7px', borderRadius: 2, color: 'var(--dimmer)',
                }}>
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        {lens.bh?.properties && <BHSpecsTableV2 props={lens.bh.properties} />}
      </div>

      {/* KPI row */}
      <div className="spectrum-kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 8 }}>
        <KPITile label="Post Mentions" value={String(stat?.postCount ?? 0)} brand={brand} />
        <KPITile label="Comment Mentions" value={String(stat?.commentCount ?? 0)} brand={brand} />
        <KPITile label="Total Mentions" value={String(mentions)} brand={brand} />
        <KPITile label="Score Sentiment" value={stat ? stat.scoreSentiment.toFixed(2) : '—'} />
        <KPITile
          label="Claude Score"
          value={claude ? `${claude.score > 0 ? '+' : ''}${claude.score.toFixed(2)}` : '—'}
        />
      </div>

      {/* Retailers */}
      {hasRetailers && (
        <CollapsibleSection title="Retailers" meta={<span>{[lens.amazon?.asins?.length ?? 0, lens.bh ? 1 : 0, lens.adorama ? 1 : 0, Object.keys(lens.retailers ?? {}).length].reduce((a, b) => a + b, 0)} sources</span>}>
          <table className="spectrum-table">
            <thead>
              <tr>
                <th className="align-left">Retailer</th>
                <th>Price</th>
                <th>Scraped</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {lens.amazon?.asins?.map(a => (
                <tr key={a.asin}>
                  <td className="align-left">
                    <a href={`https://www.amazon.com/dp/${a.asin}`} target="_blank" rel="noopener" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      Amazon{a.official && <span style={{ color: CLAUDE_POS.text, fontFamily: 'var(--font-mono)', fontSize: 9, marginLeft: 6 }}>✓ official</span>}
                    </a>
                  </td>
                  <td style={{ color: a.price ? 'var(--text)' : 'var(--dimmer)', fontWeight: 600 }}>
                    {a.price != null ? `$${a.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: 'var(--dimmer)' }}>{a.priceScrapedAt ? new Date(a.priceScrapedAt).toLocaleDateString() : ''}</td>
                  <td style={{ color: 'var(--text)' }} title={a.ratingCount != null ? `${a.ratingCount.toLocaleString()} reviews` : undefined}>
                    {a.avgRating != null ? `${a.avgRating.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              ))}
              {lens.bh && (
                <tr>
                  <td className="align-left">
                    <a href={lens.bh.url} target="_blank" rel="noopener" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      B&amp;H{lens.bh.official && <span style={{ color: CLAUDE_POS.text, fontFamily: 'var(--font-mono)', fontSize: 9, marginLeft: 6 }}>✓ official</span>}
                    </a>
                  </td>
                  <td style={{ color: lens.bh.price ? 'var(--text)' : 'var(--dimmer)', fontWeight: 600 }}>
                    {lens.bh.price != null ? `$${lens.bh.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: 'var(--dimmer)' }}>{lens.bh.priceScrapedAt ? new Date(lens.bh.priceScrapedAt).toLocaleDateString() : ''}</td>
                  <td style={{ color: 'var(--text)' }} title={lens.bh.ratingCount != null ? `${lens.bh.ratingCount.toLocaleString()} reviews` : undefined}>
                    {lens.bh.starCount != null ? `${lens.bh.starCount.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              )}
              {lens.adorama && (
                <tr>
                  <td className="align-left">
                    <a href={lens.adorama.url} target="_blank" rel="noopener" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      Adorama{lens.adorama.official && <span style={{ color: CLAUDE_POS.text, fontFamily: 'var(--font-mono)', fontSize: 9, marginLeft: 6 }}>✓ official</span>}
                    </a>
                  </td>
                  <td style={{ color: lens.adorama.price ? 'var(--text)' : 'var(--dimmer)', fontWeight: 600 }}>
                    {lens.adorama.price != null ? `$${lens.adorama.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: 'var(--dimmer)' }}>{lens.adorama.priceScrapedAt ? new Date(lens.adorama.priceScrapedAt).toLocaleDateString() : ''}</td>
                  <td style={{ color: 'var(--text)' }} title={lens.adorama.ratingCount != null ? `${lens.adorama.ratingCount.toLocaleString()} reviews` : undefined}>
                    {lens.adorama.starCount != null ? `${lens.adorama.starCount.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              )}
              {lens.retailers && Object.entries(lens.retailers).map(([slug, r]) => (
                <tr key={slug}>
                  <td className="align-left">
                    <a href={r.url} target="_blank" rel="noopener" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      {r.title ?? slug.charAt(0).toUpperCase() + slug.slice(1)}
                    </a>
                  </td>
                  <td style={{ color: r.price ? 'var(--text)' : 'var(--dimmer)', fontWeight: 600 }}>
                    {r.price != null ? `$${r.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: 'var(--dimmer)' }}>{r.priceScrapedAt ? new Date(r.priceScrapedAt).toLocaleDateString() : ''}</td>
                  <td style={{ color: 'var(--dimmer)' }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {/* Gallery */}
      {hasGallery && (
        <CollapsibleSection title="Gallery" meta={<span>{activeGallery.length} images</span>}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['reddit', 'amazon', 'bh'] as const).map(s => {
              const count = s === 'reddit' ? gallery.length : s === 'amazon' ? amazonGallery.length : bhGallery.length;
              const active = sourceFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSource(s)}
                  disabled={count === 0}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.08em',
                    textTransform: 'uppercase', padding: '4px 10px', borderRadius: 2, cursor: count === 0 ? 'default' : 'pointer',
                    border: `1px solid ${active ? 'var(--text)' : 'var(--line)'}`,
                    background: active ? 'var(--text)' : 'transparent',
                    color: active ? 'var(--paper)' : count === 0 ? 'var(--dimmer)' : 'var(--text)',
                    transition: 'all 0.15s',
                  }}
                >
                  {s} <span style={{ opacity: 0.5, marginLeft: 4 }}>{count}</span>
                </button>
              );
            })}
          </div>
          <div ref={setGalleryGridEl} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {activeGallery.slice(0, visibleCount).map((tile, i) => (
              <button
                key={`${sourceFilter}-${tile.source}-${i}`}
                type="button"
                onClick={() => setLightboxIndex(i)}
                title={tile.title}
                style={{ display: 'block', aspectRatio: '1/1', overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--paper)', padding: 0, cursor: 'pointer' }}
              >
                <img src={tile.src} alt={tile.title} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
          </div>
          {canExpandGallery && (
            <button
              type="button"
              onClick={() => setGalleryExpanded(v => !v)}
              style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, padding: 0, letterSpacing: '0.05em' }}
            >
              {galleryExpanded ? '▾ show less' : `▸ show ${activeGallery.length - collapsedCount} more`}
            </button>
          )}
        </CollapsibleSection>
      )}

      {/* Claude Sentiment */}
      {claude && claude.mentionCount > 0 && (
        <CollapsibleSection title="Claude Sentiment" meta={<ClaudePill value={claude.score} />}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <SentimentBadge label={claude.label} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dim)' }}>
              {claude.mentionCount} qualifying {claude.mentionCount === 1 ? 'mention' : 'mentions'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dimmer)' }}>
              based on{' '}
              {[
                sourceCounts.reddit && `${sourceCounts.reddit} Reddit`,
                sourceCounts.amazon && `${sourceCounts.amazon} Amazon`,
                sourceCounts.bh && `${sourceCounts.bh} B&H`,
                sourceCounts.adorama && `${sourceCounts.adorama} Adorama`,
              ].filter(Boolean).join(' · ') || 'no sources'}
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 15, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 20px 0' }}>
            {claude.summary}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: CLAUDE_POS.text, marginBottom: 12 }}>Positives</div>
              {claude.positives.length > 0 ? (
                <ul style={{ margin: 0, padding: 0 }}>{claude.positives.map(renderCitation)}</ul>
              ) : (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dimmer)', margin: 0 }}>None identified</p>
              )}
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: CLAUDE_NEG.text, marginBottom: 12 }}>Negatives</div>
              {claude.negatives.length > 0 ? (
                <ul style={{ margin: 0, padding: 0 }}>{claude.negatives.map(renderCitation)}</ul>
              ) : (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dimmer)', margin: 0 }}>None identified</p>
              )}
            </div>
          </div>
          {retailerReviews.length > 0 && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <button
                type="button"
                onClick={() => setSourcesExpanded(v => !v)}
                style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, padding: 0, letterSpacing: '0.05em' }}
              >
                {sourcesExpanded ? '▾' : '▸'} retailer reviews ({retailerReviews.length})
              </button>
              {sourcesExpanded && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {retailerReviews.map((r, i) => (
                    <div key={i} style={{ borderLeft: `2px solid ${r.sourceType === 'amazon' ? 'oklch(74% 0.14 65)' : r.sourceType === 'adorama' ? 'oklch(60% 0.18 20)' : 'oklch(65% 0.12 240)'}`, paddingLeft: 12 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, color: r.sourceType === 'amazon' ? 'oklch(55% 0.16 65)' : r.sourceType === 'adorama' ? 'oklch(50% 0.2 20)' : 'oklch(45% 0.12 240)' }}>
                          {r.sourceType === 'amazon' ? 'Amazon' : r.sourceType === 'adorama' ? 'Adorama' : 'B&H'}
                        </span>
                        {r.rating != null && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'oklch(65% 0.16 85)' }}>
                            {'★'.repeat(Math.round(r.rating))}{'☆'.repeat(Math.max(0, 5 - Math.round(r.rating)))}
                          </span>
                        )}
                        {r.verifiedPurchase && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: CLAUDE_POS.text }}>verified</span>}
                        {r.date && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--dimmer)' }}>{r.date}</span>}
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--dimmer)', marginLeft: 'auto', textDecoration: 'none' }}>
                            source ↗
                          </a>
                        )}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text)' }}>
                        {r.text.length > 500 ? r.text.slice(0, 497) + '…' : r.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* YouTube Reviews */}
      {youtubeVideos.length > 0 && (
        <CollapsibleSection title="YouTube Reviews" meta={<span>{youtubeVideos.length} videos</span>}>
          {youtubeVideos.map(v => (
            <div key={v.videoId} style={{ marginBottom: 28, paddingBottom: 28, borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <a href={v.url} target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
                    {[v.channelTitle ?? v.reviewer, v.title].filter(Boolean).join(' — ') || v.videoId}
                  </a>
                  {typeof v.viewCount === 'number' && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--dimmer)', marginTop: 3 }}>
                      {v.viewCount.toLocaleString()} views
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SentimentBadge label={v.label} />
                  <ClaudePill value={v.score} />
                </div>
              </div>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 14px 0' }}>
                {v.summary}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                {v.positives.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: CLAUDE_POS.text, marginBottom: 8 }}>Positives</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {v.positives.map((q, i) => <li key={i} style={{ fontFamily: 'var(--font-serif)', fontSize: 13, fontStyle: 'italic', color: 'var(--dim)', marginBottom: 4 }}>&ldquo;{q}&rdquo;</li>)}
                    </ul>
                  </div>
                )}
                {v.negatives.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: CLAUDE_NEG.text, marginBottom: 8 }}>Negatives</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {v.negatives.map((q, i) => <li key={i} style={{ fontFamily: 'var(--font-serif)', fontSize: 13, fontStyle: 'italic', color: 'var(--dim)', marginBottom: 4 }}>&ldquo;{q}&rdquo;</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Top Posts */}
      <CollapsibleSection title="Top Reddit Posts" meta={<span></span>} defaultOpen={false}>
        {topPosts.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dimmer)', margin: 0 }}>No matched posts.</p>
        ) : (
          <table className="spectrum-table">
            <thead>
              <tr>
                <th className="align-left">Post</th>
                <th className="align-left">Subreddit</th>
                <th>Score</th>
                <th>Comments</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {topPosts.map(({ post, weight }) => (
                <tr key={post.id} className="data-row">
                  <td className="align-left" style={{ maxWidth: 480, whiteSpace: 'normal' }}>
                    <a href={post.id && post.subreddit ? postCommentsUrl(post) : post.url} target="_blank" rel="noopener" style={{ color: 'var(--text)', textDecoration: 'none', fontFamily: 'var(--font-display)', fontSize: 12.5 }}>
                      {post.title.length > 90 ? post.title.slice(0, 87) + '…' : post.title}
                    </a>
                  </td>
                  <td className="align-left" style={{ color: 'var(--dim)' }}>r/{post.subreddit}</td>
                  <td>{post.score.toLocaleString()}</td>
                  <td>{post.num_comments}</td>
                  <td>{weight.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CollapsibleSection>

      {/* Top Comments */}
      <CollapsibleSection title="Top Reddit Comments" meta={<span></span>} defaultOpen={false}>
        {topComments.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--dimmer)', margin: 0 }}>No matched comments.</p>
        ) : (
          <table className="spectrum-table">
            <thead>
              <tr>
                <th className="align-left">Comment</th>
                <th>Score</th>
                <th className="align-left">From</th>
              </tr>
            </thead>
            <tbody>
              {topComments.map((c, i) => {
                const shortBody = c.body.length > 240 ? c.body.slice(0, 237) + '…' : c.body;
                return (
                  <tr key={i}>
                    <td className="align-left" style={{ maxWidth: 520, whiteSpace: 'normal' }}>
                      {c.commentPermalink ? (
                        <a href={c.commentPermalink} target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.5, color: 'var(--text)', textDecoration: 'none' }}>
                          {shortBody}
                        </a>
                      ) : (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>{shortBody}</span>
                      )}
                    </td>
                    <td>{c.score.toLocaleString()}</td>
                    <td className="align-left">
                      <a href={c.postUrl} target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-display)', fontSize: 11.5, color: 'var(--text)', textDecoration: 'none', display: 'block' }}>
                        {c.postTitle.length > 50 ? c.postTitle.slice(0, 47) + '…' : c.postTitle}
                      </a>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--dimmer)', marginTop: 2 }}>r/{c.subreddit}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CollapsibleSection>

      {/* Related from brand */}
      {related.length > 0 && (
        <CollapsibleSection title={`More from ${lens.brand}`} meta={<span></span>} defaultOpen={false}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {related.map(({ lens: r, mentions: m }) => (
              <a
                key={r.id}
                href={`#/lens/${encodeURIComponent(r.id)}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', border: '1px solid var(--line)', background: 'var(--paper)',
                  fontFamily: 'var(--font-display)', fontSize: 12.5, color: 'var(--text)', textDecoration: 'none',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: bColor, display: 'inline-block', flexShrink: 0 }} />
                <strong>{r.name}</strong>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--dimmer)' }}>{m}</span>
              </a>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {lightboxIndex != null && activeGallery.length > 0 && (
        <GalleryLightbox
          tiles={activeGallery}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
        />
      )}
    </div>
  );
}

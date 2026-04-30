import { useEffect, useMemo, useState } from 'react';
import type { DashboardData, Post, VideoSentiment, ReviewSource, SentimentCitation, ReviewItem, BHProperty } from '../types';

const SOURCE_LABEL: Record<ReviewSource, string> = {
  reddit_post: 'Reddit post',
  reddit_comment: 'Reddit comment',
  amazon: 'Amazon',
  bh: 'B&H',
  adorama: 'Adorama',
  youtube: 'YouTube',
};

const SOURCE_COLOR: Record<ReviewSource, string> = {
  reddit_post: '#ff4500',
  reddit_comment: '#ff4500',
  amazon: '#ff9900',
  bh: '#0066cc',
  adorama: '#e11d2c',
  youtube: '#ff0033',
};
import { BrandBadge } from '../components/BrandBadge';
import { StatPill } from '../components/StatPill';
import { TagPillRow } from '../components/TagPill';
import { GalleryLightbox, type GalleryTile } from '../components/GalleryLightbox';
import { WordCloudCanvas } from '../components/WordCloudCanvas';
import { brandOf, calcWeight, buildCloudData, postCommentsUrl, commentPermalink } from '../utils';
import { brandHref, bodyHref } from '../hooks/useHashRoute';

interface Props {
  data: DashboardData;
  lensId: string;
}

const CartIcon = () => (
  <svg
    width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    style={{ verticalAlign: '-2px', marginRight: '0.4rem' }}
  >
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

// Normalizes retailer image URLs pulled from stored data:
//   - Amazon thumbnails carry a size suffix like `._SY88` before the extension;
//     dropping it resolves to the full-size original.
//   - B&H stores Cloudflare-resized paths like
//     `/cdn-cgi/image/fit=scale-down,width=200/https://photos-us.bazaarvoice.com/…`
//     — the absolute source URL is embedded after the directive, so we unwrap it.
function normalizeRetailerImage(src: string): string {
  const stripped = src.replace(/\._[^.]+(\.\w+)$/, '$1');
  const bhMatch = stripped.match(/^\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/);
  return bhMatch ? bhMatch[1] : stripped;
}

// Claude returns verbatim quotes from the input items but no URL — so we
// find the originating item at render time by matching the quote back into
// the same haystack `claude-sentiment.ts` verified against, then return its
// public-facing URL (review URL, post comments URL, or comment permalink).
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
      const postText = post.title + (post.selftext && post.selftext !== '[removed]'
        ? ': ' + post.selftext.slice(0, 300)
        : '');
      if (norm(postText).includes(needle)) {
        return post.id && post.subreddit ? postCommentsUrl(post) : post.url;
      }
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

function scoreColor(score: number): string {
  if (score >= 0.7) return '#4ade80';
  if (score >= 0.4) return '#facc15';
  if (score >= 0.1) return '#fb923c';
  return '#f87171';
}

function labelColors(label: string) {
  const styles: Record<string, { bg: string; color: string }> = {
    positive: { bg: '#1a2e1a', color: '#4ade80' },
    neutral:  { bg: '#232323', color: '#9ca3af' },
    mixed:    { bg: '#2a2200', color: '#facc15' },
    negative: { bg: '#2e1a1a', color: '#f87171' },
  };
  return styles[label] ?? styles.neutral;
}

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

function BHSpecsTable({ props }: { props: BHProperty }) {
  const rows = SPEC_LABELS.map(([key, label]) => [label, props[key]] as [string, string | undefined]).filter(([, v]) => v != null);
  if (!rows.length) return null;
  return (
    <div style={{ flexShrink: 0 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td style={{ color: '#4a4a4a', fontSize: '0.67rem', paddingRight: '0.6rem', paddingTop: '1px', paddingBottom: '1px', whiteSpace: 'nowrap', verticalAlign: 'top', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}
              </td>
              <td style={{ color: '#aaa', fontSize: '0.72rem', paddingTop: '1px', paddingBottom: '1px', lineHeight: 1.35, maxWidth: 180 }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LensDetailPage({ data, lensId }: Props) {
  const { results, lensById, sentiment, claudeSentiment, youtubeSentiment, reviews, lenses, bodyById } = data;
  const lens = lensById[lensId];
  const stat = results.stats.find(s => s.lensId === lensId);
  const claude = claudeSentiment[lensId];
  const lexicon = sentiment[lensId];
  const youtube = youtubeSentiment[lensId];
  // Drop videos Claude couldn't extract opinions from (empty transcripts, music-only, etc.)
  const youtubeVideos = youtube?.videos.filter(v => v.mentionCount > 0) ?? [];

  // Top posts for this lens (by weight)
  const topPosts = useMemo(() => {
    const matched: Array<{ post: Post; weight: number }> = [];
    for (const post of results.posts) {
      if (post.postLensIds.includes(lensId)) {
        matched.push({ post, weight: calcWeight(post) });
      }
    }
    matched.sort((a, b) => b.weight - a.weight);
    return matched.slice(0, 10);
  }, [results.posts, lensId]);

  // Gallery tiles drawn from post-matched posts, weighted. Prefers the new
  // images[] field from the scraper; falls back to post.url when it's a
  // direct image link (covers pre-rescrape data).
  const gallery = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    const matched: Array<{ post: Post; weight: number }> = [];
    for (const post of results.posts) {
      if (post.postLensIds.includes(lensId)) {
        matched.push({ post, weight: calcWeight(post) });
      }
    }
    matched.sort((a, b) => b.weight - a.weight);
    const LIMIT = 30;
    for (const { post } of matched) {
      const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
      const meta = [
        { label: 'subreddit', value: `r/${post.subreddit}` },
        { label: 'score', value: post.score.toLocaleString() },
        { label: 'comments', value: post.num_comments.toLocaleString() },
      ];
      const pushTile = (src: string) => tiles.push({
        src,
        source: 'reddit',
        linkUrl: postUrl,
        linkLabel: 'View post on Reddit',
        title: post.title,
        meta,
      });
      if (post.images && post.images.length > 0) {
        for (const img of post.images) {
          pushTile(img.url);
          if (tiles.length >= LIMIT) break;
        }
      } else if (!post.is_self && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(post.url)) {
        pushTile(post.url);
      }
      if (tiles.length >= LIMIT) break;
    }
    return tiles;
  }, [results.posts, lensId]);

  // Retailer gallery tiles — flattened user-submitted review images. One tile
  // per image; each carries back to the review it was posted with.
  const amazonGallery = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    const items = reviews[lensId] ?? [];
    for (const item of items) {
      if (item.sourceType !== 'amazon') continue;
      if (!item.images?.length) continue;
      const caption = item.text.length > 160 ? item.text.slice(0, 157) + '…' : item.text;
      const meta: Array<{ label: string; value: string }> = [];
      if (item.rating != null) meta.push({ label: 'rating', value: `${item.rating}★` });
      if (item.verifiedPurchase) meta.push({ label: 'purchase', value: 'verified' });
      if (item.date) meta.push({ label: 'date', value: item.date });
      if (item.upvoteScore != null) meta.push({ label: 'helpful', value: String(item.upvoteScore) });
      for (const src of item.images) {
        tiles.push({
          src: normalizeRetailerImage(src),
          source: 'amazon',
          linkUrl: item.url ?? '#',
          linkLabel: 'View review on Amazon',
          title: caption,
          meta,
        });
      }
    }
    return tiles;
  }, [reviews, lensId]);

  // B&H sidebar images live on BHEntry.images (captured from the review photo
  // sidebar after opening the reviews tab), not in reviews.json — so there's
  // no per-image review attribution. Surface product-level context instead.
  const bhGallery = useMemo((): GalleryTile[] => {
    const bh = lens.bh;
    if (!bh) return [];
    const meta: Array<{ label: string; value: string }> = [];
    if (bh.starCount != null) meta.push({ label: 'avg rating', value: `${bh.starCount}★` });
    if (bh.ratingCount != null) meta.push({ label: 'reviews', value: bh.ratingCount.toLocaleString() });
    if (bh.official) meta.push({ label: 'seller', value: 'authorized' });
    return (bh.images ?? []).map((src): GalleryTile => ({
      src: normalizeRetailerImage(src),
      source: 'bh',
      linkUrl: bh.url,
      linkLabel: 'View product on B&H',
      title: bh.title ?? `${lens.brand} ${lens.name}`,
      meta,
    }));
  }, [lens]);

  // Adorama product images from AdoramaEntry.images — same pattern as bhGallery.

  // Combined view interleaves sources round-robin so variety surfaces in the
  // first visible rows rather than burying the smaller sets (typically B&H) at
  // the end.
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

  // Default to combined; pills toggle to a single source and back.
  const [sourceFilter, setSourceFilter] = useState<'all' | 'reddit' | 'amazon' | 'bh'>('all');
  const toggleSource = (s: 'reddit' | 'amazon' | 'bh') =>
    setSourceFilter(prev => (prev === s ? 'all' : s));

  // Counts by source — drives the "Based on …" line under Claude's summary so
  // readers can see the breadth of material that fed the analysis.
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

  // Retailer reviews grouped for the collapsible source panel inside the Claude
  // card. Higher-rated first so the sample skews toward the most common signal.
  const retailerReviews = useMemo(() => {
    const items = reviews[lensId] ?? [];
    return items
      .filter(r => r.sourceType === 'amazon' || r.sourceType === 'bh' || r.sourceType === 'adorama')
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }, [reviews, lensId]);

  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  // Render one Claude citation with the quote wrapped as a link back to its
  // source item (review URL, post comments URL, or comment permalink). Falls
  // back to a plain block when the quote can't be matched — shouldn't happen
  // post-verifyCitations, but don't break the UI if it does.
  const renderCitation = (c: SentimentCitation, i: number) => {
    const url = resolveCitationUrl(c, lensId, reviews[lensId] ?? [], results.posts);
    const quoteStyle = { color: '#999', fontStyle: 'italic' as const, fontSize: '0.8rem', lineHeight: 1.45, marginTop: '0.25rem' };
    const sourceLabel = SOURCE_LABEL[c.source] ?? c.source;
    const sourceColor = SOURCE_COLOR[c.source] ?? '#666';
    const sourceStyle = { marginTop: '0.25rem', fontSize: '0.7rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: sourceColor };
    return (
      <li key={i} style={{ marginBottom: '0.8rem' }}>
        <div style={{ color: '#e0e0e0', fontSize: '0.9rem' }}>{c.aspect}</div>
        {url ? (
          <a href={url} target="_blank" rel="noopener" title="View source" style={{ ...quoteStyle, display: 'block', textDecoration: 'none' }}>
            &ldquo;{c.quote}&rdquo;
          </a>
        ) : (
          <div style={quoteStyle}>&ldquo;{c.quote}&rdquo;</div>
        )}
        {url ? (
          <a href={url} target="_blank" rel="noopener" style={{ ...sourceStyle, display: 'inline-block', textDecoration: 'none' }}>
            {sourceLabel} ↗
          </a>
        ) : (
          <div style={sourceStyle}>{sourceLabel}</div>
        )}
      </li>
    );
  };

  // Gallery collapses to 2 rows by default. Row count in a responsive
  // `repeat(auto-fill, 1fr)` grid depends on viewport width, so we read the
  // resolved `grid-template-columns` via ResizeObserver instead of guessing.
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [galleryGridEl, setGalleryGridEl] = useState<HTMLDivElement | null>(null);
  const [galleryCols, setGalleryCols] = useState(4);
  useEffect(() => {
    if (!galleryGridEl) return;
    const measure = () => {
      const n = window.getComputedStyle(galleryGridEl)
        .getPropertyValue('grid-template-columns')
        .split(' ')
        .filter(Boolean).length;
      if (n > 0) setGalleryCols(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(galleryGridEl);
    return () => ro.disconnect();
  }, [galleryGridEl]);
  // Reset to collapsed when changing filters so each view opens compact.
  useEffect(() => { setGalleryExpanded(false); }, [sourceFilter]);
  const activeGallery =
    sourceFilter === 'all' ? combinedGallery :
    sourceFilter === 'reddit' ? gallery :
    sourceFilter === 'amazon' ? amazonGallery :
    bhGallery;
  const collapsedCount = galleryCols * 2;
  const canExpandGallery = activeGallery.length > collapsedCount;
  const visibleCount = galleryExpanded ? activeGallery.length : collapsedCount;

  // Lightbox overlay — opens on tile click and cycles through the full active
  // gallery (not just the visible thumbnails, so users can page past the
  // collapsed limit with arrow keys).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Top comments that actually mention this lens
  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; postTitle: string; postUrl: string; subreddit: string; commentPermalink?: string }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        // Prefer per-comment attribution when available; fall back to post-level for older data.
        const attributed = c.lensIds ? c.lensIds.includes(lensId) : post.commentLensIds.includes(lensId);
        if (!attributed) continue;
        const permalink = c.id && post.id && post.subreddit
          ? commentPermalink(post, c.id)
          : undefined;
        const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
        items.push({ body: c.body, score: c.score, postTitle: post.title, postUrl, subreddit: post.subreddit, commentPermalink: permalink });
      }
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, 10);
  }, [results.posts, lensId]);

  // Per-lens word cloud
  const cloud = useMemo(() => (
    lexicon ? buildCloudData([lexicon]) : { list: [], colorMap: {} }
  ), [lexicon]);

  // Bodies most frequently co-mentioned with this lens
  const pairedBodies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of results.posts) {
      if (!post.postLensIds.includes(lensId) && !post.commentLensIds.includes(lensId)) continue;
      for (const id of [...post.postLensIds, ...post.commentLensIds]) {
        if (id.startsWith('body-')) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .flatMap(([id, count]) => bodyById[id] ? [{ body: bodyById[id], count }] : []);
  }, [results.posts, lensId, bodyById]);

  // Related lenses (same brand, excluding current)
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
      <>
        <a href="#" className="back-link">← Back</a>
        <div className="card full" style={{ marginTop: '1rem' }}>
          <h2>Lens not found</h2>
          <p className="meta">No lens with id <code>{lensId}</code>.</p>
        </div>
      </>
    );
  }

  const brand = brandOf(lensId, lensById);
  const mentions = (stat?.postCount ?? 0) + (stat?.commentCount ?? 0);

  return (
    <>
      <a href="#" className="back-link">← Back to overview</a>

      {/* Hero + stats */}
      <div className="card full lens-hero">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div style={{ flex: '1 1 260px', minWidth: '200px' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <BrandBadge brand={brand} />
              <span style={{ marginLeft: '0.6rem', color: '#666', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {lens.mount}
              </span>
            </div>
            <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem 0' }}>
              <a href={brandHref(lens.brand)} style={{ color: 'inherit', textDecoration: 'none' }}>
                {lens.brand}
              </a>{' '}
              {lens.name}
            </h1>
            <div style={{ color: '#888', fontSize: '0.95rem', marginBottom: '0.75rem' }}>
              {lens.focalLength} · {lens.maxAperture}
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <TagPillRow tags={lens.category ?? []} />
            </div>
            {lens.aliases.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
                {lens.aliases.map(a => (
                  <span key={a} className="alias-pill">{a}</span>
                ))}
              </div>
            )}
            {lens.amazon?.searchLink && (
              <a href={lens.amazon.searchLink} target="_blank" rel="noopener" className="shop-button">
                <CartIcon />
                Search on Amazon
              </a>
            )}
          </div>
          {lens.bh?.properties && <BHSpecsTable props={lens.bh.properties} />}
        </div>
        <div className="hero-stats">
          <StatPill
            label="Post Mentions"
            value={stat?.postCount ?? 0}
            info="Number of posts whose title or body matched this lens."
          />
          <StatPill
            label="Comment Mentions"
            value={stat?.commentCount ?? 0}
            info="Number of posts where the lens appeared only in the comment thread (disjoint from Post Mentions — a post that matches in both title and comments counts once as a post mention)."
          />
          <StatPill
            label="Total Mentions"
            value={mentions}
            info="Post Mentions + Comment Mentions — how many distinct posts contributed to this lens's stats."
          />
          <StatPill
            label="Score Sentiment"
            value={stat ? stat.scoreSentiment.toFixed(2) : '—'}
            info="Per-post weight = log(1 + score) × upvote_ratio × 0.5 + log(1 + num_comments) × 0.5, halved for self-posts. Aggregated across posts as mean(weights) × log(1 + count) so a few excellent matches aren't buried by many mediocre ones."
          />
          <StatPill
            label="Claude Score"
            value={claude ? `${claude.score > 0 ? '+' : ''}${claude.score.toFixed(2)}` : '—'}
            info="Claude's sentiment score on a −1 to +1 scale, derived from qualifying opinion mentions about optical/build quality."
          />
        </div>
      </div>

      {/* Retailers price table */}
      {(lens.amazon?.asins?.length || lens.bh || lens.adorama || lens.retailers) && (
        <div className="card full">
          <h2>Retailers</h2>
          <table>
            <thead>
              <tr>
                <th>Retailer</th>
                <th className="num-header">Price</th>
                <th>Scraped</th>
                <th className="num-header">Rating</th>
              </tr>
            </thead>
            <tbody>
              {lens.amazon?.asins?.map(a => (
                <tr key={a.asin}>
                  <td>
                    <a href={`https://www.amazon.com/dp/${a.asin}`} target="_blank" rel="noopener">
                      Amazon{a.official && <span className="official-tag"> ✓ official</span>}
                    </a>
                  </td>
                  <td className="num" style={{ color: a.price ? '#4ade80' : '#555', fontWeight: 600 }}>
                    {a.price != null ? `$${a.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: '#555', fontSize: '0.75rem' }}>
                    {a.priceScrapedAt ? new Date(a.priceScrapedAt).toLocaleDateString() : ''}
                  </td>
                  <td
                    className="num"
                    style={{ color: a.avgRating != null ? '#facc15' : '#555', fontWeight: 600 }}
                    title={a.ratingCount != null ? `${a.ratingCount.toLocaleString()} reviews` : undefined}
                  >
                    {a.avgRating != null ? `${a.avgRating.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              ))}
              {lens.bh && (
                <tr key="bh">
                  <td>
                    <a href={lens.bh.url} target="_blank" rel="noopener">
                      B&amp;H{lens.bh.official && <span className="official-tag"> ✓ official</span>}
                    </a>
                  </td>
                  <td className="num" style={{ color: lens.bh.price ? '#4ade80' : '#555', fontWeight: 600 }}>
                    {lens.bh.price != null ? `$${lens.bh.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: '#555', fontSize: '0.75rem' }}>
                    {lens.bh.priceScrapedAt ? new Date(lens.bh.priceScrapedAt).toLocaleDateString() : ''}
                  </td>
                  <td
                    className="num"
                    style={{ color: lens.bh.starCount != null ? '#facc15' : '#555', fontWeight: 600 }}
                    title={lens.bh.ratingCount != null ? `${lens.bh.ratingCount.toLocaleString()} reviews` : undefined}
                  >
                    {lens.bh.starCount != null ? `${lens.bh.starCount.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              )}
              {lens.adorama && (
                <tr key="adorama">
                  <td>
                    <a href={lens.adorama.url} target="_blank" rel="noopener">
                      Adorama{lens.adorama.official && <span className="official-tag"> ✓ official</span>}
                    </a>
                  </td>
                  <td className="num" style={{ color: lens.adorama.price ? '#4ade80' : '#555', fontWeight: 600 }}>
                    {lens.adorama.price != null ? `$${lens.adorama.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: '#555', fontSize: '0.75rem' }}>
                    {lens.adorama.priceScrapedAt ? new Date(lens.adorama.priceScrapedAt).toLocaleDateString() : ''}
                  </td>
                  <td
                    className="num"
                    style={{ color: lens.adorama.starCount != null ? '#facc15' : '#555', fontWeight: 600 }}
                    title={lens.adorama.ratingCount != null ? `${lens.adorama.ratingCount.toLocaleString()} reviews` : undefined}
                  >
                    {lens.adorama.starCount != null ? `${lens.adorama.starCount.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              )}
              {lens.retailers && Object.entries(lens.retailers).map(([slug, r]) => (
                <tr key={slug}>
                  <td>
                    <a href={r.url} target="_blank" rel="noopener">
                      {r.title ?? slug.charAt(0).toUpperCase() + slug.slice(1)}
                    </a>
                  </td>
                  <td className="num" style={{ color: r.price ? '#4ade80' : '#555', fontWeight: 600 }}>
                    {r.price != null ? `$${r.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: '#555', fontSize: '0.75rem' }}>
                    {r.priceScrapedAt ? new Date(r.priceScrapedAt).toLocaleDateString() : ''}
                  </td>
                  <td className="num" style={{ color: '#555' }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Gallery */}
      {(gallery.length > 0 || amazonGallery.length > 0 || bhGallery.length > 0) && (
        <div className="card full">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>Gallery</h2>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => toggleSource('reddit')}
                disabled={gallery.length === 0}
                className={`tab-pill${sourceFilter === 'reddit' ? ' active' : ''}`}
              >
                Reddit <span style={{ color: '#666', marginLeft: '0.3rem' }}>{gallery.length}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleSource('amazon')}
                disabled={amazonGallery.length === 0}
                className={`tab-pill${sourceFilter === 'amazon' ? ' active' : ''}`}
              >
                Amazon <span style={{ color: '#666', marginLeft: '0.3rem' }}>{amazonGallery.length}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleSource('bh')}
                disabled={bhGallery.length === 0}
                className={`tab-pill${sourceFilter === 'bh' ? ' active' : ''}`}
              >
                B&amp;H <span style={{ color: '#666', marginLeft: '0.3rem' }}>{bhGallery.length}</span>
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '0.25rem', marginBottom: '1rem' }}>
            {sourceFilter === 'all' && 'Images from Reddit posts, Amazon reviews, and B&H reviews — click a pill to filter.'}
            {sourceFilter === 'reddit' && 'Images from top-weighted Reddit posts that mention this lens.'}
            {sourceFilter === 'amazon' && 'User-submitted images from verified Amazon reviews.'}
            {sourceFilter === 'bh' && 'User-submitted images from verified B&H reviews.'}
          </p>
          <div ref={setGalleryGridEl} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
            {activeGallery.slice(0, visibleCount).map((tile, i) => (
              <button
                type="button"
                key={`${sourceFilter}-${tile.source}-${i}`}
                onClick={() => setLightboxIndex(i)}
                title={tile.title}
                style={{
                  display: 'block',
                  aspectRatio: '1 / 1',
                  overflow: 'hidden',
                  borderRadius: '4px',
                  background: '#111',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                <img
                  src={tile.src}
                  alt={tile.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
          {canExpandGallery && (
            <button
              type="button"
              onClick={() => setGalleryExpanded(v => !v)}
              style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
            >
              {galleryExpanded
                ? '▾ Show less'
                : `▸ Show ${activeGallery.length - collapsedCount} more`}
            </button>
          )}
        </div>
      )}

      {/* Claude sentiment card */}
      {claude && claude.mentionCount > 0 && (
        <div className="card full">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Claude Sentiment Analysis</h2>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <span className="badge" style={{ background: labelColors(claude.label).bg, color: labelColors(claude.label).color }}>
                {claude.label}
              </span>
              <span style={{ color: scoreColor(claude.score), fontWeight: 700, fontSize: '1.1rem' }}>
                {claude.score > 0 ? '+' : ''}{claude.score.toFixed(2)}
              </span>
              <span style={{ color: '#666', fontSize: '0.8rem' }}>
                {claude.mentionCount} qualifying {claude.mentionCount === 1 ? 'mention' : 'mentions'}
              </span>
            </div>
          </div>
          <p style={{ color: '#d0d0d0', lineHeight: 1.55, fontSize: '0.95rem', margin: '0 0 0.6rem 0' }}>
            {claude.summary}
          </p>
          <div style={{ color: '#777', fontSize: '0.78rem', marginBottom: '1.5rem' }}>
            Based on{' '}
            {[
              sourceCounts.reddit && `${sourceCounts.reddit} Reddit`,
              sourceCounts.amazon && `${sourceCounts.amazon} Amazon`,
              sourceCounts.bh && `${sourceCounts.bh} B&H`,
              sourceCounts.adorama && `${sourceCounts.adorama} Adorama`,
            ].filter(Boolean).join(' · ') || 'no source material'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
            <div>
              <h3 className="sentiment-heading" style={{ color: '#4ade80' }}>Positives</h3>
              {claude.positives.length > 0 ? (
                <ul className="sentiment-list citation-list">
                  {claude.positives.map(renderCitation)}
                </ul>
              ) : (
                <p className="meta" style={{ margin: 0 }}>None identified</p>
              )}
            </div>
            <div>
              <h3 className="sentiment-heading" style={{ color: '#f87171' }}>Negatives</h3>
              {claude.negatives.length > 0 ? (
                <ul className="sentiment-list citation-list">
                  {claude.negatives.map(renderCitation)}
                </ul>
              ) : (
                <p className="meta" style={{ margin: 0 }}>None identified</p>
              )}
            </div>
          </div>
          {retailerReviews.length > 0 && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #222' }}>
              <button
                type="button"
                onClick={() => setSourcesExpanded(v => !v)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
              >
                {sourcesExpanded ? '▾' : '▸'} Retailer reviews ({retailerReviews.length})
              </button>
              {sourcesExpanded && (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {retailerReviews.map((r, i) => (
                    <div key={i} style={{ borderLeft: '2px solid #2a2a2a', paddingLeft: '0.8rem' }}>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.3rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ color: r.sourceType === 'amazon' ? '#ff9900' : r.sourceType === 'adorama' ? '#e11d2c' : '#0066cc', fontWeight: 600 }}>
                          {r.sourceType === 'amazon' ? 'Amazon' : r.sourceType === 'adorama' ? 'Adorama' : 'B&H'}
                        </span>
                        {r.rating != null && (
                          <span style={{ color: '#facc15' }}>
                            {'★'.repeat(Math.round(r.rating))}{'☆'.repeat(Math.max(0, 5 - Math.round(r.rating)))}
                          </span>
                        )}
                        {r.verifiedPurchase && <span style={{ color: '#4ade80' }}>verified</span>}
                        {r.date && <span style={{ color: '#666' }}>{r.date}</span>}
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener" style={{ color: '#666', marginLeft: 'auto' }}>
                            source ↗
                          </a>
                        )}
                      </div>
                      <div style={{ color: '#c8c8c8', lineHeight: 1.5, fontSize: '0.85rem' }}>
                        {r.text.length > 500 ? r.text.slice(0, 497) + '…' : r.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* YouTube sentiment */}
      {youtubeVideos.length > 0 && (
        <div className="card full">
          <h2>YouTube Reviews</h2>
          {youtubeVideos.map((v: VideoSentiment) => (
            <div key={v.videoId} style={{ marginBottom: '2rem', paddingBottom: '2rem', borderBottom: '1px solid #222' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <a href={v.url} target="_blank" rel="noopener" style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {[v.channelTitle ?? v.reviewer, v.title].filter(Boolean).join(' — ') || v.videoId}
                  </a>
                  {typeof v.viewCount === 'number' && (
                    <div style={{ color: '#888', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                      {v.viewCount.toLocaleString()} views
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                  <span className="badge" style={{ background: labelColors(v.label).bg, color: labelColors(v.label).color }}>
                    {v.label}
                  </span>
                  <span style={{ color: scoreColor(v.score), fontWeight: 700, fontSize: '1.1rem' }}>
                    {v.score > 0 ? '+' : ''}{v.score.toFixed(2)}
                  </span>
                </div>
              </div>
              <p style={{ color: '#d0d0d0', fontSize: '0.9rem', lineHeight: 1.55, margin: '0 0 1rem 0' }}>
                {v.summary}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                {v.positives.length > 0 && (
                  <div>
                    <h3 className="sentiment-heading" style={{ color: '#4ade80' }}>Positives</h3>
                    <ul className="sentiment-list">
                      {v.positives.map((q, i) => <li key={i} style={{ fontStyle: 'italic' }}>"{q}"</li>)}
                    </ul>
                  </div>
                )}
                {v.negatives.length > 0 && (
                  <div>
                    <h3 className="sentiment-heading" style={{ color: '#f87171' }}>Negatives</h3>
                    <ul className="sentiment-list">
                      {v.negatives.map((q, i) => <li key={i} style={{ fontStyle: 'italic' }}>"{q}"</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top posts */}
      <div className="card full">
        <h2>Top Matched Posts</h2>
        {topPosts.length === 0 ? (
          <p className="meta">No matched posts for this lens.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Subreddit</th>
                <th className="num-header">Score</th>
                <th className="num-header">Comments</th>
                <th className="num-header">Weight</th>
              </tr>
            </thead>
            <tbody>
              {topPosts.map(({ post, weight }) => (
                <tr key={post.id}>
                  <td>
                    <a href={post.id && post.subreddit ? postCommentsUrl(post) : post.url} target="_blank" rel="noopener">
                      {post.title.length > 90 ? post.title.slice(0, 87) + '…' : post.title}
                    </a>
                  </td>
                  <td>r/{post.subreddit}</td>
                  <td className="num">{post.score.toLocaleString()}</td>
                  <td className="num">{post.num_comments}</td>
                  <td className="num">{weight.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Top comments */}
      <div className="card full">
        <h2>Top Matched Comments</h2>
        {topComments.length === 0 ? (
          <p className="meta">No matched comments for this lens.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Comment</th>
                <th className="num-header">Score</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {topComments.map((c, i) => {
                const shortBody = c.body.length > 240 ? c.body.slice(0, 237) + '…' : c.body;
                return (
                <tr key={i}>
                  <td style={{ maxWidth: '600px', fontSize: '0.82rem', lineHeight: 1.5, color: '#c8c8c8' }}>
                    {c.commentPermalink ? (
                      <a
                        href={c.commentPermalink}
                        target="_blank"
                        rel="noopener"
                        title="View comment on Reddit"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {shortBody}
                      </a>
                    ) : shortBody}
                  </td>
                  <td className="num">{c.score.toLocaleString()}</td>
                  <td style={{ fontSize: '0.78rem' }}>
                    <a href={c.postUrl} target="_blank" rel="noopener">
                      {c.postTitle.length > 50 ? c.postTitle.slice(0, 47) + '…' : c.postTitle}
                    </a>
                    <div style={{ color: '#666', marginTop: '0.15rem' }}>r/{c.subreddit}</div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bodies paired with this lens */}
      {pairedBodies.length > 0 && (
        <div className="card full">
          <h2>Bodies discussed alongside this lens</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {pairedBodies.map(({ body, count }) => (
              <a key={body.id} href={bodyHref(body.id)} className="related-chip">
                <strong>{body.brand} {body.name}</strong>
                <span style={{ color: '#666', marginLeft: '0.4rem', fontSize: '0.75rem' }}>
                  {count} {count === 1 ? 'post' : 'posts'}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Related */}
      {related.length > 0 && (
        <div className="card full">
          <h2>More from <a href={brandHref(lens.brand)} style={{ color: 'inherit' }}>{lens.brand}</a></h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {related.map(({ lens: r, mentions: m }) => (
              <a key={r.id} href={`#/lens/${encodeURIComponent(r.id)}`} className="related-chip">
                <strong>{r.name}</strong>
                <span style={{ color: '#666', marginLeft: '0.4rem', fontSize: '0.75rem' }}>
                  {m} {m === 1 ? 'mention' : 'mentions'}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {lightboxIndex != null && activeGallery.length > 0 && (
        <GalleryLightbox
          tiles={activeGallery}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
        />
      )}
    </>
  );
}

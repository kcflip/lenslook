import { useState, useMemo, useEffect, useRef } from 'react';
import type {
  DashboardData, Post, SentimentCitation, ReviewItem, BHProperty, VideoSentiment, Lens,
} from '../types';
import {
  brandColor, FONT_DISPLAY, FONT_MONO,
  BG_TONES, ACCENTS, SOURCE_COLORS, CATEGORY_COLORS,
  POSITIVE_COLOR, NEGATIVE_COLOR, STAR_COLOR,
  TEXT_PRIMARY, TEXT_DIM, TEXT_DIMMER, TEXT_MUTED, TEXT_FAINT,
  BORDER, BORDER_MED,
  type BgTone, type Accent,
} from './tokens';
import { BrandDot, BrandMark } from './components/BrandMark';
import { Fold } from './components/Fold';
import { calcWeight, postCommentsUrl, commentPermalink } from '../utils';
import { brandHref, lensHref } from '../hooks/useHashRoute';

const DEFAULT_BG: BgTone = 'charcoal';
const DEFAULT_ACCENT: Accent = 'white';
const DEFAULT_THUMB = 180;
const COLLAPSED_ROWS = 2;

const SPEC_LABELS: Array<[keyof BHProperty, string]> = [
  ['focalLength', 'Focal Length'], ['maxAperture', 'Max Aperture'],
  ['minAperture', 'Min Aperture'], ['mount', 'Mount'], ['format', 'Format'],
  ['angleOfView', 'Angle of View'], ['minimumFocusDistance', 'Min Focus'],
  ['magnification', 'Magnification'], ['opticalDesign', 'Optical Design'],
  ['apertureBlades', 'Aperture Blades'], ['focusType', 'Focus Type'],
  ['imageStabilization', 'Stabilization'], ['filterSize', 'Filter Thread'],
  ['dimensions', 'Dimensions'], ['weight', 'Weight'],
];

const SOURCE_LABEL: Record<string, string> = {
  reddit_post: 'Reddit', reddit_comment: 'Reddit',
  amazon: 'Amazon', bh: 'B&H', adorama: 'Adorama', youtube: 'YouTube',
};

function normalizeRetailerImage(src: string): string {
  const stripped = src.replace(/\._[^.]+(\.\w+)$/, '$1');
  const m = stripped.match(/^\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/);
  return m ? m[1] : stripped;
}

function resolveCitationUrl(
  citation: SentimentCitation, lensId: string,
  revItems: ReviewItem[], posts: Post[],
): string | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(citation.quote);
  if (!needle) return null;
  if (['amazon', 'bh', 'adorama'].includes(citation.source)) {
    for (const r of revItems) {
      if (r.sourceType !== citation.source) continue;
      if (norm(r.text).includes(needle)) return r.url ?? null;
    }
    return null;
  }
  if (citation.source === 'reddit_post') {
    for (const post of posts) {
      if (!post.postLensIds?.includes(lensId)) continue;
      const text = post.title + (post.selftext && post.selftext !== '[removed]' ? ': ' + post.selftext.slice(0, 300) : '');
      if (norm(text).includes(needle)) return postCommentsUrl(post);
    }
    return null;
  }
  if (citation.source === 'reddit_comment') {
    for (const post of posts) {
      if (!post.commentLensIds?.includes(lensId)) continue;
      for (const c of post.matchedComments ?? []) {
        if (c.lensIds && !c.lensIds.includes(lensId)) continue;
        if (norm(c.body).includes(needle)) {
          return c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : postCommentsUrl(post);
        }
      }
    }
    return null;
  }
  return null;
}

function lowestPrice(lens: Lens): number | null {
  const prices: number[] = [];
  for (const a of lens.amazon?.asins ?? []) if (a.price != null) prices.push(a.price);
  if (lens.bh?.price != null) prices.push(lens.bh.price);
  if (lens.adorama?.price != null) prices.push(lens.adorama.price);
  if (lens.retailers) for (const r of Object.values(lens.retailers)) if (r.price != null) prices.push(r.price);
  return prices.length ? Math.min(...prices) : null;
}

interface GalleryTile {
  src: string; source: 'reddit' | 'amazon' | 'bh'; href: string;
  score?: number; imgWidth?: number; imgHeight?: number;
  title?: string; subreddit?: string; date?: number; dateStr?: string; rating?: number;
}

function GalleryItem({ tile, onOpen }: { tile: GalleryTile; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        aspectRatio: '1 / 1',
        overflow: 'hidden',
        borderRadius: 2,
        position: 'relative',
        cursor: 'zoom-in',
      }}
    >
      <img
        src={tile.src} alt="" loading="lazy" referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.2s ease',
        pointerEvents: 'none',
      }} />
      {hovered && tile.source === 'reddit' && tile.score != null && (
        <div style={{
          position: 'absolute', bottom: 4, left: 6,
          fontFamily: FONT_MONO, fontSize: 9,
          color: 'rgba(255,255,255,0.7)', pointerEvents: 'none',
        }}>
          {tile.score.toLocaleString()} ↑
        </div>
      )}
    </div>
  );
}

interface RetailerRowProps {
  name: string;
  url: string;
  official: boolean;
  price: number | null;
  scraped: string | null;
  rating: number | null;
  ratingCount: number | null;
  history: import('../types').PricePoint[] | undefined;
  accentColor: string;
  isLast: boolean;
}

function RetailerRow({ name, url, official, price, scraped, rating, ratingCount, history, accentColor, isLast }: RetailerRowProps) {
  const [open, setOpen] = useState(false);

  // Deduplicate consecutive same-price entries (sorted newest→oldest).
  // Flat runs collapse to a single row so repetitive scrape data stays readable.
  const historyRows = useMemo(() => {
    if (!history?.length) return [];
    const sorted = [...history].sort(
      (a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime(),
    );
    return sorted.filter((pt, i) => i === 0 || pt.price !== sorted[i - 1].price);
  }, [history]);

  const hasHistory = historyRows.length > 0;

  return (
    <div style={{ borderBottom: !isLast ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
      <div
        onClick={() => hasHistory && setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', cursor: hasHistory ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a href={url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
            style={{ fontSize: 14, fontWeight: 500, color: TEXT_PRIMARY, textDecoration: 'none' }}>{name}</a>
          {official && <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: POSITIVE_COLOR, letterSpacing: '0.06em' }}>✓ official</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {price != null && <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: accentColor }}>${Math.round(price).toLocaleString()}</span>}
          {scraped && <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM }}>{new Date(scraped).toLocaleDateString()}</span>}
          {rating != null && <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: STAR_COLOR }} title={ratingCount != null ? `${ratingCount.toLocaleString()} reviews` : undefined}>{rating.toFixed(1)} ★</span>}
          {hasHistory && (
            <svg width="10" height="6" viewBox="0 0 10 6" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M1 1L5 5L9 1" fill="none" stroke={TEXT_DIM} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>

      {open && hasHistory && (
        <div style={{ paddingBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {(['Date', 'Price', 'Change'] as const).map((h, i) => (
                  <th key={h} style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIMMER, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: i === 0 ? 'left' : 'right', paddingBottom: 6, fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyRows.map((pt, i) => {
                const prev = historyRows[i + 1];
                const delta = prev != null ? pt.price - prev.price : null;
                return (
                  <tr key={pt.scrapedAt}>
                    <td style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, padding: '3px 0' }}>
                      {new Date(pt.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_PRIMARY, textAlign: 'right', padding: '3px 0' }}>
                      ${pt.price.toLocaleString()}
                    </td>
                    <td style={{ fontFamily: FONT_MONO, fontSize: 10, textAlign: 'right', padding: '3px 0', color: delta == null || delta === 0 ? TEXT_FAINT : delta > 0 ? NEGATIVE_COLOR : POSITIVE_COLOR }}>
                      {delta == null || delta === 0 ? '—' : `${delta > 0 ? '+' : ''}$${Math.abs(delta).toLocaleString()}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Props { data: DashboardData; lensId: string; }

export function LensDetailPage({ data, lensId }: Props) {
  const { results, lensById, lenses, claudeSentiment, youtubeSentiment, reviews, priceHistory } = data;

  const [bgTone, setBgTone] = useState<BgTone>(() => (localStorage.getItem('lenslook:bg-tone') as BgTone) ?? DEFAULT_BG);
  const [accent, setAccent] = useState<Accent>(() => (localStorage.getItem('lenslook:accent') as Accent) ?? DEFAULT_ACCENT);
  const [thumbSize, setThumbSize] = useState(() => Number(localStorage.getItem('lenslook:thumb')) || DEFAULT_THUMB);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'reddit' | 'amazon' | 'bh'>('all');
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [gridColumns, setGridColumns] = useState(6);
  const gridRef = useRef<HTMLDivElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => { localStorage.setItem('lenslook:bg-tone', bgTone); }, [bgTone]);
  useEffect(() => { localStorage.setItem('lenslook:accent', accent); }, [accent]);
  useEffect(() => { localStorage.setItem('lenslook:thumb', String(thumbSize)); }, [thumbSize]);
  useEffect(() => { setGalleryExpanded(false); }, [sourceFilter]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const cols = getComputedStyle(el).gridTemplateColumns.split(' ').length;
      if (cols > 0) setGridColumns(cols);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bg = BG_TONES[bgTone];
  const accentColor = ACCENTS[accent];

  // Set body bg so no flash around the page
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = bg;
    return () => { document.body.style.backgroundColor = prev; };
  }, [bg]);

  const lens = lensById[lensId];
  const stat = results.stats.find(s => s.lensId === lensId);
  const claude = claudeSentiment[lensId];
  const youtube = youtubeSentiment[lensId];
  const youtubeVideos = useMemo(() => youtube?.videos.filter(v => v.mentionCount > 0) ?? [], [youtube]);

  const redditTiles = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    const matched = results.posts
      .filter(p => p.postLensIds.includes(lensId))
      .map(p => ({ post: p, w: calcWeight(p) }))
      .sort((a, b) => b.w - a.w);
    for (const { post } of matched) {
      const href = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
      if (post.images?.length) {
        for (const img of post.images) { tiles.push({ src: img.url, source: 'reddit', href, score: post.score, imgWidth: img.width, imgHeight: img.height, title: post.title, subreddit: post.subreddit, date: post.created_utc }); if (tiles.length >= 30) break; }
      } else if (!post.is_self && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(post.url)) {
        tiles.push({ src: post.url, source: 'reddit', href, score: post.score, title: post.title, subreddit: post.subreddit, date: post.created_utc });
      }
      if (tiles.length >= 30) break;
    }
    return tiles;
  }, [results.posts, lensId]);

  const amazonTiles = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    for (const item of reviews[lensId] ?? []) {
      if (item.sourceType !== 'amazon' || !item.images?.length) continue;
      for (const src of item.images) tiles.push({ src: normalizeRetailerImage(src), source: 'amazon', href: item.url ?? '#', title: item.text.slice(0, 200), rating: item.rating, dateStr: item.date });
    }
    return tiles;
  }, [reviews, lensId]);

  const bhTiles = useMemo((): GalleryTile[] => {
    if (!lens?.bh?.images?.length) return [];
    return lens.bh.images.map(src => ({ src: normalizeRetailerImage(src), source: 'bh' as const, href: lens.bh!.url, title: lens.bh!.title }));
  }, [lens]);

  // Concatenate rather than interleave so same-post images stay grouped together
  const combinedTiles = useMemo((): GalleryTile[] => (
    [...redditTiles, ...amazonTiles, ...bhTiles]
  ), [redditTiles, amazonTiles, bhTiles]);

  const activeTiles = sourceFilter === 'reddit' ? redditTiles : sourceFilter === 'amazon' ? amazonTiles : sourceFilter === 'bh' ? bhTiles : combinedTiles;
  const collapsedCount = gridColumns * COLLAPSED_ROWS;
  const visibleTiles = galleryExpanded ? activeTiles : activeTiles.slice(0, collapsedCount);
  const extraCount = activeTiles.length - collapsedCount;

  const topPosts = useMemo(() => {
    return results.posts
      .filter(p => p.postLensIds.includes(lensId))
      .map(p => ({ post: p, weight: calcWeight(p) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
  }, [results.posts, lensId]);

  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; subreddit: string; permalink?: string; created_utc?: number }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        const attr = c.lensIds ? c.lensIds.includes(lensId) : post.commentLensIds.includes(lensId);
        if (!attr) continue;
        items.push({
          body: c.body, score: c.score, subreddit: post.subreddit,
          permalink: c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : undefined,
          created_utc: c.created_utc,
        });
      }
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [results.posts, lensId]);

  const moreLenses = useMemo(() => {
    if (!lens) return [];
    return lenses
      .filter(l => l.brand === lens.brand && l.id !== lens.id)
      .map(l => { const s = results.stats.find(x => x.lensId === l.id); return { lens: l, posts: (s?.postCount ?? 0) + (s?.commentCount ?? 0) }; })
      .sort((a, b) => b.posts - a.posts).slice(0, 12);
  }, [lens, lenses, results.stats]);

  const sourceCounts = useMemo(() => {
    const items = reviews[lensId] ?? [];
    let amazon = 0, bh = 0, adorama = 0, reddit = 0;
    for (const item of items) {
      if (item.sourceType === 'amazon') amazon++;
      else if (item.sourceType === 'bh') bh++;
      else if (item.sourceType === 'adorama') adorama++;
    }
    for (const post of results.posts) {
      if (post.postLensIds.includes(lensId)) reddit++;
      for (const c of post.matchedComments ?? []) {
        const attr = c.lensIds ? c.lensIds.includes(lensId) : post.commentLensIds.includes(lensId);
        if (attr) reddit++;
      }
    }
    return { reddit, amazon, bh, adorama };
  }, [reviews, lensId, results.posts]);

  const specRows = useMemo((): [string, string][] => {
    if (!lens?.bh?.properties) return [];
    return SPEC_LABELS
      .map(([key, label]) => [label, lens.bh!.properties![key]] as [string, string | undefined])
      .filter((r): r is [string, string] => r[1] != null && r[1] !== '');
  }, [lens]);

  const renderCitation = (c: SentimentCitation, i: number) => {
    const url = resolveCitationUrl(c, lensId, reviews[lensId] ?? [], results.posts);
    const srcColor = c.source === 'amazon' ? SOURCE_COLORS.amazon : c.source === 'bh' ? SOURCE_COLORS.bh : c.source === 'adorama' ? SOURCE_COLORS.adorama : SOURCE_COLORS.reddit;
    const srcLabel = SOURCE_LABEL[c.source] ?? c.source;
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const starRating = (['amazon', 'bh', 'adorama'] as const).includes(c.source as 'amazon' | 'bh' | 'adorama')
      ? (reviews[lensId] ?? []).find(r => r.sourceType === c.source && norm(r.text).includes(norm(c.quote)))?.rating ?? null
      : null;
    return (
      <div key={i} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }}>{c.aspect}</div>
        {url ? (
          <a href={url} target="_blank" rel="noopener" style={{ display: 'block', marginTop: 4, fontSize: 12, fontStyle: 'italic', color: TEXT_DIMMER, textDecoration: 'none', lineHeight: 1.5 }}>
            &ldquo;{c.quote}&rdquo;
          </a>
        ) : (
          <div style={{ marginTop: 4, fontSize: 12, fontStyle: 'italic', color: TEXT_DIMMER, lineHeight: 1.5 }}>&ldquo;{c.quote}&rdquo;</div>
        )}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          {url ? (
            <a href={url} target="_blank" rel="noopener" style={{ fontFamily: FONT_MONO, fontSize: 9, color: srcColor, textDecoration: 'none' }}>
              {srcLabel} ↗
            </a>
          ) : (
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: srcColor }}>{srcLabel}</span>
          )}
          {starRating != null && (
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: STAR_COLOR }}>{'★'.repeat(starRating)}{'☆'.repeat(5 - starRating)}</span>
          )}
        </div>
      </div>
    );
  };

  if (!lens) {
    return (
      <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh', padding: 24 }}>
        <a href="#" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em' }}>← LENSLOOK</a>
        <div style={{ marginTop: 32, color: TEXT_DIM }}>Lens not found: {lensId}</div>
      </div>
    );
  }

  const bColor = brandColor(lens.brand);
  const price = lowestPrice(lens);
  const mentions = (stat?.postCount ?? 0) + (stat?.commentCount ?? 0);
  const weightStr = lens.bh?.properties?.weight ?? null;
  const filterStr = lens.bh?.properties?.filterSize ?? null;
  const formatStr = lens.bh?.properties?.format ?? (lens.category.includes('aps-c') ? 'APS-C' : 'Full-Frame');

  // Retailer rows — historyKey maps each row to price-history.json's shape.
  // Multiple Amazon ASINs share one 'amazon' history; only the first ASIN gets it.
  const retailerRows = (() => {
    let amazonHistoryAssigned = false;
    return [
      ...(lens.amazon?.asins?.map(a => {
        const historyKey = !amazonHistoryAssigned ? (amazonHistoryAssigned = true, 'amazon') : undefined;
        return { key: a.asin, historyKey, name: 'Amazon', url: `https://www.amazon.com/dp/${a.asin}`, official: a.official, price: a.price ?? null, scraped: a.priceScrapedAt ?? null, rating: a.avgRating ?? null, ratingCount: a.ratingCount ?? null };
      }) ?? []),
      ...(lens.bh ? [{ key: 'bh', historyKey: 'bh' as const, name: 'B&H', url: lens.bh.url, official: lens.bh.official, price: lens.bh.price ?? null, scraped: lens.bh.priceScrapedAt ?? null, rating: lens.bh.starCount ?? null, ratingCount: lens.bh.ratingCount ?? null }] : []),
      ...(lens.adorama ? [{ key: 'adorama', historyKey: 'adorama' as const, name: 'Adorama', url: lens.adorama.url, official: lens.adorama.official, price: lens.adorama.price ?? null, scraped: lens.adorama.priceScrapedAt ?? null, rating: lens.adorama.starCount ?? null, ratingCount: lens.adorama.ratingCount ?? null }] : []),
      ...(lens.retailers ? Object.entries(lens.retailers).map(([slug, r]) => ({ key: slug, historyKey: slug as string | undefined, name: r.title ?? slug.charAt(0).toUpperCase() + slug.slice(1), url: r.url, official: false, price: r.price ?? null, scraped: r.priceScrapedAt ?? null, rating: null, ratingCount: null })) : []),
    ];
  })();

  return (
    <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh' }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: `1px solid ${BORDER}`, backgroundColor: bg }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <a href="#" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
            ← LENSLOOK
          </a>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <input
              type="text" placeholder="search lenses..." readOnly
              style={{ width: '100%', maxWidth: 320, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: '6px 20px', fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM, outline: 'none', cursor: 'default' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              <path key="star" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
              <><path key="u" d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle key="c" cx="12" cy="7" r="4" /></>,
            ].map((icon, i) => (
              <button key={i} style={{ padding: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">{icon}</svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Page content ── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>

        {/* ── Hero ── */}
        <div style={{ padding: '20px 0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BrandDot brand={lens.brand} size={10} />
              <BrandMark brand={lens.brand} size={10} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM }}>
                · {lens.mount} · {formatStr}
              </span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {lens.category.map(cat => (
                <span key={cat} style={{ background: CATEGORY_COLORS[cat] ?? '#9ca3af', color: '#000', fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 2 }}>
                  {cat}
                </span>
              ))}
            </div>
          </div>

          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 48, fontWeight: 700, letterSpacing: '-0.04em', margin: '0 0 8px 0', lineHeight: 1.05 }}>
            <span style={{ color: bColor }}>{lens.brand}</span>{' '}{lens.name}
          </h1>

          <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: TEXT_DIMMER, marginBottom: 24 }}>
            {[lens.maxAperture, weightStr, filterStr ? `${filterStr} filter` : null].filter(Boolean).join(' · ')}
          </div>

          <div style={{ display: 'inline-flex', border: `1px solid ${BORDER_MED}`, borderRadius: 2, overflow: 'hidden' }}>
            {[
              { label: 'Price', value: price != null ? `$${Math.round(price).toLocaleString()}` : '—', color: price != null ? accentColor : TEXT_MUTED },
              { label: 'Claude Score', value: claude ? `${claude.score > 0 ? '+' : ''}${claude.score.toFixed(2)}` : '—', color: claude ? (claude.score >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR) : TEXT_MUTED },
              { label: 'Mentions', value: mentions.toLocaleString(), color: TEXT_PRIMARY },
            ].map((s, i, arr) => (
              <div key={i} style={{ padding: '16px 24px', borderRight: i < arr.length - 1 ? `1px solid ${BORDER_MED}` : 'none', minWidth: 100 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT_MUTED, marginTop: 6 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Gallery ── */}
        {combinedTiles.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {([['all', 'All', combinedTiles.length], ['reddit', 'Reddit', redditTiles.length], ['amazon', 'Amazon', amazonTiles.length], ['bh', 'B&H', bhTiles.length]] as const).map(([key, label, count]) => {
                const active = sourceFilter === key;
                const disabled = count === 0 && key !== 'all';
                return (
                  <button key={key} onClick={() => !disabled && setSourceFilter(key)}
                    style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.08em', padding: '4px 12px', borderRadius: 999, cursor: disabled ? 'default' : 'pointer', border: 'none', background: active ? accentColor : 'rgba(255,255,255,0.06)', color: active ? '#000' : disabled ? TEXT_FAINT : TEXT_DIM, opacity: disabled ? 0.4 : 1, transition: 'background 0.15s ease' }}>
                    {label}{count > 0 && <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span>}
                  </button>
                );
              })}
            </div>
            <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: 3 }}>
              {visibleTiles.map((tile, i) => <GalleryItem key={`${sourceFilter}-${i}`} tile={tile} onOpen={() => setLightboxIndex(i)} />)}
            </div>
            {extraCount > 0 && (
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setGalleryExpanded(v => !v)} style={{ fontFamily: FONT_MONO, fontSize: 10, color: accentColor, background: 'none', border: `1px solid ${accentColor}55`, borderRadius: 999, padding: '4px 14px', cursor: 'pointer', letterSpacing: '0.06em' }}>
                  {galleryExpanded ? 'Show less' : `+ ${extraCount} more`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Specs ── */}
        {specRows.length > 0 && (
          <Fold title="Specifications" count={specRows.length}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
              {specRows.map(([key, val], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>{key}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_PRIMARY, textAlign: 'right' }}>{val}</span>
                </div>
              ))}
            </div>
          </Fold>
        )}

        {/* ── Sentiment (always open, custom header) ── */}
        {claude && claude.mentionCount > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT_DIM }}>Sentiment</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: claude.score >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR }}>
                {claude.score > 0 ? '+' : ''}{claude.score.toFixed(2)}
              </span>
            </div>
            <div style={{ paddingTop: 16, animation: 'fadeUp 0.5s ease' }}>
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: TEXT_DIMMER, lineHeight: 1.7, margin: '0 0 10px 0' }}>{claude.summary}</p>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, marginBottom: 20 }}>
                Based on{' '}
                {[
                  sourceCounts.reddit && `${sourceCounts.reddit} Reddit`,
                  sourceCounts.amazon && `${sourceCounts.amazon} Amazon`,
                  sourceCounts.bh && `${sourceCounts.bh} B&H`,
                  sourceCounts.adorama && `${sourceCounts.adorama} Adorama`,
                ].filter(Boolean).join(' · ') || 'no source material'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                <div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: POSITIVE_COLOR, marginBottom: 12 }}>Positives</div>
                  {claude.positives.length > 0 ? claude.positives.map(renderCitation) : <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>None identified</div>}
                </div>
                <div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: NEGATIVE_COLOR, marginBottom: 12 }}>Negatives</div>
                  {claude.negatives.length > 0 ? claude.negatives.map(renderCitation) : <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>None identified</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Retailers ── */}
        {retailerRows.length > 0 && (
          <Fold title="Retailers" count={retailerRows.length} defaultOpen>
            {retailerRows.map((r, i, arr) => {
              const lensHistory = priceHistory[lensId];
              const history = r.historyKey == null ? undefined
                : r.historyKey === 'amazon' ? lensHistory?.amazon
                : r.historyKey === 'bh' ? lensHistory?.bh
                : r.historyKey === 'adorama' ? lensHistory?.adorama
                : lensHistory?.retailers?.[r.historyKey];
              return (
                <RetailerRow key={r.key}
                  name={r.name} url={r.url} official={r.official}
                  price={r.price} scraped={r.scraped}
                  rating={r.rating} ratingCount={r.ratingCount}
                  history={history}
                  accentColor={accentColor}
                  isLast={i === arr.length - 1}
                />
              );
            })}
          </Fold>
        )}

        {/* ── YouTube Reviews ── */}
        {youtubeVideos.length > 0 && (
          <Fold title="YouTube Reviews" count={youtubeVideos.length}>
            {(youtubeVideos as VideoSentiment[]).map((v, vi, arr) => (
              <div key={v.videoId} style={{ marginBottom: vi < arr.length - 1 ? 24 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <div>
                    <a href={v.url} target="_blank" rel="noopener" style={{ fontSize: 14, fontWeight: 600, color: SOURCE_COLORS.youtube, textDecoration: 'none' }}>
                      {v.channelTitle ?? v.reviewer ?? v.videoId}
                    </a>
                    <div style={{ fontSize: 12, color: TEXT_DIMMER, marginTop: 2 }}>
                      {v.title}{v.viewCount != null && ` · ${v.viewCount.toLocaleString()} views`}
                    </div>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, color: v.score >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR, flexShrink: 0 }}>
                    {v.score > 0 ? '+' : ''}{v.score.toFixed(2)}
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, margin: '8px 0' }}>{v.summary}</p>
                {(v.positives.length > 0 || v.negatives.length > 0) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
                    {v.positives.length > 0 && (
                      <div>
                        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: POSITIVE_COLOR, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Positives</div>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                          {v.positives.map((q, i) => (
                            <li key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 4 }}>
                              {q.timestampSeconds != null
                                ? <a href={`${v.url}&t=${q.timestampSeconds}s`} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>"{q.quote}"</a>
                                : `"${q.quote}"`}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {v.negatives.length > 0 && (
                      <div>
                        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: NEGATIVE_COLOR, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Negatives</div>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                          {v.negatives.map((q, i) => (
                            <li key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 4 }}>
                              {q.timestampSeconds != null
                                ? <a href={`${v.url}&t=${q.timestampSeconds}s`} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>"{q.quote}"</a>
                                : `"${q.quote}"`}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Fold>
        )}

        {/* ── Top Reddit Posts ── */}
        {topPosts.length > 0 && (
          <Fold title="Top Reddit Posts" count={topPosts.length}>
            {topPosts.map(({ post, weight: _w }, i, arr) => (
              <div key={post.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none', fontFamily: FONT_MONO, fontSize: 11 }}>
                <a href={postCommentsUrl(post)} target="_blank" rel="noopener" style={{ flex: 1, color: SOURCE_COLORS.reddit, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.title}
                </a>
                <span style={{ color: `${SOURCE_COLORS.reddit}99`, minWidth: 90, textAlign: 'right', flexShrink: 0 }}>r/{post.subreddit}</span>
                <span style={{ color: TEXT_PRIMARY, minWidth: 50, textAlign: 'right', flexShrink: 0 }}>{post.score.toLocaleString()}</span>
              </div>
            ))}
          </Fold>
        )}

        {/* ── Top Comments ── */}
        {topComments.length > 0 && (
          <Fold title="Top Comments" count={topComments.length}>
            {topComments.map((c, i, arr) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                {c.permalink ? (
                  <a href={c.permalink} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 12, color: TEXT_DIMMER, lineHeight: 1.55, textDecoration: 'none' }}>
                    {c.body.length > 280 ? c.body.slice(0, 277) + '…' : c.body}
                  </a>
                ) : (
                  <div style={{ fontSize: 12, color: TEXT_DIMMER, lineHeight: 1.55 }}>
                    {c.body.length > 280 ? c.body.slice(0, 277) + '…' : c.body}
                  </div>
                )}
                <div style={{ marginTop: 6, display: 'flex', gap: 10, fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM }}>
                  <span>{c.score.toLocaleString()} ↑</span>
                  {c.created_utc && <span>{new Date(c.created_utc * 1000).toLocaleDateString()}</span>}
                  <span style={{ color: SOURCE_COLORS.reddit }}>r/{c.subreddit}</span>
                </div>
              </div>
            ))}
          </Fold>
        )}

        {/* ── More from Brand ── */}
        {moreLenses.length > 0 && (
          <Fold title={`More from ${lens.brand}`} count={moreLenses.length}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {moreLenses.map(({ lens: l, posts: p }) => (
                <MorePill key={l.id} href={lensHref(l.id)} name={l.name} posts={p} brandCol={bColor} accentCol={accentColor} />
              ))}
            </div>
          </Fold>
        )}
      </div>

      {/* ── Lightbox ── */}
      {lightboxIndex !== null && (
        <Lightbox
          tiles={activeTiles}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNav={setLightboxIndex}
        />
      )}

      {/* ── Tweaks Panel ── */}
      {tweaksOpen && (
        <div style={{ position: 'fixed', bottom: 64, right: 16, background: '#1a1a1a', border: `1px solid ${BORDER}`, borderRadius: 4, padding: 16, zIndex: 100, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT_MUTED, marginBottom: 14 }}>Tweaks</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Accent</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(Object.entries(ACCENTS) as [Accent, string][]).map(([key, hex]) => (
                <button key={key} onClick={() => setAccent(key)} title={key} style={{ width: 20, height: 20, borderRadius: '50%', background: hex, border: accent === key ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Background</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(Object.entries(BG_TONES) as [BgTone, string][]).map(([key, hex]) => (
                <button key={key} onClick={() => setBgTone(key)} title={key} style={{ width: 20, height: 20, borderRadius: 2, background: hex, border: bgTone === key ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Gallery size</div>
            <input type="range" min={80} max={260} step={10} value={thumbSize} onChange={e => setThumbSize(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
        </div>
      )}

      <button
        onClick={() => setTweaksOpen(v => !v)}
        style={{ position: 'fixed', bottom: 16, right: 16, width: 40, height: 40, borderRadius: '50%', background: tweaksOpen ? accentColor : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', zIndex: 101, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s ease' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tweaksOpen ? '#000' : 'rgba(255,255,255,0.7)'} strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

function Lightbox({ tiles, index, onClose, onNav }: {
  tiles: GalleryTile[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
}) {
  const tile = tiles[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onNav(index - 1);
      else if (e.key === 'ArrowRight' && index < tiles.length - 1) onNav(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, tiles.length, onClose, onNav]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const srcColor = tile.source === 'bh' ? SOURCE_COLORS.bh : SOURCE_COLORS[tile.source];
  const srcLabel = tile.source === 'reddit' ? 'Reddit' : tile.source === 'amazon' ? 'Amazon' : 'B&H';

  let metaSubline = '';
  if (tile.source === 'reddit') {
    const parts: string[] = [];
    if (tile.subreddit) parts.push(`r/${tile.subreddit}`);
    if (tile.score != null) parts.push(`${tile.score.toLocaleString()} ↑`);
    if (tile.date) parts.push(new Date(tile.date * 1000).toLocaleDateString());
    metaSubline = parts.join('  ·  ');
  } else if (tile.source === 'amazon') {
    const parts: string[] = [];
    if (tile.rating != null) parts.push(`${tile.rating.toFixed(1)} ★`);
    if (tile.dateStr) parts.push(tile.dateStr);
    metaSubline = parts.join('  ·  ');
  }

  const NavBtn = ({ dir, onClick }: { dir: 'prev' | 'next'; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        position: 'absolute', [dir === 'prev' ? 'left' : 'right']: -56,
        top: '50%', transform: 'translateY(-50%)',
        width: 44, height: 44, borderRadius: '50%',
        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: TEXT_DIM, fontSize: 20, fontFamily: FONT_MONO, transition: 'background 0.15s',
      }}
    >{dir === 'prev' ? '‹' : '›'}</button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.93)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '20px 72px',
        boxSizing: 'border-box',
      }}
    >
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          position: 'fixed', top: 16, right: 16,
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT_MONO, fontSize: 18, color: TEXT_DIM, zIndex: 301,
        }}
      >×</button>

      {/* Image */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {index > 0 && <NavBtn dir="prev" onClick={() => onNav(index - 1)} />}
        <img
          src={tile.src} alt="" referrerPolicy="no-referrer"
          style={{ maxWidth: '82vw', maxHeight: '74vh', objectFit: 'contain', display: 'block', borderRadius: 2 }}
        />
        {index < tiles.length - 1 && <NavBtn dir="next" onClick={() => onNav(index + 1)} />}
      </div>

      {/* Meta */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          marginTop: 14, width: '82vw',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.1em', color: srcColor, textTransform: 'uppercase' }}>{srcLabel}</span>
          {tile.title && (
            <div style={{ marginTop: 5, fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {tile.title}
            </div>
          )}
          {metaSubline && (
            <div style={{ marginTop: 4, fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIMMER }}>{metaSubline}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0, paddingTop: 2 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM }}>{index + 1} / {tiles.length}</span>
          <a href={tile.href} target="_blank" rel="noopener"
            style={{ fontFamily: FONT_MONO, fontSize: 10, color: srcColor, textDecoration: 'none', letterSpacing: '0.06em' }}>
            View original ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function MorePill({ href, name, posts, brandCol, accentCol }: { href: string; name: string; posts: number; brandCol: string; accentCol: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(255,255,255,0.06)', borderLeft: `2px solid ${hovered ? accentCol : brandCol}`, borderRadius: 2, textDecoration: 'none', fontSize: 12, color: TEXT_PRIMARY, transition: 'border-color 0.15s ease' }}
    >
      {name}
      <span style={{ opacity: 0.5, fontFamily: FONT_MONO, fontSize: 10 }}>{posts}</span>
    </a>
  );
}

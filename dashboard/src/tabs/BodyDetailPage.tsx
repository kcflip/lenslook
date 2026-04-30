import { useEffect, useMemo, useState } from 'react';
import type { DashboardData, Post, Body, BodySpecs, SentimentCitation, ReviewItem } from '../types';
import { BrandBadge } from '../components/BrandBadge';
import { StatPill } from '../components/StatPill';
import { GalleryLightbox, type GalleryTile } from '../components/GalleryLightbox';
import { calcWeight, postCommentsUrl, commentPermalink } from '../utils';
import { bodyHref, lensHref } from '../hooks/useHashRoute';

interface Props {
  data: DashboardData;
  bodyId: string;
}

const SOURCE_COLOR: Record<string, string> = {
  reddit_post: '#ff4500',
  reddit_comment: '#ff4500',
  amazon: '#ff9900',
  bh: '#0066cc',
  adorama: '#e11d2c',
};

const SOURCE_LABEL: Record<string, string> = {
  reddit_post: 'Reddit post',
  reddit_comment: 'Reddit comment',
  amazon: 'Amazon',
  bh: 'B&H',
  adorama: 'Adorama',
};

function normalizeRetailerImage(src: string): string {
  const stripped = src.replace(/\._[^.]+(\.\w+)$/, '$1');
  const bhMatch = stripped.match(/^\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/);
  return bhMatch ? bhMatch[1] : stripped;
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

function specsRows(specs: BodySpecs): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const s = specs;

  if (s.sensor) {
    rows.push(['Sensor', `${s.sensor.megapixels}MP ${s.sensor.size} ${s.sensor.type}`]);
  }
  if (s.iso) {
    const base = `ISO ${s.iso.nativeMin.toLocaleString()}–${s.iso.nativeMax.toLocaleString()}`;
    rows.push(['ISO', s.iso.extendedMax ? `${base} (ext. ${s.iso.extendedMax.toLocaleString()})` : base]);
  }
  if (s.af) {
    const parts: string[] = [];
    if (s.af.points != null) parts.push(`${s.af.points} points`);
    if (s.af.lowLightEv != null) parts.push(`${s.af.lowLightEv} EV`);
    if (s.af.subjects?.length) parts.push(s.af.subjects.join(', '));
    if (parts.length) rows.push(['Autofocus', parts.join(' · ')]);
  }
  if (s.ibis) {
    rows.push(['IBIS', s.ibis.present ? (s.ibis.stops ? `${s.ibis.stops} stops` : 'Yes') : 'No']);
  }
  if (s.burst) {
    const parts: string[] = [];
    if (s.burst.mechFps) parts.push(`${s.burst.mechFps}fps mech`);
    if (s.burst.elecFps) parts.push(`${s.burst.elecFps}fps elec`);
    if (s.burst.bufferRaw) parts.push(`${s.burst.bufferRaw} RAW`);
    if (parts.length) rows.push(['Burst', parts.join(' · ')]);
  }
  if (s.video) {
    const parts: string[] = [];
    if (s.video.maxResolution) parts.push(s.video.maxResolution);
    if (s.video.maxFrameRateAtMax) parts.push(`${s.video.maxFrameRateAtMax}fps`);
    if (s.video.bitDepth) parts.push(`${s.video.bitDepth}-bit`);
    if (s.video.sLog) parts.push('S-Log');
    if (parts.length) rows.push(['Video', parts.join(' · ')]);
    if (s.video.overheatingNotes) rows.push(['Overheating', s.video.overheatingNotes]);
  }
  if (s.evf) {
    const parts: string[] = [];
    if (s.evf.dots) parts.push(`${(s.evf.dots / 1e6).toFixed(2)}M dots`);
    if (s.evf.magnification) parts.push(`${s.evf.magnification}×`);
    if (s.evf.refreshHz) parts.push(`${s.evf.refreshHz}Hz`);
    if (parts.length) rows.push(['EVF', parts.join(' · ')]);
  }
  if (s.lcd) {
    const parts: string[] = [];
    if (s.lcd.sizeIn) parts.push(`${s.lcd.sizeIn}"`);
    if (s.lcd.dots) parts.push(`${(s.lcd.dots / 1e6).toFixed(2)}M dots`);
    if (s.lcd.articulation) parts.push(s.lcd.articulation);
    if (parts.length) rows.push(['LCD', parts.join(' · ')]);
  }
  if (s.storage) {
    const parts: string[] = [];
    if (s.storage.slots) parts.push(`${s.storage.slots} slot${s.storage.slots > 1 ? 's' : ''}`);
    if (s.storage.types?.length) parts.push(s.storage.types.join('/'));
    if (s.storage.dualRedundant) parts.push('dual redundant');
    if (parts.length) rows.push(['Storage', parts.join(' · ')]);
  }
  if (s.battery) {
    const parts: string[] = [];
    if (s.battery.model) parts.push(s.battery.model);
    if (s.battery.cipaShots) parts.push(`${s.battery.cipaShots} shots (CIPA)`);
    if (parts.length) rows.push(['Battery', parts.join(' · ')]);
  }
  if (s.connectivity) {
    const parts: string[] = [];
    if (s.connectivity.usb) parts.push(s.connectivity.usb);
    if (s.connectivity.hdmi) parts.push(`HDMI ${s.connectivity.hdmi}`);
    if (s.connectivity.wifi) parts.push('Wi-Fi');
    if (s.connectivity.bluetooth) parts.push('Bluetooth');
    if (parts.length) rows.push(['Connectivity', parts.join(' · ')]);
  }
  if (s.body) {
    const parts: string[] = [];
    if (s.body.weightG) parts.push(`${s.body.weightG}g`);
    if (s.body.weatherSealed != null) parts.push(s.body.weatherSealed ? 'Weather sealed' : 'Not sealed');
    if (parts.length) rows.push(['Build', parts.join(' · ')]);
  }
  if (s.shutter) {
    const parts: string[] = [];
    if (s.shutter.mechMaxS) parts.push(`mech ${s.shutter.mechMaxS}`);
    if (s.shutter.elecMaxS) parts.push(`elec ${s.shutter.elecMaxS}`);
    if (s.shutter.flashSyncS) parts.push(`sync ${s.shutter.flashSyncS}`);
    if (parts.length) rows.push(['Shutter', parts.join(' · ')]);
  }

  return rows;
}

function BodySpecsPanel({ specs }: { specs: BodySpecs }) {
  const rows = specsRows(specs);
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
              <td style={{ color: '#aaa', fontSize: '0.72rem', paddingTop: '1px', paddingBottom: '1px', lineHeight: 1.35, maxWidth: 200 }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveCitationUrl(
  citation: SentimentCitation,
  bodyId: string,
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
      if (!post.postLensIds?.includes(bodyId)) continue;
      const text = post.title + (post.selftext && post.selftext !== '[removed]' ? ': ' + post.selftext.slice(0, 300) : '');
      if (norm(text).includes(needle)) return post.id && post.subreddit ? postCommentsUrl(post) : post.url;
    }
    return null;
  }

  if (citation.source === 'reddit_comment') {
    for (const post of posts) {
      if (!post.commentLensIds?.includes(bodyId)) continue;
      for (const c of post.matchedComments ?? []) {
        if (c.lensIds && !c.lensIds.includes(bodyId)) continue;
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

export function BodyDetailPage({ data, bodyId }: Props) {
  const { results, bodyById, lensById, claudeSentiment, reviews } = data;
  const body = bodyById[bodyId];
  const claude = claudeSentiment[bodyId];

  const topPosts = useMemo(() => {
    const matched: Array<{ post: Post; weight: number }> = [];
    for (const post of results.posts) {
      if (post.postLensIds.includes(bodyId)) {
        matched.push({ post, weight: calcWeight(post) });
      }
    }
    matched.sort((a, b) => b.weight - a.weight);
    return matched.slice(0, 10);
  }, [results.posts, bodyId]);

  const amazonGallery = useMemo((): GalleryTile[] => {
    const tiles: GalleryTile[] = [];
    const items = reviews[bodyId] ?? [];
    for (const item of items) {
      if (item.sourceType !== 'amazon' || !item.images?.length) continue;
      const caption = item.text.length > 160 ? item.text.slice(0, 157) + '…' : item.text;
      const meta: Array<{ label: string; value: string }> = [];
      if (item.rating != null) meta.push({ label: 'rating', value: `${item.rating}★` });
      if (item.verifiedPurchase) meta.push({ label: 'purchase', value: 'verified' });
      if (item.date) meta.push({ label: 'date', value: item.date });
      for (const src of item.images) {
        tiles.push({ src: normalizeRetailerImage(src), source: 'amazon', linkUrl: item.url ?? '#', linkLabel: 'View review on Amazon', title: caption, meta });
      }
    }
    return tiles;
  }, [reviews, bodyId]);

  const bhGallery = useMemo((): GalleryTile[] => {
    const bh = body?.bh;
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
      title: bh.title ?? (body ? `${body.brand} ${body.name}` : bodyId),
      meta,
    }));
  }, [body, bodyId]);

  const combinedGallery = useMemo((): GalleryTile[] => {
    const result: GalleryTile[] = [];
    const max = Math.max(amazonGallery.length, bhGallery.length);
    for (let i = 0; i < max; i++) {
      if (i < amazonGallery.length) result.push(amazonGallery[i]);
      if (i < bhGallery.length) result.push(bhGallery[i]);
    }
    return result;
  }, [amazonGallery, bhGallery]);

  const [sourceFilter, setSourceFilter] = useState<'all' | 'amazon' | 'bh'>('all');
  const toggleSource = (s: 'amazon' | 'bh') => setSourceFilter(prev => prev === s ? 'all' : s);

  const activeGallery = sourceFilter === 'all' ? combinedGallery : sourceFilter === 'amazon' ? amazonGallery : bhGallery;

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

  const collapsedCount = galleryCols * 2;
  const canExpandGallery = activeGallery.length > collapsedCount;
  const visibleCount = galleryExpanded ? activeGallery.length : collapsedCount;

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const retailerReviews = useMemo(() => {
    return (reviews[bodyId] ?? [])
      .filter(r => r.sourceType === 'amazon' || r.sourceType === 'bh' || r.sourceType === 'adorama')
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }, [reviews, bodyId]);

  const sourceCounts = useMemo(() => {
    const items = reviews[bodyId] ?? [];
    let amazon = 0, bh = 0;
    for (const item of items) {
      if (item.sourceType === 'amazon') amazon++;
      else if (item.sourceType === 'bh') bh++;
    }
    let reddit = 0;
    for (const post of results.posts) {
      if (post.postLensIds.includes(bodyId)) reddit++;
      for (const c of post.matchedComments ?? []) {
        const attributed = c.lensIds ? c.lensIds.includes(bodyId) : post.commentLensIds.includes(bodyId);
        if (attributed) reddit++;
      }
    }
    return { amazon, bh, reddit };
  }, [reviews, bodyId, results.posts]);

  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const renderCitation = (c: SentimentCitation, i: number) => {
    const url = resolveCitationUrl(c, bodyId, reviews[bodyId] ?? [], results.posts);
    const quoteStyle = { color: '#999', fontStyle: 'italic' as const, fontSize: '0.8rem', lineHeight: 1.45, marginTop: '0.25rem' };
    const sourceLabel = SOURCE_LABEL[c.source] ?? c.source;
    const sourceColor = SOURCE_COLOR[c.source] ?? '#666';
    const sourceStyle = { marginTop: '0.25rem', fontSize: '0.7rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: sourceColor };
    return (
      <li key={i} style={{ marginBottom: '0.8rem' }}>
        <div style={{ color: '#e0e0e0', fontSize: '0.9rem' }}>{c.aspect}</div>
        {url ? (
          <a href={url} target="_blank" rel="noopener" title="View source" style={{ ...quoteStyle, display: 'block', textDecoration: 'none' }}>&ldquo;{c.quote}&rdquo;</a>
        ) : (
          <div style={quoteStyle}>&ldquo;{c.quote}&rdquo;</div>
        )}
        {url ? (
          <a href={url} target="_blank" rel="noopener" style={{ ...sourceStyle, display: 'inline-block', textDecoration: 'none' }}>{sourceLabel} ↗</a>
        ) : (
          <div style={sourceStyle}>{sourceLabel}</div>
        )}
      </li>
    );
  };

  // Lenses most frequently co-mentioned with this body
  const pairedLenses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of results.posts) {
      if (!post.postLensIds.includes(bodyId) && !post.commentLensIds.includes(bodyId)) continue;
      for (const id of [...post.postLensIds, ...post.commentLensIds]) {
        if (!id.startsWith('body-')) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .flatMap(([id, count]) => lensById[id] ? [{ lens: lensById[id], count }] : []);
  }, [results.posts, bodyId, lensById]);

  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; postTitle: string; postUrl: string; subreddit: string; commentPermalink?: string }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        const attributed = c.lensIds ? c.lensIds.includes(bodyId) : post.commentLensIds.includes(bodyId);
        if (!attributed) continue;
        const permalink = c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : undefined;
        const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
        items.push({ body: c.body, score: c.score, postTitle: post.title, postUrl, subreddit: post.subreddit, commentPermalink: permalink });
      }
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, 10);
  }, [results.posts, bodyId]);

  if (!body) {
    return (
      <>
        <a href="#/bodies" className="back-link">← Back to bodies</a>
        <div className="card full" style={{ marginTop: '1rem' }}>
          <h2>Body not found</h2>
          <p className="meta">No body with id <code>{bodyId}</code>.</p>
        </div>
      </>
    );
  }

  const heroImage = body.bh?.productImage ?? body.amazon?.asins?.[0]?.productImage;

  return (
    <>
      <a href="#/bodies" className="back-link">← Back to bodies</a>

      {/* Hero */}
      <div className="card full lens-hero">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div style={{ flex: '1 1 260px', minWidth: '200px' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <BrandBadge brand={body.brand} />
              <span style={{ marginLeft: '0.6rem', color: '#666', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {body.mount}
              </span>
            </div>
            <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem 0' }}>
              {body.brand} {body.name}
            </h1>
            <div style={{ color: '#888', fontSize: '0.95rem', marginBottom: '0.75rem' }}>
              {body.sensorSize} · {body.model}
              {body.releaseDate && ` · ${new Date(body.releaseDate).getFullYear()}`}
            </div>
            {body.releasePrice != null && (
              <div style={{ color: '#666', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                Launch price: ${body.releasePrice.toLocaleString()}
              </div>
            )}
          </div>
          {body.specs && Object.keys(body.specs).length > 0 && <BodySpecsPanel specs={body.specs} />}
          {heroImage && (
            <img
              src={heroImage}
              alt={`${body.brand} ${body.name}`}
              referrerPolicy="no-referrer"
              style={{ width: 160, height: 160, objectFit: 'contain', background: '#111', borderRadius: 4, flexShrink: 0 }}
            />
          )}
        </div>

        <div className="hero-stats">
          <StatPill label="Post Mentions" value={topPosts.length} info="Posts whose title or body matched this camera body." />
          <StatPill label="Comment Mentions" value={topComments.length} info="Top comments that mentioned this camera body." />
          <StatPill
            label="Claude Score"
            value={claude ? `${claude.score > 0 ? '+' : ''}${claude.score.toFixed(2)}` : '—'}
            info="Claude's sentiment score on a −1 to +1 scale."
          />
        </div>
      </div>

      {/* Predecessor / successor */}
      {(body.predecessor || body.successor) && (
        <div className="card full">
          <h2 style={{ marginBottom: '0.75rem' }}>In the line</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {body.predecessor && data.bodyById[body.predecessor] && (
              <a href={bodyHref(body.predecessor)} className="related-chip">
                <span style={{ color: '#666', marginRight: '0.4rem', fontSize: '0.75rem' }}>← Predecessor</span>
                <strong>{data.bodyById[body.predecessor].name}</strong>
              </a>
            )}
            {body.successor && data.bodyById[body.successor] && (
              <a href={bodyHref(body.successor)} className="related-chip">
                <strong>{data.bodyById[body.successor].name}</strong>
                <span style={{ color: '#666', marginLeft: '0.4rem', fontSize: '0.75rem' }}>Successor →</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Retailers */}
      {(body.amazon?.asins?.length || body.bh || body.adorama || body.retailers) && (
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
              {body.amazon?.asins?.map(a => (
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
                  <td className="num" style={{ color: a.avgRating != null ? '#facc15' : '#555', fontWeight: 600 }}
                    title={a.ratingCount != null ? `${a.ratingCount.toLocaleString()} reviews` : undefined}>
                    {a.avgRating != null ? `${a.avgRating.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              ))}
              {body.bh && (
                <tr>
                  <td>
                    <a href={body.bh.url} target="_blank" rel="noopener">
                      B&amp;H{body.bh.official && <span className="official-tag"> ✓ official</span>}
                    </a>
                  </td>
                  <td className="num" style={{ color: body.bh.price ? '#4ade80' : '#555', fontWeight: 600 }}>
                    {body.bh.price != null ? `$${body.bh.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: '#555', fontSize: '0.75rem' }}>
                    {body.bh.priceScrapedAt ? new Date(body.bh.priceScrapedAt).toLocaleDateString() : ''}
                  </td>
                  <td className="num" style={{ color: body.bh.starCount != null ? '#facc15' : '#555', fontWeight: 600 }}
                    title={body.bh.ratingCount != null ? `${body.bh.ratingCount.toLocaleString()} reviews` : undefined}>
                    {body.bh.starCount != null ? `${body.bh.starCount.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              )}
              {body.adorama && (
                <tr>
                  <td>
                    <a href={body.adorama.url} target="_blank" rel="noopener">
                      Adorama{body.adorama.official && <span className="official-tag"> ✓ official</span>}
                    </a>
                  </td>
                  <td className="num" style={{ color: body.adorama.price ? '#4ade80' : '#555', fontWeight: 600 }}>
                    {body.adorama.price != null ? `$${body.adorama.price.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ color: '#555', fontSize: '0.75rem' }}>
                    {body.adorama.priceScrapedAt ? new Date(body.adorama.priceScrapedAt).toLocaleDateString() : ''}
                  </td>
                  <td className="num" style={{ color: body.adorama.starCount != null ? '#facc15' : '#555', fontWeight: 600 }}>
                    {body.adorama.starCount != null ? `${body.adorama.starCount.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              )}
              {body.retailers && Object.entries(body.retailers).map(([slug, r]) => (
                <tr key={slug}>
                  <td><a href={r.url} target="_blank" rel="noopener">{r.title ?? slug}</a></td>
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
      {(amazonGallery.length > 0 || bhGallery.length > 0) && (
        <div className="card full">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>Gallery</h2>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" onClick={() => toggleSource('amazon')} disabled={amazonGallery.length === 0}
                className={`tab-pill${sourceFilter === 'amazon' ? ' active' : ''}`}>
                Amazon <span style={{ color: '#666', marginLeft: '0.3rem' }}>{amazonGallery.length}</span>
              </button>
              <button type="button" onClick={() => toggleSource('bh')} disabled={bhGallery.length === 0}
                className={`tab-pill${sourceFilter === 'bh' ? ' active' : ''}`}>
                B&amp;H <span style={{ color: '#666', marginLeft: '0.3rem' }}>{bhGallery.length}</span>
              </button>
            </div>
          </div>
          <div ref={setGalleryGridEl} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
            {activeGallery.slice(0, visibleCount).map((tile, i) => (
              <button type="button" key={`${sourceFilter}-${i}`} onClick={() => setLightboxIndex(i)} title={tile.title}
                style={{ display: 'block', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: '4px', background: '#111', border: 'none', padding: 0, cursor: 'pointer' }}>
                <img src={tile.src} alt={tile.title} loading="lazy" referrerPolicy="no-referrer"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
          </div>
          {canExpandGallery && (
            <button type="button" onClick={() => setGalleryExpanded(v => !v)}
              style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>
              {galleryExpanded ? '▾ Show less' : `▸ Show ${activeGallery.length - collapsedCount} more`}
            </button>
          )}
        </div>
      )}

      {/* Claude sentiment */}
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
          <p style={{ color: '#d0d0d0', lineHeight: 1.55, fontSize: '0.95rem', margin: '0 0 0.6rem 0' }}>{claude.summary}</p>
          <div style={{ color: '#777', fontSize: '0.78rem', marginBottom: '1.5rem' }}>
            Based on{' '}
            {[
              sourceCounts.reddit && `${sourceCounts.reddit} Reddit`,
              sourceCounts.amazon && `${sourceCounts.amazon} Amazon`,
              sourceCounts.bh && `${sourceCounts.bh} B&H`,
            ].filter(Boolean).join(' · ') || 'no source material'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
            <div>
              <h3 className="sentiment-heading" style={{ color: '#4ade80' }}>Positives</h3>
              {claude.positives.length > 0
                ? <ul className="sentiment-list citation-list">{claude.positives.map(renderCitation)}</ul>
                : <p className="meta" style={{ margin: 0 }}>None identified</p>}
            </div>
            <div>
              <h3 className="sentiment-heading" style={{ color: '#f87171' }}>Negatives</h3>
              {claude.negatives.length > 0
                ? <ul className="sentiment-list citation-list">{claude.negatives.map(renderCitation)}</ul>
                : <p className="meta" style={{ margin: 0 }}>None identified</p>}
            </div>
          </div>
          {retailerReviews.length > 0 && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #222' }}>
              <button type="button" onClick={() => setSourcesExpanded(v => !v)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>
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
                        {r.url && <a href={r.url} target="_blank" rel="noopener" style={{ color: '#666', marginLeft: 'auto' }}>source ↗</a>}
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

      {/* Top posts */}
      <div className="card full">
        <h2>Top Matched Posts</h2>
        {topPosts.length === 0 ? (
          <p className="meta">No matched posts for this body.</p>
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
          <p className="meta">No matched comments for this body.</p>
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
                        <a href={c.commentPermalink} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
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

      {/* Lenses paired with this body */}
      {pairedLenses.length > 0 && (
        <div className="card full">
          <h2>Lenses discussed alongside this body</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {pairedLenses.map(({ lens, count }) => (
              <a key={lens.id} href={lensHref(lens.id)} className="related-chip">
                <strong>{lens.brand} {lens.name}</strong>
                <span style={{ color: '#666', marginLeft: '0.4rem', fontSize: '0.75rem' }}>
                  {count} {count === 1 ? 'post' : 'posts'}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {lightboxIndex != null && activeGallery.length > 0 && (
        <GalleryLightbox tiles={activeGallery} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndex={setLightboxIndex} />
      )}
    </>
  );
}

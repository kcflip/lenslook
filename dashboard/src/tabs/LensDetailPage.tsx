import { useMemo } from 'react';
import type { DashboardData, Post, VideoSentiment } from '../types';
import { BrandBadge } from '../components/BrandBadge';
import { StatPill } from '../components/StatPill';
import { WordCloudCanvas } from '../components/WordCloudCanvas';
import { brandOf, calcWeight, buildCloudData, postCommentsUrl, commentPermalink } from '../utils';
import { brandHref } from '../hooks/useHashRoute';

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

export function LensDetailPage({ data, lensId }: Props) {
  const { results, lensById, sentiment, claudeSentiment, youtubeSentiment, lenses } = data;
  const lens = lensById[lensId];
  const stat = results.stats.find(s => s.lensId === lensId);
  const claude = claudeSentiment[lensId];
  const lexicon = sentiment[lensId];
  const youtube = youtubeSentiment[lensId];

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
  const gallery = useMemo(() => {
    type Tile = { src: string; postUrl: string; postTitle: string };
    const tiles: Tile[] = [];
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
      if (post.images && post.images.length > 0) {
        for (const img of post.images) {
          tiles.push({ src: img.url, postUrl, postTitle: post.title });
          if (tiles.length >= LIMIT) break;
        }
      } else if (!post.is_self && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(post.url)) {
        tiles.push({ src: post.url, postUrl, postTitle: post.title });
      }
      if (tiles.length >= LIMIT) break;
    }
    return tiles;
  }, [results.posts, lensId]);

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

      {/* Hero */}
      <div className="card full lens-hero">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '280px' }}>
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
            <div style={{ color: '#888', fontSize: '0.95rem', marginBottom: '1rem' }}>
              {lens.focalLength} · {lens.maxAperture}
            </div>
            {lens.aliases.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
                {lens.aliases.map(a => (
                  <span key={a} className="alias-pill">{a}</span>
                ))}
              </div>
            )}
            {lens.shoppingLink && (
              <a href={lens.shoppingLink} target="_blank" rel="noopener" className="shop-button">
                <CartIcon />
                Search on Amazon
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Stat pills */}
      <div className="stats-row">
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

      {/* ASIN / price table */}
      {lens.asins && lens.asins.length > 0 && (
        <div className="card full">
          <h2>Retailers</h2>
          <table>
            <thead>
              <tr>
                <th>Retailer</th>
                <th className="num-header">Price</th>
                <th className="num-header"></th>
              </tr>
            </thead>
            <tbody>
              {lens.asins.map(a => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Gallery */}
      {gallery.length > 0 && (
        <div className="card full">
          <h2>Gallery</h2>
          <p className="meta" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
            Images from top-weighted Reddit posts that mention this lens.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
            {gallery.map((tile, i) => (
              <a
                key={i}
                href={tile.postUrl}
                target="_blank"
                rel="noopener"
                title={tile.postTitle}
                style={{ display: 'block', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: '4px', background: '#111' }}
              >
                <img
                  src={tile.src}
                  alt={tile.postTitle}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </a>
            ))}
          </div>
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
          <p style={{ color: '#d0d0d0', lineHeight: 1.55, fontSize: '0.95rem', margin: '0 0 1.5rem 0' }}>
            {claude.summary}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div>
              <h3 className="sentiment-heading" style={{ color: '#4ade80' }}>Positives</h3>
              {claude.positives.length > 0 ? (
                <ul className="sentiment-list">
                  {claude.positives.map(p => <li key={p}>{p}</li>)}
                </ul>
              ) : (
                <p className="meta" style={{ margin: 0 }}>None identified</p>
              )}
            </div>
            <div>
              <h3 className="sentiment-heading" style={{ color: '#f87171' }}>Negatives</h3>
              {claude.negatives.length > 0 ? (
                <ul className="sentiment-list">
                  {claude.negatives.map(n => <li key={n}>{n}</li>)}
                </ul>
              ) : (
                <p className="meta" style={{ margin: 0 }}>None identified</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* YouTube sentiment */}
      {youtube && youtube.videos.length > 0 && (
        <div className="card full">
          <h2>YouTube Reviews</h2>
          {youtube.videos.map((v: VideoSentiment) => (
            <div key={v.videoId} style={{ marginBottom: '2rem', paddingBottom: '2rem', borderBottom: '1px solid #222' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <a href={v.url} target="_blank" rel="noopener" style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {v.title ?? v.reviewer ?? v.videoId}
                  </a>
                  <div style={{ color: '#888', fontSize: '0.78rem', marginTop: '0.2rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {(v.channelTitle ?? v.reviewer) && <span>{v.channelTitle ?? v.reviewer}</span>}
                    {typeof v.viewCount === 'number' && (
                      <span>·</span>
                    )}
                    {typeof v.viewCount === 'number' && (
                      <span>{v.viewCount.toLocaleString()} views</span>
                    )}
                  </div>
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
    </>
  );
}

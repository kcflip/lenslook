import { useMemo } from 'react';
import type { DashboardData, Post } from '../types';
import { BrandBadge } from '../components/BrandBadge';
import { StatPill } from '../components/StatPill';
import { LensNameLink } from '../components/LensNameLink';
import { calcWeight, postCommentsUrl, commentPermalink, brandKey } from '../utils';
import { lensHref } from '../hooks/useHashRoute';

interface Props {
  data: DashboardData;
  brand: string;
}

export function BrandDetailPage({ data, brand }: Props) {
  const { results, lensById, lenses, claudeSentiment } = data;

  const targetKey = brandKey(brand);
  const displayBrand = lenses.find(l => brandKey(l.brand) === targetKey)?.brand ?? brand;

  const brandLenses = useMemo(
    () => lenses.filter(l => brandKey(l.brand) === targetKey),
    [lenses, targetKey]
  );
  const brandLensIds = useMemo(() => new Set(brandLenses.map(l => l.id)), [brandLenses]);

  const brandStats = useMemo(
    () => results.stats.filter(s => brandLensIds.has(s.lensId)),
    [results.stats, brandLensIds]
  );

  const pills = useMemo(() => {
    const totalPosts = brandStats.reduce((a, s) => a + s.postCount, 0);
    const totalComments = brandStats.reduce((a, s) => a + s.commentCount, 0);
    const mentioned = brandStats.filter(s => s.postCount + s.commentCount > 0).length;
    const avgScoreSentiment = brandStats.length
      ? (brandStats.reduce((a, s) => a + s.scoreSentiment, 0) / brandStats.length).toFixed(2)
      : '—';
    const top = [...brandStats].sort((a, b) => b.scoreSentiment - a.scoreSentiment)[0];
    return { totalPosts, totalComments, mentioned, avgScoreSentiment, top };
  }, [brandStats]);

  const lensRows = useMemo(() => {
    return brandLenses.map(l => {
      const s = results.stats.find(x => x.lensId === l.id);
      const c = claudeSentiment[l.id];
      return {
        lens: l,
        postCount: s?.postCount ?? 0,
        commentCount: s?.commentCount ?? 0,
        scoreSentiment: s?.scoreSentiment ?? 0,
        claudeScore: c ? c.score : null,
        claudeMentions: c ? c.mentionCount : 0,
      };
    }).sort((a, b) => b.scoreSentiment - a.scoreSentiment);
  }, [brandLenses, results.stats, claudeSentiment]);

  const topPosts = useMemo(() => {
    const matched: Array<{ post: Post; weight: number; matchedLensIds: string[] }> = [];
    for (const post of results.posts) {
      const hits = post.lensIds.filter(id => brandLensIds.has(id));
      if (hits.length === 0) continue;
      matched.push({ post, weight: calcWeight(post), matchedLensIds: hits });
    }
    matched.sort((a, b) => b.weight - a.weight);
    return matched.slice(0, 10);
  }, [results.posts, brandLensIds]);

  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; postTitle: string; postUrl: string; subreddit: string; commentPermalink?: string; matchedLensIds: string[] }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        const commentLensIds = c.lensIds ?? post.commentLensIds;
        const hits = commentLensIds.filter(id => brandLensIds.has(id));
        if (hits.length === 0) continue;
        const permalink = c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : undefined;
        const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
        items.push({
          body: c.body,
          score: c.score,
          postTitle: post.title,
          postUrl,
          subreddit: post.subreddit,
          commentPermalink: permalink,
          matchedLensIds: hits,
        });
      }
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, 10);
  }, [results.posts, brandLensIds]);

  if (brandLenses.length === 0) {
    return (
      <>
        <a href="#" className="back-link">← Back</a>
        <div className="card full" style={{ marginTop: '1rem' }}>
          <h2>Brand not found</h2>
          <p className="meta">No lenses found for brand <code>{brand}</code>.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <a href="#" className="back-link">← Back to overview</a>

      <div className="card full lens-hero">
        <div style={{ marginBottom: '0.5rem' }}>
          <BrandBadge brand={displayBrand} />
        </div>
        <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem 0' }}>{displayBrand}</h1>
        <div style={{ color: '#888', fontSize: '0.95rem' }}>
          {brandLenses.length} {brandLenses.length === 1 ? 'lens' : 'lenses'} tracked ·{' '}
          {pills.mentioned} mentioned across Reddit
        </div>
      </div>

      <div className="stats-row">
        <StatPill
          label="Lenses Tracked"
          value={brandLenses.length}
          info={`Number of ${displayBrand} lenses in lenses.json.`}
        />
        <StatPill
          label="Post Mentions"
          value={pills.totalPosts}
          info={`Total posts whose title or body matched a ${displayBrand} lens.`}
        />
        <StatPill
          label="Comment-Only Mentions"
          value={pills.totalComments}
          info={`Posts where a ${displayBrand} lens appeared only in the comment thread.`}
        />
        <StatPill
          label="Top Lens"
          value={pills.top ? (lensById[pills.top.lensId]?.name ?? pills.top.lensId) : '—'}
          info="Highest Score Sentiment within this brand."
        />
        <StatPill
          label="Avg Score Sentiment"
          value={pills.avgScoreSentiment}
          info="Mean Score Sentiment across all lenses in this brand (including un-mentioned ones, which score 0)."
        />
      </div>

      <div className="card full">
        <h2>Lenses</h2>
        <table>
          <thead>
            <tr>
              <th>Lens</th>
              <th className="num-header">Post Mentions</th>
              <th className="num-header">Comment Mentions</th>
              <th className="num-header">Score Sentiment</th>
              <th className="num-header">Claude Score</th>
              <th className="num-header">Claude Mentions</th>
            </tr>
          </thead>
          <tbody>
            {lensRows.map(r => (
              <tr key={r.lens.id}>
                <td className="highlight" style={{ whiteSpace: 'nowrap' }}>
                  <a href={lensHref(r.lens.id)}>{r.lens.name}</a>
                </td>
                <td className="num">{r.postCount}</td>
                <td className="num">{r.commentCount}</td>
                <td className="num">{r.scoreSentiment.toFixed(2)}</td>
                <td className="num">
                  {r.claudeScore != null ? (
                    <span style={{ fontWeight: 600 }}>
                      {r.claudeScore > 0 ? '+' : ''}{r.claudeScore.toFixed(2)}
                    </span>
                  ) : '—'}
                </td>
                <td className="num">{r.claudeMentions || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card full">
        <h2>Top Posts</h2>
        {topPosts.length === 0 ? (
          <p className="meta">No matched posts for this brand.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Lenses</th>
                <th>Subreddit</th>
                <th className="num-header">Score</th>
                <th className="num-header">Comments</th>
                <th className="num-header">Weight</th>
              </tr>
            </thead>
            <tbody>
              {topPosts.map(({ post, weight, matchedLensIds }) => (
                <tr key={post.id}>
                  <td>
                    <a href={post.id && post.subreddit ? postCommentsUrl(post) : post.url} target="_blank" rel="noopener">
                      {post.title.length > 90 ? post.title.slice(0, 87) + '…' : post.title}
                    </a>
                  </td>
                  <td style={{ fontSize: '0.78rem' }}>
                    {matchedLensIds.map((id, i) => (
                      <span key={id}>
                        {i > 0 && ', '}
                        <LensNameLink lensId={id} lensById={lensById} />
                      </span>
                    ))}
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

      <div className="card full">
        <h2>Top Comments</h2>
        {topComments.length === 0 ? (
          <p className="meta">No matched comments for this brand.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Comment</th>
                <th>Lenses</th>
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
                    <td style={{ fontSize: '0.78rem' }}>
                      {c.matchedLensIds.map((id, j) => (
                        <span key={id}>
                          {j > 0 && ', '}
                          <LensNameLink lensId={id} lensById={lensById} />
                        </span>
                      ))}
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
    </>
  );
}

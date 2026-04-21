import { useMemo } from 'react';
import { StatPill } from '../components/StatPill';
import { BarChart } from '../components/BarChart';
import { DoughnutChart } from '../components/DoughnutChart';
import { LensBarList } from '../components/LensBarList';
import type { DashboardData } from '../types';
import { brandOf, displayName, brandColor } from '../utils';
import { lensHref, brandHref } from '../hooks/useHashRoute';

interface Props {
  data: DashboardData;
}

export function OverviewTab({ data }: Props) {
  const { results, lensById } = data;
  const { stats, posts, fetchedAt, subreddits } = results;

  const meta = useMemo(() => {
    const d = new Date(fetchedAt);
    const commentCount = posts.reduce((sum, p) => sum + (p.matchedComments?.length ?? 0), 0);
    return {
      fetched: `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`,
      lensCount: stats.length,
      postCount: posts.length,
      commentCount,
      subreddits: subreddits.map(s => `r/${s}`).join(', '),
    };
  }, [fetchedAt, stats.length, posts, subreddits]);

  const pills = useMemo(() => {
    const bestLens = stats[0];
    const worstLens = stats[stats.length - 1];
    const brandCounts: Record<string, number> = {};
    for (const s of stats) {
      const b = brandOf(s.lensId, lensById);
      brandCounts[b] = (brandCounts[b] ?? 0) + s.postCount + (results.stats.find(x => x.lensId === s.lensId)?.commentCount ?? 0);
    }
    const topBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    return [
      { label: 'Distinct Lenses', value: stats.length, info: 'Number of unique lenses mentioned across all posts and comments' },
      { label: 'Most Popular', value: displayName(bestLens.lensId, lensById), info: 'Lens with the highest score sentiment', href: lensHref(bestLens.lensId) },
      { label: 'Least Popular', value: displayName(worstLens.lensId, lensById), info: 'Lens with the lowest score sentiment', href: lensHref(worstLens.lensId) },
      { label: 'Most Popular Brand', value: topBrand, info: 'Brand with the most combined post and comment mentions', href: brandHref(topBrand) },
    ];
  }, [stats, lensById, results.stats]);

  const weightRows = useMemo(() => (
    stats.slice(0, 20).map(s => ({
      lensId: s.lensId,
      label: displayName(s.lensId, lensById),
      value: s.scoreSentiment,
      color: brandColor(brandOf(s.lensId, lensById)),
    }))
  ), [stats, lensById]);

  const countRows = useMemo(() => (
    [...stats].sort((a, b) => b.postCount - a.postCount).slice(0, 20).map(s => ({
      lensId: s.lensId,
      label: displayName(s.lensId, lensById),
      value: s.postCount,
      color: brandColor(brandOf(s.lensId, lensById)),
    }))
  ), [stats, lensById]);

  const brandDoughnut = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stats) {
      const b = brandOf(s.lensId, lensById);
      counts[b] = (counts[b] ?? 0) + s.postCount;
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(([k]) => k), values: entries.map(([, v]) => v) };
  }, [stats, lensById]);

  const brandWeightChart = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    for (const s of stats) {
      const b = brandOf(s.lensId, lensById);
      if (!map[b]) map[b] = { total: 0, count: 0 };
      map[b].total += s.scoreSentiment;
      map[b].count += 1;
    }
    const entries = Object.entries(map)
      .map(([b, v]) => [b, parseFloat((v.total / v.count).toFixed(3))] as [string, number])
      .sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([k]) => k),
      values: entries.map(([, v]) => v),
      colors: entries.map(([k]) => brandColor(k)),
    };
  }, [stats, lensById]);

  const subDoughnut = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of posts) counts[p.subreddit] = (counts[p.subreddit] ?? 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(([k]) => `r/${k}`), values: entries.map(([, v]) => v) };
  }, [posts]);

  return (
    <>
      <p className="meta">
        <span>Fetched {meta.fetched}</span>
        <span>{meta.lensCount} lenses</span>
        <span>{meta.postCount} matched posts</span>
        <span>{meta.commentCount} matched comments</span>
        <span>{meta.subreddits}</span>
      </p>

      <div className="stats-row">
        {pills.map(p => <StatPill key={p.label} label={p.label} value={p.value} info={p.info} href={p.href} />)}
      </div>

      <div className="row">
        <div className="card wide">
          <h2>Top 20 Lenses by Weight</h2>
          <LensBarList rows={weightRows} valueFormat={v => v.toFixed(2)} />
        </div>
        <div className="card wide">
          <h2>Top 20 Lenses by Post Count</h2>
          <LensBarList rows={countRows} />
        </div>
      </div>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ flex: 1, minWidth: '260px', maxWidth: '360px', display: 'flex', flexDirection: 'column' }}>
          <h2>Brand Share</h2>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DoughnutChart labels={brandDoughnut.labels} values={brandDoughnut.values} />
          </div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: '320px', display: 'flex', flexDirection: 'column' }}>
          <h2>Avg Weight by Brand</h2>
          <div style={{ flex: 1, width: '100%', minHeight: 0 }}>
            <BarChart labels={brandWeightChart.labels} values={brandWeightChart.values} colors={brandWeightChart.colors} />
          </div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: '260px', maxWidth: '360px', display: 'flex', flexDirection: 'column' }}>
          <h2>Subreddit Share</h2>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DoughnutChart labels={subDoughnut.labels} values={subDoughnut.values} />
          </div>
        </div>
      </div>
    </>
  );
}

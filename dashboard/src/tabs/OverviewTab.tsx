import { useMemo, useState } from 'react';
import { StatPill } from '../components/StatPill';
import { BarChart } from '../components/BarChart';
import { DoughnutChart } from '../components/DoughnutChart';
import { LensBarList } from '../components/LensBarList';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { SortableTable, sortRows } from '../components/SortableTable';
import { BrandBadge } from '../components/BrandBadge';
import { LensNameLink } from '../components/LensNameLink';
import type { DashboardData, Lens } from '../types';
import { brandOf, displayName, brandColor, calcWeight, postCommentsUrl } from '../utils';
import { lensHref, brandHref } from '../hooks/useHashRoute';
import { TopBrandSection, PrimesToggle, HideApsCToggle, claudeCell, type TopBrandRow } from './TablesTab';

interface Props {
  data: DashboardData;
}

interface StatsRow {
  lensId: string;
  brand: string;
  postCount: number;
  commentCount: number;
  avgScore: number;
  avgUpvoteRatio: number;
  avgComments: number;
  scoreSentiment: number;
  claudeScore: number | null;
  [key: string]: unknown;
}

export function OverviewTab({ data }: Props) {
  const { results, lenses, lensById, claudeSentiment } = data;
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

  const topBrandRows = useMemo<TopBrandRow[]>(() => {
    const map: Record<string, { lensId: string; title: string; url: string; subreddit: string; score: number; weight: number }> = {};
    for (const post of posts) {
      const w = calcWeight(post);
      for (const lensId of post.lensIds) {
        const brand = brandOf(lensId, lensById);
        if (!map[brand] || w > map[brand].weight) {
          map[brand] = { lensId, title: post.title, url: post.id && post.subreddit ? postCommentsUrl(post) : post.url, subreddit: post.subreddit, score: post.score, weight: w };
        }
      }
    }
    return Object.entries(map)
      .map(([brand, p]) => ({
        brand,
        ...p,
        weight: parseFloat(p.weight.toFixed(3)),
        claudeScore: claudeSentiment[p.lensId]?.score ?? null,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [posts, lensById, claudeSentiment]);

  const statsRows = useMemo<StatsRow[]>(() => (
    stats.map(s => ({
      ...s,
      brand: brandOf(s.lensId, lensById),
      claudeScore: claudeSentiment[s.lensId]?.score ?? null,
    }))
  ), [stats, lensById, claudeSentiment]);

  const brands = useMemo(() => [...new Set(lenses.map(l => l.brand))].sort(), [lenses]);

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

      <TopBrandSection rows={topBrandRows} lensById={lensById} />

      <AllLensesSection rows={statsRows} lensById={lensById} brands={brands} />

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

// All-lenses table: simplified version of TablesTab's StatsSection — brand
// dropdown, primes-only toggle, and hide-APS-C toggle (default on).
interface AllLensesProps {
  rows: StatsRow[];
  lensById: Record<string, Lens>;
  brands: string[];
}

function AllLensesSection({ rows, lensById, brands }: AllLensesProps) {
  const [sortKey, setSortKey] = useState('postCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [brand, setBrand] = useState('');
  const [primesOnly, setPrimesOnly] = useState(false);
  const [hideApsC, setHideApsC] = useState(true);

  const onSort = (key: string) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => (
    sortRows(rows, sortKey, sortAsc).filter(s => {
      const lens = lensById[s.lensId];
      if (brand && s.brand !== brand) return false;
      if (primesOnly && !(lens?.category ?? []).includes('prime')) return false;
      if (hideApsC && (lens?.category ?? []).includes('aps-c')) return false;
      return true;
    })
  ), [rows, sortKey, sortAsc, brand, primesOnly, hideApsC, lensById]);

  const COLS = [
    { key: 'lensId', label: 'Lens' },
    { key: 'brand', label: 'Brand' },
    { key: 'postCount', label: 'Post Mentions' },
    { key: 'commentCount', label: 'Comment Mentions' },
    { key: 'avgScore', label: 'Avg Score' },
    { key: 'avgUpvoteRatio', label: 'Avg Ratio' },
    { key: 'avgComments', label: 'Avg Comments' },
    { key: 'scoreSentiment', label: 'Score Sentiment' },
    { key: 'claudeScore', label: 'Claude Score' },
  ];

  return (
    <CollapsibleSection title="All Lenses — Stats">
      <div className="filter-bar">
        <label>
          <span className="filter-header">Brand</span>
          <select value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <PrimesToggle value={primesOnly} onChange={setPrimesOnly} />
        <HideApsCToggle value={hideApsC} onChange={setHideApsC} />
      </div>
      <SortableTable
        columns={COLS}
        rows={filtered}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={onSort}
        renderRow={(s, i) => (
          <tr key={i}>
            <td className="highlight"><LensNameLink lensId={s.lensId} lensById={lensById} /></td>
            <td><BrandBadge brand={s.brand} /></td>
            <td className="num">{s.postCount}</td>
            <td className="num">{s.commentCount}</td>
            <td className="num">{s.avgScore.toLocaleString()}</td>
            <td className="num">{(s.avgUpvoteRatio * 100).toFixed(1)}%</td>
            <td className="num">{s.avgComments}</td>
            <td className="num">{s.scoreSentiment}</td>
            {claudeCell(s.claudeScore)}
          </tr>
        )}
      />
    </CollapsibleSection>
  );
}

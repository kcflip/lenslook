import { useState, useMemo } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { SortableTable, sortRows } from '../components/SortableTable';
import { RangeSlider } from '../components/RangeSlider';
import { BrandBadge } from '../components/BrandBadge';
import { LensNameLink } from '../components/LensNameLink';
import type { DashboardData, Lens } from '../types';
import { brandOf, calcWeight, parseAperture, parseFocalLength, postCommentsUrl, commentPermalink } from '../utils';

interface Props {
  data: DashboardData;
}

// ── Shared filter bounds computed once from lenses ──
function useBounds(lenses: Lens[], statsRows: StatsRow[], topPostRows: TopPostRow[]) {
  return useMemo(() => {
    const apertureValues = lenses.map(l => parseAperture(l.maxAperture)).filter((x): x is number => x != null);
    const focalValues = lenses.flatMap(l => parseFocalLength(l.focalLength) ?? []);
    return {
      aperture: [Math.min(...apertureValues), Math.max(...apertureValues)] as [number, number],
      focal: [Math.min(...focalValues), Math.max(...focalValues)] as [number, number],
      postCount: [0, Math.max(...statsRows.map(s => s.postCount))] as [number, number],
      commentCount: [0, Math.max(...statsRows.map(s => s.commentCount))] as [number, number],
    };
  }, [lenses, statsRows, topPostRows]);
}

// Renders the Claude Score cell — matches BrandDetailPage styling.
function claudeCell(score: number | null) {
  if (score == null) return <td className="num">—</td>;
  return (
    <td className="num" style={{ fontWeight: 600 }}>
      {score > 0 ? '+' : ''}{score.toFixed(2)}
    </td>
  );
}

// ── Row types ──
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

interface TopPostRow {
  lensId: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  weight: number;
  claudeScore: number | null;
  [key: string]: unknown;
}

interface TopCommentRow {
  lensId: string;
  body: string;
  score: number;
  postTitle: string;
  postUrl: string;
  subreddit: string;
  commentPermalink?: string;
  [key: string]: unknown;
}

interface TopBrandRow {
  brand: string;
  lensId: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  weight: number;
  claudeScore: number | null;
  [key: string]: unknown;
}

export function TablesTab({ data }: Props) {
  const { results, lenses, lensById, claudeSentiment } = data;
  const { stats, posts } = results;

  // ── Derive base rows ──
  const statsRows = useMemo<StatsRow[]>(() => (
    stats.map(s => ({
      ...s,
      brand: brandOf(s.lensId, lensById),
      claudeScore: claudeSentiment[s.lensId]?.score ?? null,
    }))
  ), [stats, lensById, claudeSentiment]);

  const topPostRows = useMemo<TopPostRow[]>(() => {
    const map: Record<string, { title: string; url: string; subreddit: string; score: number; weight: number }> = {};
    for (const post of posts) {
      const w = calcWeight(post);
      for (const lensId of post.lensIds) {
        if (!map[lensId] || w > map[lensId].weight) {
          map[lensId] = { title: post.title, url: post.id && post.subreddit ? postCommentsUrl(post) : post.url, subreddit: post.subreddit, score: post.score, weight: w };
        }
      }
    }
    return Object.entries(map)
      .map(([lensId, p]) => ({
        lensId,
        ...p,
        weight: parseFloat(p.weight.toFixed(3)),
        claudeScore: claudeSentiment[lensId]?.score ?? null,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [posts, claudeSentiment]);

  const topCommentRows = useMemo<TopCommentRow[]>(() => {
    const map: Record<string, { body: string; score: number; postTitle: string; postUrl: string; subreddit: string; commentPermalink?: string }> = {};
    for (const post of posts) {
      if (!post.matchedComments?.length) continue;
      for (const comment of post.matchedComments) {
        // Attribute a comment only to the lenses it actually mentions;
        // fall back to post-level attribution for pre-upgrade data.
        const lensIds = comment.lensIds ?? post.commentLensIds;
        for (const lensId of lensIds) {
          if (!map[lensId] || comment.score > map[lensId].score) {
            const permalink = comment.id && post.id && post.subreddit
              ? commentPermalink(post, comment.id)
              : undefined;
            const postUrl = post.id && post.subreddit ? postCommentsUrl(post) : post.url;
            map[lensId] = { body: comment.body, score: comment.score, postTitle: post.title, postUrl, subreddit: post.subreddit, commentPermalink: permalink };
          }
        }
      }
    }
    return Object.entries(map)
      .map(([lensId, c]) => ({ lensId, ...c }))
      .sort((a, b) => b.score - a.score);
  }, [posts]);

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

  const bounds = useBounds(lenses, statsRows, topPostRows);
  const brands = useMemo(() => [...new Set(lenses.map(l => l.brand))].sort(), [lenses]);

  return (
    <>
      <TopBrandSection rows={topBrandRows} lensById={lensById} />
      <StatsSection rows={statsRows} lenses={lenses} lensById={lensById} bounds={bounds} brands={brands} />
      <TopPostSection rows={topPostRows} lenses={lenses} lensById={lensById} bounds={bounds} brands={brands} />
      <TopCommentSection rows={topCommentRows} lensById={lensById} />
    </>
  );
}

// ── Top comment per lens ──
function TopCommentSection({ rows, lensById }: { rows: TopCommentRow[]; lensById: Record<string, Lens> }) {
  const [sortKey, setSortKey] = useState('score');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => sortRows(rows, sortKey, sortAsc), [rows, sortKey, sortAsc]);

  const onSort = (key: string) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const COLS = [
    { key: 'lensId', label: 'Lens' },
    { key: 'body', label: 'Comment' },
    { key: 'score', label: 'Score' },
    { key: 'subreddit', label: 'Sub' },
    { key: 'postTitle', label: 'Post' },
  ];

  return (
    <CollapsibleSection title="Highest-Scored Comment per Lens">
      <SortableTable
        columns={COLS}
        rows={sorted}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={onSort}
        renderRow={(r, i) => {
          const shortBody = r.body.length > 120 ? r.body.slice(0, 117) + '…' : r.body;
          const shortTitle = r.postTitle.length > 60 ? r.postTitle.slice(0, 57) + '…' : r.postTitle;
          return (
            <tr key={i}>
              <td className="highlight" style={{ whiteSpace: 'nowrap' }}><LensNameLink lensId={r.lensId} lensById={lensById} /></td>
              <td style={{ maxWidth: '420px' }}>
                {r.commentPermalink ? (
                  <a
                    href={r.commentPermalink}
                    target="_blank"
                    rel="noopener"
                    title="View comment on Reddit"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {shortBody}
                  </a>
                ) : shortBody}
              </td>
              <td className="num">{r.score.toLocaleString()}</td>
              <td>r/{r.subreddit}</td>
              <td><a href={r.postUrl} target="_blank" rel="noopener">{shortTitle}</a></td>
            </tr>
          );
        }}
      />
    </CollapsibleSection>
  );
}

// ── Top brand per brand ──
function TopBrandSection({ rows, lensById }: { rows: TopBrandRow[]; lensById: Record<string, Lens> }) {
  const [sortKey, setSortKey] = useState('weight');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => sortRows(rows, sortKey, sortAsc), [rows, sortKey, sortAsc]);

  const onSort = (key: string) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const COLS = [
    { key: 'brand', label: 'Brand' },
    { key: 'lensId', label: 'Lens' },
    { key: 'title', label: 'Post' },
    { key: 'subreddit', label: 'Sub' },
    { key: 'score', label: 'Score' },
    { key: 'weight', label: 'Weight' },
    { key: 'claudeScore', label: 'Claude Score' },
  ];

  return (
    <CollapsibleSection title="Highest-Weighted Post per Brand">
      <SortableTable
        columns={COLS}
        rows={sorted}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={onSort}
        renderRow={(r, i) => {
          const short = r.title.length > 80 ? r.title.slice(0, 77) + '…' : r.title;
          return (
            <tr key={i}>
              <td><BrandBadge brand={r.brand} /></td>
              <td className="highlight" style={{ whiteSpace: 'nowrap' }}><LensNameLink lensId={r.lensId} lensById={lensById} /></td>
              <td><a href={r.url} target="_blank" rel="noopener">{short}</a></td>
              <td>r/{r.subreddit}</td>
              <td className="num">{r.score.toLocaleString()}</td>
              <td className="num">{r.weight}</td>
              {claudeCell(r.claudeScore)}
            </tr>
          );
        }}
      />
    </CollapsibleSection>
  );
}

// ── All lenses stats ──
interface SectionProps {
  rows: StatsRow[];
  lenses: Lens[];
  lensById: Record<string, Lens>;
  bounds: ReturnType<typeof useBounds>;
  brands: string[];
}

function StatsSection({ rows, lenses, lensById, bounds, brands }: SectionProps) {
  const [sortKey, setSortKey] = useState('postCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [brand, setBrand] = useState('');
  const [aperture, setAperture] = useState<[number, number]>(bounds.aperture);
  const [focal, setFocal] = useState<[number, number]>(bounds.focal);
  const [postRange, setPostRange] = useState<[number, number]>(bounds.postCount);
  const [commentRange, setCommentRange] = useState<[number, number]>(bounds.commentCount);

  const onSort = (key: string) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    const apActive = aperture[0] > bounds.aperture[0] || aperture[1] < bounds.aperture[1];
    const flActive = focal[0] > bounds.focal[0] || focal[1] < bounds.focal[1];
    const pcActive = postRange[0] > bounds.postCount[0] || postRange[1] < bounds.postCount[1];
    const ccActive = commentRange[0] > bounds.commentCount[0] || commentRange[1] < bounds.commentCount[1];

    return sortRows(rows, sortKey, sortAsc).filter(s => {
      const lens = lensById[s.lensId];
      if (brand && s.brand !== brand) return false;
      if (apActive) {
        const a = parseAperture(lens?.maxAperture);
        if (a == null || a < aperture[0] || a > aperture[1]) return false;
      }
      if (flActive) {
        const r = parseFocalLength(lens?.focalLength);
        if (!r || r[1] < focal[0] || r[0] > focal[1]) return false;
      }
      if (pcActive && (s.postCount < postRange[0] || s.postCount > postRange[1])) return false;
      if (ccActive && (s.commentCount < commentRange[0] || s.commentCount > commentRange[1])) return false;
      return true;
    });
  }, [rows, sortKey, sortAsc, brand, aperture, focal, postRange, commentRange, bounds, lensById]);

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
        <RangeSlider label="Max Aperture" min={bounds.aperture[0]} max={bounds.aperture[1]} step={0.1}
          value={aperture} onChange={setAperture}
          format={(lo, hi) => `f/${lo.toFixed(1)} – f/${hi.toFixed(1)}`} />
        <RangeSlider label="Focal Length" min={bounds.focal[0]} max={bounds.focal[1]} step={1}
          value={focal} onChange={setFocal}
          format={(lo, hi) => `${Math.round(lo)}mm – ${Math.round(hi)}mm`} />
        <RangeSlider label="Post Mentions" min={bounds.postCount[0]} max={bounds.postCount[1]} step={1}
          value={postRange} onChange={setPostRange}
          format={(lo, hi) => `${lo} – ${hi}`} />
        <RangeSlider label="Comment Mentions" min={bounds.commentCount[0]} max={bounds.commentCount[1]} step={1}
          value={commentRange} onChange={setCommentRange}
          format={(lo, hi) => `${lo} – ${hi}`} />
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

// ── Top post per lens ──
interface TopPostSectionProps {
  rows: TopPostRow[];
  lenses: Lens[];
  lensById: Record<string, Lens>;
  bounds: ReturnType<typeof useBounds>;
  brands: string[];
}

function TopPostSection({ rows, lenses, lensById, bounds, brands }: TopPostSectionProps) {
  void lenses;
  const [sortKey, setSortKey] = useState('weight');
  const [sortAsc, setSortAsc] = useState(false);
  const [brand, setBrand] = useState('');
  const [aperture, setAperture] = useState<[number, number]>(bounds.aperture);
  const [focal, setFocal] = useState<[number, number]>(bounds.focal);

  const onSort = (key: string) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    const apActive = aperture[0] > bounds.aperture[0] || aperture[1] < bounds.aperture[1];
    const flActive = focal[0] > bounds.focal[0] || focal[1] < bounds.focal[1];

    return sortRows(rows, sortKey, sortAsc).filter(r => {
      const lens = lensById[r.lensId];
      if (brand && brandOf(r.lensId, lensById) !== brand) return false;
      if (apActive) {
        const a = parseAperture(lens?.maxAperture);
        if (a == null || a < aperture[0] || a > aperture[1]) return false;
      }
      if (flActive) {
        const fl = parseFocalLength(lens?.focalLength);
        if (!fl || fl[1] < focal[0] || fl[0] > focal[1]) return false;
      }
      return true;
    });
  }, [rows, sortKey, sortAsc, brand, aperture, focal, bounds, lensById]);

  const COLS = [
    { key: 'lensId', label: 'Lens' },
    { key: 'title', label: 'Post' },
    { key: 'subreddit', label: 'Sub' },
    { key: 'score', label: 'Score' },
    { key: 'weight', label: 'Weight' },
    { key: 'claudeScore', label: 'Claude Score' },
  ];

  return (
    <CollapsibleSection title="Highest-Weighted Post per Lens">
      <div className="filter-bar">
        <label>
          <span className="filter-header">Brand</span>
          <select value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <RangeSlider label="Max Aperture" min={bounds.aperture[0]} max={bounds.aperture[1]} step={0.1}
          value={aperture} onChange={setAperture}
          format={(lo, hi) => `f/${lo.toFixed(1)} – f/${hi.toFixed(1)}`} />
        <RangeSlider label="Focal Length" min={bounds.focal[0]} max={bounds.focal[1]} step={1}
          value={focal} onChange={setFocal}
          format={(lo, hi) => `${Math.round(lo)}mm – ${Math.round(hi)}mm`} />
      </div>
      <SortableTable
        columns={COLS}
        rows={filtered}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={onSort}
        renderRow={(r, i) => {
          const short = r.title.length > 80 ? r.title.slice(0, 77) + '…' : r.title;
          return (
            <tr key={i}>
              <td className="highlight" style={{ whiteSpace: 'nowrap' }}><LensNameLink lensId={r.lensId} lensById={lensById} /></td>
              <td><a href={r.url} target="_blank" rel="noopener">{short}</a></td>
              <td>r/{r.subreddit}</td>
              <td className="num">{r.score.toLocaleString()}</td>
              <td className="num">{r.weight}</td>
              {claudeCell(r.claudeScore)}
            </tr>
          );
        }}
      />
    </CollapsibleSection>
  );
}

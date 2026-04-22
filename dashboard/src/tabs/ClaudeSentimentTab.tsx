import { useMemo, useState } from 'react';
import type { DashboardData, ClaudeSentimentResult } from '../types';
import { StatPill } from '../components/StatPill';
import { BrandBadge } from '../components/BrandBadge';
import { LensNameLink } from '../components/LensNameLink';
import { displayName, brandOf } from '../utils';

interface Props { data: DashboardData }

type SortKey = 'name' | 'score' | 'label' | 'mentions';

type LensEntry = ClaudeSentimentResult & { id: string };

function scoreColor(score: number): string {
  if (score >= 0.7) return '#4ade80';
  if (score >= 0.4) return '#facc15';
  if (score >= 0.1) return '#fb923c';
  return '#f87171';
}

function LabelBadge({ label }: { label: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    positive: { bg: '#1a2e1a', color: '#4ade80' },
    neutral:  { bg: '#232323', color: '#9ca3af' },
    mixed:    { bg: '#2a2200', color: '#facc15' },
    negative: { bg: '#2e1a1a', color: '#f87171' },
  };
  const s = styles[label] ?? styles.neutral;
  return (
    <span className="badge" style={{ background: s.bg, color: s.color }}>
      {label}
    </span>
  );
}

export function ClaudeSentimentTab({ data }: Props) {
  const { claudeSentiment, lensById } = data;
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const allEntries = useMemo<LensEntry[]>(() =>
    Object.entries(claudeSentiment).map(([id, r]) => ({ id, ...r })),
    [claudeSentiment]
  );

  const pills = useMemo(() => {
    const with5 = allEntries.filter(e => e.mentionCount >= 5);
    const avgScore = with5.length
      ? (with5.reduce((s, e) => s + e.score, 0) / with5.length).toFixed(2)
      : 'n/a';
    const mostLoved = with5.reduce<LensEntry | null>(
      (best, e) => (!best || e.score > best.score) ? e : best, null
    );
    const mostDiscussed = [...allEntries].sort((a, b) => b.mentionCount - a.mentionCount)[0] ?? null;
    const negativeCount = allEntries.filter(e => e.score < 0).length;
    return { total: allEntries.length, with5Count: with5.length, avgScore, mostLoved, mostDiscussed, negativeCount };
  }, [allEntries]);

  const tableRows = useMemo(() => {
    return [...allEntries].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'score') cmp = a.score - b.score;
      else if (sortKey === 'mentions') cmp = a.mentionCount - b.mentionCount;
      else if (sortKey === 'name') cmp = displayName(a.id, lensById).localeCompare(displayName(b.id, lensById));
      else if (sortKey === 'label') cmp = a.label.localeCompare(b.label);
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [allEntries, sortKey, sortDir, lensById]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  return (
    <>
      <p className="meta">
        <span>{pills.total} lenses analyzed by Claude</span>
        <span>{pills.with5Count} with 5+ qualifying mentions</span>
        <span>Scale: −1 (very negative) → +1 (very positive)</span>
      </p>

      <div className="stats-row">
        <StatPill label="Avg Score (5+ mentions)" value={pills.avgScore} info="Average Claude sentiment score across lenses with 5 or more qualifying Reddit mentions. Only mentions expressing opinions about optical or build quality are counted." />
        <StatPill label="Most Loved" value={pills.mostLoved ? displayName(pills.mostLoved.id, lensById) : '—'} info="Highest sentiment score among lenses with 5+ qualifying mentions" />
        <StatPill label="Most Discussed" value={pills.mostDiscussed ? `${displayName(pills.mostDiscussed.id, lensById)} (${pills.mostDiscussed.mentionCount})` : '—'} info="Lens with the highest number of qualifying opinion mentions sent to Claude" />
        <StatPill label="Negative Lenses" value={pills.negativeCount} info="Lenses with a negative overall sentiment score — community has a net negative opinion of these" />
      </div>

      <div className="card full">
        <h2>All Lenses — Full Claude Sentiment Table</h2>
        <table>
          <thead>
            <tr>
              <th className={sortKey === 'name' ? 'sorted' : ''} onClick={() => toggleSort('name')}>
                Lens {sortKey === 'name' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th className={sortKey === 'score' ? 'sorted' : ''} onClick={() => toggleSort('score')}>
                Score {sortKey === 'score' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th className={sortKey === 'label' ? 'sorted' : ''} onClick={() => toggleSort('label')}>
                Label {sortKey === 'label' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th className={sortKey === 'mentions' ? 'sorted' : ''} onClick={() => toggleSort('mentions')}>
                Mentions {sortKey === 'mentions' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th>Summary</th>
              <th>Positives</th>
              <th>Negatives</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(e => (
              <tr key={e.id}>
                <td className="highlight" style={{ whiteSpace: 'nowrap' }}>
                  <BrandBadge brand={brandOf(e.id, lensById)} />
                  {' '}
                  <LensNameLink lensId={e.id} lensById={lensById} />
                </td>
                <td className="num">
                  <span style={{ color: scoreColor(e.score), fontWeight: 700 }}>
                    {e.score > 0 ? '+' : ''}{e.score.toFixed(2)}
                  </span>
                </td>
                <td><LabelBadge label={e.label} /></td>
                <td className="num">{e.mentionCount}</td>
                <td style={{ maxWidth: '280px', fontSize: '0.78rem', color: '#bbb', lineHeight: 1.4 }}>
                  {e.mentionCount === 0
                    ? <em style={{ color: '#444' }}>No qualifying opinions found</em>
                    : e.summary}
                </td>
                <td style={{ maxWidth: '180px', fontSize: '0.75rem', color: '#4ade80', lineHeight: 1.5 }}>
                  {e.positives.length ? e.positives.slice(0, 3).map((p, i) => <div key={i}>· {p.aspect}</div>) : <span style={{ color: '#333' }}>—</span>}
                </td>
                <td style={{ maxWidth: '180px', fontSize: '0.75rem', color: '#f87171', lineHeight: 1.5 }}>
                  {e.negatives.length ? e.negatives.slice(0, 3).map((n, i) => <div key={i}>· {n.aspect}</div>) : <span style={{ color: '#333' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

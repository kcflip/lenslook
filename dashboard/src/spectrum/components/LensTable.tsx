import { Fragment, useState } from 'react';
import { BrandMark } from './BrandMark';
import { Sparkline } from './Sparkline';
import { ClaudePill } from './ClaudePill';
import { RowDrawer } from './RowDrawer';
import { useSort, type SortDir } from '../hooks/useSort';
import { brandColor, heat } from '../utils/colors';
import type { LensRow } from '../utils/aggregate';
import { lensHref } from '../../hooks/useHashRoute';

interface Props {
  rows: LensRow[];
  maxes: { posts: number; avgScore: number; sentiment: number };
}

type SortKey = keyof LensRow;

interface Column {
  key: SortKey | 'spark';
  label: string;
  align: 'left' | 'right';
  sortable: boolean;
}

const COLS: Column[] = [
  { key: 'lensLabel', label: 'lens', align: 'left', sortable: true },
  { key: 'brand', label: 'brand', align: 'left', sortable: false },
  { key: 'posts', label: 'posts', align: 'right', sortable: true },
  { key: 'avgScore', label: 'avg.score', align: 'right', sortable: true },
  { key: 'avgRatio', label: 'ratio', align: 'right', sortable: true },
  { key: 'sentiment', label: 'sentiment', align: 'right', sortable: true },
  { key: 'spark', label: '14w', align: 'left', sortable: false },
  { key: 'claudeScore', label: 'claude', align: 'right', sortable: true },
];

export function LensTable({ rows, maxes }: Props) {
  const { sorted, key, dir, onSort } = useSort<LensRow>(rows, 'posts');
  const [openLens, setOpenLens] = useState<string | null>(null);

  return (
    <table className="spectrum-table">
      <thead>
        <tr>
          {COLS.map((c) => {
            const active = c.sortable && key === c.key;
            return (
              <th
                key={c.key as string}
                className={[
                  c.align === 'left' ? 'align-left' : '',
                  active ? 'is-active' : '',
                  !c.sortable ? 'no-sort' : '',
                ].join(' ')}
                onClick={() => c.sortable && onSort(c.key as SortKey)}
                aria-sort={ariaSort(active, dir)}
              >
                {c.label}
                {active && <span style={{ marginLeft: 4 }}>{dir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const color = brandColor(r.brand);
          const isOpen = openLens === r.lensId;
          const postsT = r.posts / maxes.posts;
          const avgT = r.avgScore / maxes.avgScore;
          const sentT = r.sentiment / maxes.sentiment;
          const barW = Math.max(4, postsT * 60);
          return (
            <Fragment key={r.lensId}>
              <tr
                className="data-row"
                onClick={() => setOpenLens(isOpen ? null : r.lensId)}
              >
                <td
                  className="align-left"
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  <a
                    href={lensHref(r.lensId)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {r.lensLabel}
                  </a>
                </td>
                <td className="align-left" style={{ color }}>
                  <BrandMark brand={r.brand} size={11} />
                </td>
                <td style={{ background: heat(postsT) }}>
                  <span className="spectrum-inline-bar" style={{ width: barW, background: color }} />
                  {r.posts}
                </td>
                <td style={{ background: heat(avgT) }}>{r.avgScore.toFixed(0)}</td>
                <td>{r.avgRatio.toFixed(2)}</td>
                <td style={{ background: heat(sentT) }}>{r.sentiment.toFixed(2)}</td>
                <td className="align-left">
                  <Sparkline data={r.spark} color={color} width={80} height={18} />
                </td>
                <td>
                  <ClaudePill value={r.claudeScore} />
                </td>
              </tr>
              {isOpen && <RowDrawer row={r} colspan={COLS.length} />}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function ariaSort(active: boolean, dir: SortDir): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}

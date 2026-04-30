import { useMemo, useState } from 'react';
import type { DashboardData, Body } from '../types';
import { SortableTable, sortRows } from '../components/SortableTable';
import { claudeCell } from './TablesTab';
import { bodyHref } from '../hooks/useHashRoute';

interface Props {
  data: DashboardData;
}

function cheapestPrice(body: Body): number | null {
  const prices: number[] = [];
  if (body.bh?.price != null) prices.push(body.bh.price);
  if (body.adorama?.price != null) prices.push(body.adorama.price);
  for (const a of body.amazon?.asins ?? []) {
    if (a.price != null) prices.push(a.price);
  }
  return prices.length ? Math.min(...prices) : null;
}

interface BodyRow {
  id: string;
  name: string;
  sensorSize: string;
  megapixels: number | null;
  releaseYear: number | null;
  price: number | null;
  claudeScore: number | null;
}

const COLS = [
  { key: 'name',        label: 'Body' },
  { key: 'sensorSize',  label: 'Sensor' },
  { key: 'megapixels',  label: 'MP' },
  { key: 'releaseYear', label: 'Year' },
  { key: 'price',       label: 'Price' },
  { key: 'claudeScore', label: 'Claude Score' },
];

export function BodiesTab({ data }: Props) {
  const { bodies, claudeSentiment } = data;
  const [sortKey, setSortKey] = useState('releaseYear');
  const [sortAsc, setSortAsc] = useState(false);
  const [sensorFilter, setSensorFilter] = useState<'all' | 'Full-Frame' | 'APS-C'>('all');

  const rows: BodyRow[] = useMemo(() => bodies.map(b => ({
    id: b.id,
    name: `${b.brand} ${b.name}`,
    sensorSize: b.sensorSize,
    megapixels: b.specs.sensor?.megapixels ?? null,
    releaseYear: b.releaseDate ? new Date(b.releaseDate).getFullYear() : null,
    price: cheapestPrice(b),
    claudeScore: claudeSentiment[b.id]?.score ?? null,
  })), [bodies, claudeSentiment]);

  const filtered = useMemo(() => {
    const base = sensorFilter === 'all' ? rows : rows.filter(r => r.sensorSize === sensorFilter);
    return sortRows(base as unknown as Record<string, unknown>[], sortKey, sortAsc) as unknown as BodyRow[];
  }, [rows, sortKey, sortAsc, sensorFilter]);

  const onSort = (key: string) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const ffCount = rows.filter(r => r.sensorSize === 'Full-Frame').length;
  const apscCount = rows.filter(r => r.sensorSize === 'APS-C').length;

  return (
    <div className="card full">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Camera Bodies ({bodies.length})</h2>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            className={`tab-pill${sensorFilter === 'all' ? ' active' : ''}`}
            onClick={() => setSensorFilter('all')}
          >
            All <span style={{ color: '#666', marginLeft: '0.3rem' }}>{rows.length}</span>
          </button>
          <button
            type="button"
            className={`tab-pill${sensorFilter === 'Full-Frame' ? ' active' : ''}`}
            onClick={() => setSensorFilter(prev => prev === 'Full-Frame' ? 'all' : 'Full-Frame')}
          >
            Full-Frame <span style={{ color: '#666', marginLeft: '0.3rem' }}>{ffCount}</span>
          </button>
          <button
            type="button"
            className={`tab-pill${sensorFilter === 'APS-C' ? ' active' : ''}`}
            onClick={() => setSensorFilter(prev => prev === 'APS-C' ? 'all' : 'APS-C')}
          >
            APS-C <span style={{ color: '#666', marginLeft: '0.3rem' }}>{apscCount}</span>
          </button>
        </div>
      </div>

      <SortableTable
        columns={COLS}
        rows={filtered}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={onSort}
        renderRow={(row, i) => (
          <tr key={i}>
            <td>
              <a href={bodyHref(row.id)}>{row.name}</a>
            </td>
            <td>{row.sensorSize}</td>
            <td className="num">{row.megapixels != null ? row.megapixels : '—'}</td>
            <td className="num">{row.releaseYear ?? '—'}</td>
            <td className="num" style={{ color: row.price != null ? '#4ade80' : '#555', fontWeight: 600 }}>
              {row.price != null ? `$${row.price.toFixed(0)}` : '—'}
            </td>
            {claudeCell(row.claudeScore)}
          </tr>
        )}
      />
    </div>
  );
}

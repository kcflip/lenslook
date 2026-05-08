import { useState, useMemo, useEffect } from 'react';
import type { DashboardData } from '../types';
import {
  brandColor, FONT_DISPLAY, FONT_MONO,
  BG_TONES, ACCENTS,
  POSITIVE_COLOR, NEGATIVE_COLOR,
  TEXT_PRIMARY, TEXT_DIM, TEXT_DIMMER, TEXT_MUTED, TEXT_FAINT,
  BORDER, BORDER_MED,
  type BgTone, type Accent,
} from './tokens';
import { ClaudePill } from './components/ClaudePill';
import { bodyHref } from '../hooks/useHashRoute';

type System = 'Sony' | 'Nikon';
type SensorFilter = 'all' | 'Full-Frame' | 'APS-C';
type SortKey = 'name' | 'sensorSize' | 'megapixels' | 'releaseYear' | 'price' | 'claudeScore';

interface Props {
  data: DashboardData;
  system: System;
  onSystemChange: (s: System) => void;
}

interface BodyRow {
  id: string;
  brand: string;
  name: string;
  sensorSize: string;
  megapixels: number | null;
  releaseYear: number | null;
  price: number | null;
  claudeScore: number | null;
}

function cheapestPrice(body: DashboardData['bodies'][0]): number | null {
  const prices: number[] = [];
  if (body.bh?.price != null) prices.push(body.bh.price);
  if (body.adorama?.price != null) prices.push(body.adorama.price);
  for (const a of body.amazon?.asins ?? []) if (a.price != null) prices.push(a.price);
  return prices.length ? Math.min(...prices) : null;
}

export function BodiesPage({ data, system, onSystemChange }: Props) {
  const { bodies, claudeSentiment } = data;

  const [bgTone] = useState<BgTone>(() => (localStorage.getItem('lenslook:bg-tone') as BgTone) ?? 'charcoal');
  const [accent] = useState<Accent>(() => (localStorage.getItem('lenslook:accent') as Accent) ?? 'white');
  const [sensorFilter, setSensorFilter] = useState<SensorFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('releaseYear');
  const [sortAsc, setSortAsc] = useState(false);

  const bg = BG_TONES[bgTone];
  const accentColor = ACCENTS[accent];

  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = bg;
    return () => { document.body.style.backgroundColor = prev; };
  }, [bg]);

  const rows: BodyRow[] = useMemo(() => bodies.map(b => ({
    id: b.id,
    brand: b.brand,
    name: `${b.brand} ${b.name}`,
    sensorSize: b.sensorSize,
    megapixels: b.specs.sensor?.megapixels ?? null,
    releaseYear: b.releaseDate ? new Date(b.releaseDate).getFullYear() : null,
    price: cheapestPrice(b),
    claudeScore: claudeSentiment[b.id]?.score ?? null,
  })), [bodies, claudeSentiment]);

  const filtered = useMemo(() => {
    let base = sensorFilter === 'all' ? rows : rows.filter(r => r.sensorSize === sensorFilter);
    return [...base].sort((a, b) => {
      const av = a[sortKey] as string | number | null;
      const bv = b[sortKey] as string | number | null;
      if (av == null) return 1;
      if (bv == null) return -1;
      const diff = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortAsc ? diff : -diff;
    });
  }, [rows, sensorFilter, sortKey, sortAsc]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const COLS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
    { key: 'name', label: 'Body', align: 'left' },
    { key: 'sensorSize', label: 'Sensor', align: 'left' },
    { key: 'megapixels', label: 'MP', align: 'right' },
    { key: 'releaseYear', label: 'Year', align: 'right' },
    { key: 'price', label: 'Price', align: 'right' },
    { key: 'claudeScore', label: 'Claude', align: 'right' },
  ];

  return (
    <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh' }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: `1px solid ${BORDER}`, backgroundColor: bg }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <a href="#" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em' }}>← LENSLOOK</a>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: '0.08em' }}>BODIES</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['Sony', 'Nikon'] as System[]).map(s => (
              <button key={s} onClick={() => s !== 'Nikon' && onSystemChange(s)} disabled={s === 'Nikon'}
                style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.08em', padding: '3px 10px', borderRadius: 2, border: 'none', cursor: s === 'Nikon' ? 'default' : 'pointer', background: system === s ? accentColor : 'rgba(255,255,255,0.06)', color: system === s ? '#000' : s === 'Nikon' ? TEXT_FAINT : TEXT_DIM, opacity: s === 'Nikon' ? 0.4 : 1, transition: 'background 0.15s ease' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>
        {/* ── Title ── */}
        <div style={{ padding: '28px 0 24px' }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 700, letterSpacing: '-0.04em', margin: '0 0 6px 0', lineHeight: 1.05 }}>Camera bodies</h1>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIMMER }}>{filtered.length} bodies</div>
        </div>

        {/* ── Filter chips ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['all', 'Full-Frame', 'APS-C'] as SensorFilter[]).map(f => (
            <button key={f} onClick={() => setSensorFilter(f)}
              style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.08em', padding: '4px 12px', borderRadius: 999, border: `1px solid ${sensorFilter === f ? accentColor : 'rgba(255,255,255,0.1)'}`, background: sensorFilter === f ? accentColor + '18' : 'transparent', color: sensorFilter === f ? accentColor : TEXT_DIM, cursor: 'pointer', transition: 'all 0.15s ease' }}>
              {f}
            </button>
          ))}
        </div>

        {/* ── Table ── */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER_MED}` }}>
                {COLS.map(col => (
                  <th key={col.key} onClick={() => onSort(col.key)}
                    style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: sortKey === col.key ? accentColor : TEXT_MUTED, textAlign: col.align, padding: '8px 10px', cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, fontWeight: sortKey === col.key ? 700 : 400 }}>
                    {col.label}{sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <BodyTableRow key={row.id} row={row} accentColor={accentColor} />
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: '24px 10px', fontFamily: FONT_MONO, fontSize: 11, color: TEXT_FAINT, textAlign: 'center' as const }}>
              No bodies match the current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BodyTableRow({ row, accentColor }: { row: BodyRow; accentColor: string }) {
  const [hovered, setHovered] = useState(false);
  const bColor = brandColor(row.brand);

  return (
    <tr
      onClick={() => { window.location.hash = bodyHref(row.id).slice(1); }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ borderBottom: `1px solid ${BORDER}`, background: hovered ? 'rgba(255,255,255,0.025)' : 'transparent', cursor: 'pointer', transition: 'background 0.12s ease' }}>
      <td style={{ padding: '8px 10px', borderLeft: `3px solid ${hovered ? bColor : 'transparent'}`, transition: 'border-color 0.12s ease' }}>
        <a href={bodyHref(row.id)} onClick={e => e.stopPropagation()}
          style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY, textDecoration: 'none' }}>
          {row.name}
        </a>
      </td>
      <td style={{ padding: '8px 10px', fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>{row.sensorSize}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>{row.megapixels ?? '—'}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>{row.releaseYear ?? '—'}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: row.price != null ? accentColor : TEXT_FAINT }}>
        {row.price != null ? `$${Math.round(row.price).toLocaleString()}` : '—'}
      </td>
      <td style={{ padding: '8px 10px', textAlign: 'right' as const }}>
        {row.claudeScore != null ? <ClaudePill score={row.claudeScore} /> : <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>—</span>}
      </td>
    </tr>
  );
}

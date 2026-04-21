import { lensHref } from '../hooks/useHashRoute';

interface Row {
  lensId: string;
  label: string;
  value: number;
  color: string;
}

interface LensBarListProps {
  rows: Row[];
  valueFormat?: (v: number) => string;
}

export function LensBarList({ rows, valueFormat = v => v.toLocaleString() }: LensBarListProps) {
  const max = Math.max(...rows.map(r => r.value), 0);
  return (
    <div className="lens-bar-list">
      {rows.map(r => {
        const pct = max > 0 ? (r.value / max) * 100 : 0;
        return (
          <div key={r.lensId} className="lens-bar-row">
            <a className="lens-bar-label" href={lensHref(r.lensId)} title={r.label}>
              {r.label}
            </a>
            <div className="lens-bar-track">
              <div
                className="lens-bar-fill"
                style={{ width: `${pct}%`, background: r.color }}
              />
            </div>
            <div className="lens-bar-value">{valueFormat(r.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

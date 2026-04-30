import { brandColor } from '../utils/colors';
import { BrandMark } from './BrandMark';

interface Props {
  label: string;
  value: string;
  delta?: string;
  brand?: string;
  onClick?: () => void;
  href?: string;
}

export function KPITile({ label, value, delta, brand, onClick, href }: Props) {
  const color = brand ? brandColor(brand) : 'var(--dim)';
  const borderTop = brand ? `3px solid ${color}` : `3px solid var(--line-strong)`;

  const content = (
    <div
      className="spectrum-kpi-tile"
      style={{ borderTop, cursor: onClick || href ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <div className="spectrum-kpi-label">
        {label}
        {brand && (
          <span style={{ color }}>
            <BrandMark brand={brand} size={9} />
          </span>
        )}
      </div>
      <div className="spectrum-kpi-value">{value}</div>
      {delta && (
        <div className="spectrum-kpi-delta" style={{ color }}>
          {delta}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
        {content}
      </a>
    );
  }
  return content;
}

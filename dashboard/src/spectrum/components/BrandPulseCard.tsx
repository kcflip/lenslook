import { BrandMark } from './BrandMark';
import { Sparkline } from './Sparkline';
import { brandColor, brandSoft } from '../utils/colors';

interface Props {
  brand: string;
  posts: number;
  avgScore: number;
  trend: number[];
  active: boolean;
  onClick: () => void;
}

export function BrandPulseCard({ brand, posts, avgScore, trend, active, onClick }: Props) {
  const color = brandColor(brand);
  const total = trend.reduce((s, v) => s + v, 0);
  const avgPerWeek = trend.length > 0 ? total / trend.length : 0;
  return (
    <div
      className="spectrum-pulse-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        borderLeft: `3px solid ${color}`,
        background: active ? brandSoft(brand) : 'var(--paper)',
        borderColor: active ? color : undefined,
      }}
    >
      <div className="spectrum-pulse-head">
        <span style={{ color }}>
          <BrandMark brand={brand} size={13} />
        </span>
        <span className="spectrum-pulse-count">{posts}</span>
      </div>
      <Sparkline data={trend} color={color} width={220} height={32} fill />
      <div className="spectrum-pulse-stats">
        <span>
          <span className="lbl">avg</span>
          {avgScore.toFixed(0)}
        </span>
        <span>
          <span className="lbl">14w</span>
          {avgPerWeek.toFixed(1)}/wk
        </span>
      </div>
    </div>
  );
}

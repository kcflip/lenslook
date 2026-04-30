import { heat } from '../utils/colors';
import { brandColor } from '../utils/colors';
import { BrandMark } from './BrandMark';

interface Props {
  brands: string[];
}

const HEAT_STOPS = [0.1, 0.35, 0.6, 0.85];

export function HeatLegend({ brands }: Props) {
  return (
    <div className="spectrum-legend">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>low</span>
        {HEAT_STOPS.map((t) => (
          <span
            key={t}
            className="spectrum-legend-swatch"
            style={{ background: heat(t), border: '1px solid var(--line)' }}
          />
        ))}
        <span>high</span>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {brands.map((b) => (
          <span key={b} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              className="spectrum-legend-dot"
              style={{ background: brandColor(b) }}
            />
            <BrandMark brand={b} size={10} />
          </span>
        ))}
      </div>
    </div>
  );
}

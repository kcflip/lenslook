import type { LensPriceHistory, PricePoint } from '../../types';
import { SOURCE_COLORS, FONT_MONO, TEXT_DIM, TEXT_DIMMER } from '../tokens';

interface Props {
  history: LensPriceHistory;
}

const RETAILER_LABELS: Record<string, string> = {
  amazon: 'Amazon',
  bh: 'B&H',
  adorama: 'Adorama',
};

export function PriceChart({ history }: Props) {
  const retailers: [string, PricePoint[]][] = [];
  if (history.amazon?.length) retailers.push(['amazon', history.amazon]);
  if (history.bh?.length) retailers.push(['bh', history.bh]);
  if (history.adorama?.length) retailers.push(['adorama', history.adorama]);
  if (history.retailers) {
    for (const [key, pts] of Object.entries(history.retailers)) {
      if (pts?.length) retailers.push([key, pts]);
    }
  }

  if (retailers.length === 0) return null;

  const allPrices = retailers.flatMap(([, pts]) => pts.map(p => p.price));
  const allTimes = retailers.flatMap(([, pts]) => pts.map(p => new Date(p.scrapedAt).getTime()));
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const priceRange = maxPrice - minPrice;
  const timeRange = maxTime - minTime;

  // 0–100 coordinate space; vector-effect="non-scaling-stroke" keeps line width in screen px
  const toX = (t: number) => timeRange === 0 ? 50 : 2 + ((t - minTime) / timeRange) * 96;
  const toY = (p: number) => priceRange === 0 ? 50 : 10 + (1 - (p - minPrice) / priceRange) * 80;

  const dateLabel = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div style={{ marginTop: 4, marginBottom: 16 }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 8, flexWrap: 'wrap' }}>
        {retailers.map(([key, pts]) => {
          const color = SOURCE_COLORS[key] ?? '#e8e8e8';
          const latest = pts.reduce((a, b) =>
            new Date(a.scrapedAt) > new Date(b.scrapedAt) ? a : b
          );
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM, letterSpacing: '0.06em' }}>
                {RETAILER_LABELS[key] ?? key}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color, fontWeight: 700 }}>
                ${latest.price.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Sparkline */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: priceRange === 0 ? 28 : 68, display: 'block' }}
      >
        {retailers.map(([key, pts]) => {
          const color = SOURCE_COLORS[key] ?? '#e8e8e8';
          const sorted = [...pts].sort(
            (a, b) => new Date(a.scrapedAt).getTime() - new Date(b.scrapedAt).getTime()
          );
          const coords = sorted
            .map(p => `${toX(new Date(p.scrapedAt).getTime())},${toY(p.price)}`)
            .join(' ');
          return (
            <polyline
              key={key}
              points={coords}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              // keeps stroke width constant in screen pixels regardless of SVG scale
              vectorEffect="non-scaling-stroke"
              opacity={0.9}
            />
          );
        })}
      </svg>

      {/* Date range */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 8, color: TEXT_DIMMER }}>{dateLabel(minTime)}</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 8, color: TEXT_DIMMER }}>{dateLabel(maxTime)}</span>
      </div>
    </div>
  );
}

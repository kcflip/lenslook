import { Sparkline } from './Sparkline';
import { brandColor, brandHover } from '../utils/colors';
import type { LensRow } from '../utils/aggregate';

interface Props {
  row: LensRow;
  colspan: number;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="spectrum-drawer-stat">
      <span className="spectrum-drawer-stat-label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function RowDrawer({ row, colspan }: Props) {
  const color = brandColor(row.brand);
  return (
    <tr className="spectrum-drawer">
      <td colSpan={colspan}>
        <div
          className="spectrum-drawer-inner"
          style={{ background: brandHover(row.brand), borderLeft: `3px solid ${color}` }}
        >
          <div>
            <div className="spectrum-drawer-label">Weekly posts · 14w</div>
            <Sparkline data={row.spark} color={color} width={300} height={56} fill showDots />
          </div>
          <div>
            <div className="spectrum-drawer-label">Engagement</div>
            <Stat label="avg.score" value={row.avgScore.toFixed(1)} />
            <Stat label="avg.comments" value={row.avgComments.toFixed(1)} />
            <Stat label="ratio" value={row.avgRatio.toFixed(2)} />
            <Stat label="sentiment" value={row.sentiment.toFixed(2)} />
          </div>
          <div>
            <div className="spectrum-drawer-label">Signals</div>
            <div className="spectrum-drawer-note">
              {row.posts} posts, {row.comments} comments across tracked subs. Claude
              sentiment{' '}
              {row.claudeScore == null
                ? 'not yet scored'
                : row.claudeScore >= 0
                ? `leans positive (+${row.claudeScore.toFixed(2)})`
                : `leans negative (${row.claudeScore.toFixed(2)})`}
              .
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

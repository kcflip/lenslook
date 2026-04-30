import { BrandMark } from './BrandMark';
import { ClaudePill } from './ClaudePill';
import { brandColor } from '../utils/colors';
import type { HighlightPost } from '../utils/aggregate';
import { lensHref } from '../../hooks/useHashRoute';

interface Props {
  rows: HighlightPost[];
}

export function HighlightPosts({ rows }: Props) {
  return (
    <div className="spectrum-highlight">
      <div className="spectrum-highlight-row is-head">
        <span>brand</span>
        <span>lens</span>
        <span>post</span>
        <span style={{ textAlign: 'right' }}>score</span>
        <span style={{ textAlign: 'right' }}>weight</span>
        <span style={{ textAlign: 'right' }}>claude</span>
      </div>
      {rows.map((r) => {
        const color = brandColor(r.brand);
        return (
          <div
            key={r.brand + r.lensId}
            className="spectrum-highlight-row"
            style={{ borderLeft: `3px solid ${color}` }}
          >
            <span style={{ color }}>
              <BrandMark brand={r.brand} size={12} />
            </span>
            <a
              href={lensHref(r.lensId)}
              className="spectrum-lens-label"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              {r.lensLabel}
            </a>
            <span>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="spectrum-highlight-post"
              >
                “{r.title}”
              </a>
              <div className="spectrum-highlight-sub">{r.subreddit}</div>
            </span>
            <span className="spectrum-highlight-num">{r.score.toLocaleString()}</span>
            <span className="spectrum-highlight-num">{r.weight.toFixed(2)}</span>
            <span style={{ textAlign: 'right' }}>
              <ClaudePill value={r.claudeScore} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

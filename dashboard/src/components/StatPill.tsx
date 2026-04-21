interface StatPillProps {
  label: string;
  value: string | number;
  info?: string;
  href?: string;
}

export function StatPill({ label, value, info, href }: StatPillProps) {
  const inner = (
    <>
      <div className="label">
        {label}
        {info && (
          <span className="stat-info">
            ⓘ
            <span className="stat-tooltip">{info}</span>
          </span>
        )}
      </div>
      <div className="value">{value}</div>
    </>
  );
  return href ? (
    <a href={href} className="stat-pill" style={{ textDecoration: 'none' }}>{inner}</a>
  ) : (
    <div className="stat-pill">{inner}</div>
  );
}

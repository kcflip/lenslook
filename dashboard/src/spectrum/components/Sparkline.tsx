interface Props {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  fill?: boolean;
  showDots?: boolean;
}

export function Sparkline({
  data,
  color,
  width = 100,
  height = 22,
  fill = false,
  showDots = false,
}: Props) {
  if (data.length === 0) {
    return <svg width={width} height={height} />;
  }
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const max = Math.max(...data, 0);
  const min = Math.min(...data);
  const span = max - min || 1;

  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + h - ((v - min) / span) * h;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${path} L${points[points.length - 1][0].toFixed(2)},${(pad + h).toFixed(2)} L${pad.toFixed(2)},${(pad + h).toFixed(2)} Z`;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && max > min && (
        <path d={area} fill={color} opacity={0.1} />
      )}
      <path d={path} stroke={color} strokeWidth={1.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {showDots &&
        points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.8} fill={color} />)}
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

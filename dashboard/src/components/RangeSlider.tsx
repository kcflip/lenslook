interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  format: (lo: number, hi: number) => string;
}

export function RangeSlider({ label, min, max, step, value, onChange, format }: RangeSliderProps) {
  const [lo, hi] = value;
  const span = max - min || 1;
  const fillLeft = ((lo - min) / span * 100) + '%';
  const fillRight = ((max - hi) / span * 100) + '%';

  const handleMin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(e.target.value);
    onChange([Math.min(next, hi), hi]);
  };

  const handleMax = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(e.target.value);
    onChange([lo, Math.max(lo, next)]);
  };

  return (
    <label>
      <span className="filter-header">
        {label}
        <span className="range-value">{format(lo, hi)}</span>
      </span>
      <div className="range-slider">
        <div className="range-track" />
        <div className="range-fill" style={{ left: fillLeft, right: fillRight }} />
        <input type="range" min={min} max={max} step={step} value={lo} onChange={handleMin} />
        <input type="range" min={min} max={max} step={step} value={hi} onChange={handleMax} />
      </div>
    </label>
  );
}

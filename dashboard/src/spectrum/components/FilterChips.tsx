import { BrandMark } from './BrandMark';
import { brandColor, brandSoft } from '../utils/colors';

interface Props {
  brands: string[];
  activeBrand: string | null;
  onBrand: (brand: string | null) => void;
  search: string;
  onSearch: (text: string) => void;
}

export function FilterChips({ brands, activeBrand, onBrand, search, onSearch }: Props) {
  return (
    <div className="spectrum-chips">
      <input
        type="text"
        className="spectrum-search"
        placeholder="search lens…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <button
        className={'spectrum-chip is-all' + (activeBrand === null ? ' is-active' : '')}
        onClick={() => onBrand(null)}
      >
        all
      </button>
      {brands.map((b) => {
        const active = activeBrand === b;
        const color = brandColor(b);
        return (
          <button
            key={b}
            className={'spectrum-chip' + (active ? ' is-active' : '')}
            style={{
              borderColor: active ? color : undefined,
              background: active ? brandSoft(b) : undefined,
            }}
            onClick={() => onBrand(active ? null : b)}
          >
            <span className="spectrum-chip-dot" style={{ background: color }} />
            <BrandMark brand={b} size={10} />
          </button>
        );
      })}
    </div>
  );
}

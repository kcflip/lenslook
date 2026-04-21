import { brandKey } from '../utils';
import { brandHref } from '../hooks/useHashRoute';

const KNOWN = ['sony','sigma','tamron','zeiss','samyang','viltrox','ttartisan','laowa'];

interface BrandBadgeProps {
  brand: string;
}

export function BrandBadge({ brand }: BrandBadgeProps) {
  const key = brandKey(brand);
  const cls = KNOWN.includes(key) ? `badge-${key}` : 'badge-other';
  return (
    <a href={brandHref(brand)} className={`badge ${cls}`} style={{ textDecoration: 'none' }}>
      {brand}
    </a>
  );
}

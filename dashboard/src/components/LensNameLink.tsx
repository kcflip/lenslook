import type { Lens } from '../types';
import { displayName } from '../utils';
import { lensHref } from '../hooks/useHashRoute';

interface LensNameLinkProps {
  lensId: string;
  lensById: Record<string, Lens>;
}

export function LensNameLink({ lensId, lensById }: LensNameLinkProps) {
  const name = displayName(lensId, lensById);
  return <a href={lensHref(lensId)}>{name}</a>;
}

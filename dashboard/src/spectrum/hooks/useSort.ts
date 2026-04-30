import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export function useSort<T>(
  rows: T[],
  initialKey: keyof T,
  initialDir: SortDir = 'desc',
) {
  const [key, setKey] = useState<keyof T>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return copy;
  }, [rows, key, dir]);

  function onSort(nextKey: keyof T) {
    if (nextKey === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setKey(nextKey);
      setDir('desc');
    }
  }

  return { sorted, key, dir, onSort };
}

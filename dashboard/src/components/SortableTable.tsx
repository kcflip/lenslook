export interface Column {
  key: string;
  label: string;
}

interface SortableTableProps<T> {
  columns: Column[];
  rows: T[];
  sortKey: string;
  sortAsc: boolean;
  onSort: (key: string) => void;
  renderRow: (row: T, index: number) => React.ReactNode;
}

export function SortableTable<T>({
  columns, rows, sortKey, sortAsc, onSort, renderRow,
}: SortableTableProps<T>) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map(col => (
            <th
              key={col.key}
              data-col={col.key}
              className={sortKey === col.key ? 'sorted' : undefined}
              onClick={() => onSort(col.key)}
            >
              {col.label}
              {sortKey === col.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => renderRow(row, i))}
      </tbody>
    </table>
  );
}

export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  key: string,
  asc: boolean,
): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return asc ? av - bv : bv - av;
    }
    return asc
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}

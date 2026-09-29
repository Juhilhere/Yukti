import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '../lib/format';

export type Column<T> = {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  width?: number | string;
  mono?: boolean;
};

export function DataTable<T>({ rows, columns, rowKey, onRowClick, selectedKey, empty, dense = true, maxHeight }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; selectedKey?: string | null;
  empty?: ReactNode; dense?: boolean; maxHeight?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key] as string | number);
    return [...rows].sort((a, b) => {
      const va = get(a); const vb = get(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : -1) * sort.dir;
    });
  }, [rows, columns, sort]);

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }}
                className={cx('select-none border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted cursor-pointer hover:text-text', c.className)}
                onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
                <span className="inline-flex items-center gap-1">
                  {c.header}
                  {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx('border-b border-border/60 transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-2', selectedKey === k && 'bg-surface-2')}>
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-3 align-middle', dense ? 'py-1.5' : 'py-2.5', c.mono && 'font-mono text-[12px]', c.className)}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty}
    </div>
  );
}

interface Column {
  key: string;
  header: string;
  render?: (row: any) => React.ReactNode;
  className?: string;
}

interface Props {
  columns: Column[];
  rows: any[];
  keyField: string | ((row: any) => string);
  emptyMessage?: string;
  onRowClick?: (row: any) => void;
}

export function DataTable({
  columns,
  rows,
  keyField,
  emptyMessage = 'No records found',
  onRowClick,
}: Props) {
  const getKey = (row: any, i: number) => {
    if (typeof keyField === 'function') return keyField(row);
    return String(row[keyField] ?? i);
  };

  if (!rows.length) {
    return (
      <div className="text-center py-16 text-sm text-zinc-500 border border-zinc-800 rounded-lg bg-[#111113]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden bg-[#111113]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-[#0c0c0e]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left px-4 py-3 text-[11px] uppercase tracking-wider font-medium text-zinc-500 ${col.className ?? ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={getKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-zinc-800/80 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-zinc-900/50' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-zinc-300 ${col.className ?? ''}`}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

export function LightDataTable({
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
      <div className="text-center py-16 text-sm text-gray-400 border border-gray-200 rounded-xl bg-white">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left px-4 py-3 text-[11px] uppercase tracking-wider font-medium text-gray-500 ${col.className ?? ''}`}
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
                className={`border-b border-gray-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.className ?? ''}`}>
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

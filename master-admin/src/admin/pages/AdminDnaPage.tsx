import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X, ChevronDown, ChevronRight, User } from 'lucide-react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { fetchAllDna } from '../api/super-admin.api';

interface DnaRecordRow {
  id: string;
  imageFilename?: string;
  fileType?: string;
  status: string;
  sha256Hash?: string;
  createdAt: string;
  ownerUser?: { id: string; shortId: string; fullName?: string | null } | null;
  vaultRecord?: { id: string } | null;
}

interface OwnerGroup {
  ownerId: string;
  shortId: string;
  fullName: string | null;
  records: DnaRecordRow[];
}

export function AdminDnaPage() {
  const [records, setRecords] = useState<DnaRecordRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlight = searchParams.get('highlight');

  useEffect(() => {
    setLoading(true);
    fetchAllDna({ status: status || undefined })
      .then((d) => setRecords((d.records ?? []) as DnaRecordRow[]))
      .finally(() => setLoading(false));
  }, [status]);

  // Group so each owner's assets are shown together, rather than one flat
  // list mixing every user's files — sorted by most assets first.
  const groups = useMemo<OwnerGroup[]>(() => {
    const byOwner = new Map<string, OwnerGroup>();
    for (const r of records) {
      const ownerId = r.ownerUser?.id ?? 'unassigned';
      let g = byOwner.get(ownerId);
      if (!g) {
        g = {
          ownerId,
          shortId: r.ownerUser?.shortId ?? 'No owner',
          fullName: r.ownerUser?.fullName ?? null,
          records: [],
        };
        byOwner.set(ownerId, g);
      }
      g.records.push(r);
    }
    return Array.from(byOwner.values()).sort((a, b) => b.records.length - a.records.length);
  }, [records]);

  const columns = [
    { key: 'file', header: 'File', render: (r: DnaRecordRow) => r.imageFilename },
    { key: 'type', header: 'File Type', render: (r: DnaRecordRow) => r.fileType },
    { key: 'status', header: 'DNA Status', render: (r: DnaRecordRow) => <LightStatusBadge value={r.status} /> },
    { key: 'vault', header: 'Vault', render: (r: DnaRecordRow) => (r.vaultRecord ? 'Linked' : '—') },
    { key: 'hash', header: 'SHA-256', className: 'font-mono text-xs', render: (r: DnaRecordRow) => `${r.sha256Hash?.slice(0, 16)}…` },
    { key: 'created', header: 'Generated', render: (r: DnaRecordRow) => format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') },
  ];

  if (highlight) {
    const match = records.filter((r) => r.id === highlight);
    return (
      <div>
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-md border border-indigo-200 bg-indigo-50 text-sm text-indigo-700 w-fit">
          Showing 1 record from search
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="p-0.5 rounded hover:bg-indigo-100"
            title="Clear filter"
          >
            <X size={14} />
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
        ) : (
          <LightDataTable rows={match} keyField="id" emptyMessage="That record could not be found" columns={columns} />
        )}
      </div>
    );
  }

  return (
    <div>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="mb-4 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
      >
        <option value="">All statuses</option>
        <option value="ACTIVE">Active</option>
        <option value="ARCHIVED">Archived</option>
        <option value="DELETED">Deleted</option>
      </select>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400 border border-gray-200 rounded-xl bg-white">No records found</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.ownerId] ?? false;
            return (
              <div key={g.ownerId} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [g.ownerId]: !isCollapsed }))}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight size={16} className="text-gray-400 shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400 shrink-0" />
                    )}
                    <User size={16} className="text-indigo-600 shrink-0" />
                    <span className="font-mono text-sm font-semibold text-gray-900 truncate">{g.shortId}</span>
                    {g.fullName && <span className="text-sm text-gray-500 truncate">— {g.fullName}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-500">
                      {g.records.length} asset{g.records.length === 1 ? '' : 's'}
                    </span>
                    {g.ownerId !== 'unassigned' && (
                      <span
                        role="link"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); navigate(`/users/${g.ownerId}`); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.stopPropagation(); navigate(`/users/${g.ownerId}`); }
                        }}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        View user →
                      </span>
                    )}
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="border-t border-gray-100 p-3">
                    <LightDataTable rows={g.records} keyField="id" columns={columns} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { format } from 'date-fns';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { fetchAllUsers } from '../api/super-admin.api';

type UserRow = {
  id: string;
  shortId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  faceRegistered: boolean;
  organization: string | null;
  country: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { dnaRecords: number; shareLinks: number; certificates: number; loginHistory: number };
};

export function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchAllUsers({ q: q || undefined, role: role || undefined })
      .then((d) => setUsers(d.users as UserRow[]))
      .catch((e) => {
        setUsers([]);
        setError(e instanceof Error ? e.message : 'Failed to load users');
      })
      .finally(() => setLoading(false));
  }, [q, role]);

  return (
    <div>
      <PageHeader
        title="User Management"
        description="View and manage all registered users across the platform"
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder="Search by ID, name, email, org..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[#111113] border border-zinc-800 rounded-md text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 bg-[#111113] border border-zinc-800 rounded-md text-sm text-zinc-300 focus:outline-none"
        >
          <option value="">All roles</option>
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="ADMIN">Admin</option>
          <option value="USER">User</option>
          <option value="ANALYST">Analyst</option>
          <option value="AUDITOR">Auditor</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-md border border-red-900/50 bg-red-950/30 text-sm text-red-400">
          {error} — try refreshing or re-login as SUPER_ADMIN
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <DataTable
          rows={users}
          keyField="id"
          onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
          columns={[
            { key: 'shortId', header: 'User ID', render: (r) => <span className="font-mono text-zinc-200">{r.shortId}</span> },
            { key: 'fullName', header: 'Name', render: (r) => r.fullName ?? '—' },
            { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
            { key: 'role', header: 'Role', render: (r) => <StatusBadge value={r.role} /> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
            { key: 'dna', header: 'DNA', render: (r) => r._count.dnaRecords },
            { key: 'certs', header: 'Certs', render: (r) => r._count.certificates },
            { key: 'org', header: 'Organization', render: (r) => r.organization ?? '—' },
            { key: 'country', header: 'Country', render: (r) => r.country ?? '—' },
            { key: 'created', header: 'Joined', render: (r) => format(new Date(r.createdAt), 'MMM d, yyyy') },
          ]}
        />
      )}
    </div>
  );
}

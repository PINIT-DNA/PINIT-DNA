import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
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
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by ID, name, email, org..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400"
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
        <div className="mb-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          {error} — try refreshing or re-login as SUPER_ADMIN
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : (
        <LightDataTable
          rows={users}
          keyField="id"
          onRowClick={(row) => navigate(`/users/${row.id}`)}
          columns={[
            { key: 'shortId', header: 'User ID', render: (r) => <span className="font-mono text-gray-900">{r.shortId}</span> },
            { key: 'fullName', header: 'Name', render: (r) => r.fullName ?? '—' },
            { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
            { key: 'role', header: 'Role', render: (r) => <LightStatusBadge value={r.role} /> },
            { key: 'status', header: 'Status', render: (r) => <LightStatusBadge value={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
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

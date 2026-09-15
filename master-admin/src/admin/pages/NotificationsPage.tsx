import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatCard } from '../components/LightStatCard';
import { fetchNotifications } from '../api/super-admin.api';
import type { PlatformNotification } from '../api/super-admin.api';
import { Bell, AlertTriangle, MailOpen } from 'lucide-react';

const SEVERITY_STYLE: Record<string, string> = {
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
  error: 'bg-red-50 text-red-700 border-red-200',
};

function SeverityBadge({ value }: { value: string }) {
  const style = SEVERITY_STYLE[value] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  return <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${style}`}>{value}</span>;
}

export function NotificationsPage() {
  const [data, setData] = useState<{ notifications: PlatformNotification[]; total: number; unreadCount: number; alertCount: number } | null>(null);
  const [severity, setSeverity] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchNotifications({ severity: severity || undefined, unread: unreadOnly || undefined, limit: 100 })
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [severity, unreadOnly]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Unread (platform-wide)" value={data?.unreadCount ?? 0} icon={Bell} />
        <LightStatCard label="Unread Alerts" value={data?.alertCount ?? 0} icon={AlertTriangle} />
        <LightStatCard label="Matching Filter" value={data?.total ?? 0} icon={MailOpen} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="success">Success</option>
          <option value="critical">Critical</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400" />
          Unread only
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={data?.notifications ?? []}
          keyField="id"
          emptyMessage="No notifications match this filter"
          columns={[
            { key: 'user', header: 'User', render: (r: PlatformNotification) => <span className="font-mono text-xs">{r.user?.shortId ?? '—'}</span> },
            { key: 'title', header: 'Title', render: (r: PlatformNotification) => <span className={r.read ? 'text-gray-500' : 'text-gray-900 font-medium'}>{r.title}</span> },
            { key: 'body', header: 'Body', render: (r: PlatformNotification) => <span className="max-w-[320px] truncate block text-gray-600">{r.body}</span> },
            { key: 'category', header: 'Category', render: (r: PlatformNotification) => r.category },
            { key: 'severity', header: 'Severity', render: (r: PlatformNotification) => <SeverityBadge value={r.severity} /> },
            { key: 'read', header: 'Read', render: (r: PlatformNotification) => r.read ? 'Yes' : 'No' },
            { key: 'time', header: 'Time', render: (r: PlatformNotification) => format(new Date(r.createdAt), 'MMM d HH:mm') },
          ]}
        />
      )}
    </div>
  );
}

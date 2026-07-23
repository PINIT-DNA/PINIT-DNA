import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../../../services/dashboard.api';
import { API_BASE_URL } from '../../../config/api.config';
import { EnterpriseCard } from './shared';

interface AuditItem {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  action: string;
  title: string;
  entityType: string | null;
}

export function AuditPanel() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ items?: AuditItem[] }>(`${API_BASE_URL}/organization/audit-logs?limit=100`);
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <EnterpriseCard title="Organization audit trail" icon={<ScrollText size={16} />}>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No audit events yet.</p>
      ) : (
        <ul className="divide-y divide-bg-border -mx-1 max-h-[60vh] overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="py-3 flex justify-between gap-3">
              <div>
                <p className="text-sm text-white">{item.title}</p>
                <p className="text-2xs text-gray-500 mt-0.5">
                  {item.action}{item.entityType ? ` · ${item.entityType}` : ''}
                </p>
              </div>
              <time className="text-2xs text-gray-500 shrink-0">
                {format(new Date(item.createdAt), 'MMM d, HH:mm')}
              </time>
            </li>
          ))}
        </ul>
      )}
    </EnterpriseCard>
  );
}

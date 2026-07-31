import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';

export interface WorkspaceRow {
  id: string;
  shortId: string | null;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export function useOrganizationWorkspaces(enabled = true) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) return [];
    setLoading(true);
    try {
      const { data } = await api.get<{ workspaces?: WorkspaceRow[] }>(
        `${API_BASE_URL}/organization/workspaces`,
      );
      const rows = data.workspaces ?? [];
      setWorkspaces(rows);
      return rows;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(name: string) {
    const { data } = await api.post<{ workspace?: WorkspaceRow }>(
      `${API_BASE_URL}/organization/workspaces`,
      { name },
    );
    await refresh();
    return data.workspace ?? null;
  }

  return { workspaces, loading, refresh, create };
}

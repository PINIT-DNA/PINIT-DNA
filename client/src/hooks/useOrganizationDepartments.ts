import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';

export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  assetCount: number;
}

export function useOrganizationDepartments(enabled = true) {
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) return [];
    setLoading(true);
    try {
      const { data } = await api.get<{ departments?: DepartmentRow[] }>(
        `${API_BASE_URL}/organization/departments`,
      );
      const rows = data.departments ?? [];
      setDepartments(rows);
      return rows;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(input: { name: string; description?: string }) {
    await api.post(`${API_BASE_URL}/organization/departments`, input);
    await refresh();
  }

  async function update(id: string, input: { name?: string; description?: string }) {
    await api.patch(`${API_BASE_URL}/organization/departments/${id}`, input);
    await refresh();
  }

  async function remove(id: string) {
    await api.delete(`${API_BASE_URL}/organization/departments/${id}`);
    await refresh();
  }

  return { departments, loading, refresh, create, update, remove };
}

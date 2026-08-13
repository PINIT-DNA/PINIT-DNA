import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { canList } from '../lib/roles.js';

export default function useSellerDesk(user) {
  const [desk, setDesk] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.pinit_id || !canList(user)) {
      setDesk(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { ok, data } = await apiFetch(
      `/api/creator/desk?pinit_id=${encodeURIComponent(user.pinit_id)}`,
    );
    setDesk(ok ? data : null);
    setLoading(false);
  }, [user?.pinit_id, user?.role, user?.can_list, user?.exchange_role]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    desk,
    loading,
    refresh,
    listings: desk?.listings || [],
    sales: desk?.sealed_sales || [],
    metrics: desk?.metrics || {},
    trackingJobs: desk?.tracking_jobs || [],
    requirements: desk?.requirements || [],
  };
}

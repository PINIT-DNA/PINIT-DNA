import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';
import useSellerDesk from '../../hooks/useSellerDesk.js';

export default function SellerAlerts({ user, hubAppUrl }) {
  const { trackingJobs } = useSellerDesk(user);
  const [summaries, setSummaries] = useState([]);

  useEffect(() => {
    if (!user?.pinit_id) return;
    (async () => {
      const { ok, data } = await apiFetch(
        `/api/hub/monitoring-summaries?pinit_id=${encodeURIComponent(user.pinit_id)}`,
      );
      setSummaries(ok ? (data.summaries || []) : []);
    })();
  }, [user?.pinit_id]);

  const items = summaries.length ? summaries : trackingJobs;

  return (
    <StudioPage
      title="Hub Alerts"
      subtitle="Protection and monitoring signals from Pinit Hub. Open Hub for full forensic detail."
      actions={hubAppUrl ? (
        <a className="btn-secondary" href={`${hubAppUrl}/vault`} target="_blank" rel="noreferrer">Open Hub</a>
      ) : null}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} color="var(--primary)" />}
          title="No Hub alerts"
          description="Monitoring summaries appear here after a licensed asset is tracked in Hub."
        />
      ) : (
        <ul className="studio-activity">
          {items.map((row, i) => (
            <li key={row.job_id || row.asset_id || i}>
              {row.title || row.asset_id || 'Asset'} · {row.status || 'monitoring'}
              {row.matches_found != null ? ` · ${row.matches_found} matches` : ''}
            </li>
          ))}
        </ul>
      )}
    </StudioPage>
  );
}

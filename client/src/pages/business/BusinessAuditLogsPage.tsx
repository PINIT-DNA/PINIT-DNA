import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { RequireFeature } from '../../components/subscription/RequireFeature';
import { AuditPanel } from '../../components/business/profile/AuditPanel';

export function BusinessAuditLogsPage() {
  return (
    <RequireFeature feature="FEATURE_ENTERPRISE_TEAMS" featureLabel="Audit logs">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 pb-12">
        <div>
          <div className="inline-flex items-center gap-2 text-purple-400 text-sm font-medium mb-1">
            <ScrollText size={14} />
            Audit Logs
          </div>
          <h1 className="text-2xl font-bold text-white">Organization Audit Trail</h1>
          <p className="text-sm text-gray-400 mt-1">All organization actions are recorded here.</p>
        </div>
        <AuditPanel />
        <Link to="/profile?tab=audit" className="text-sm text-dna-400 hover:underline">← Back to profile</Link>
      </div>
    </RequireFeature>
  );
}

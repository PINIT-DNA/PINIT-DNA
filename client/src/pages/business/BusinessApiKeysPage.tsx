import { Link } from 'react-router-dom';
import { Key } from 'lucide-react';
import { RequireFeature } from '../../components/subscription/RequireFeature';
import { ApiKeysPanel } from '../../components/business/profile/ApiKeysPanel';

export function BusinessApiKeysPage() {
  return (
    <RequireFeature feature="FEATURE_API_ACCESS" featureLabel="API access">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-12">
        <div>
          <div className="inline-flex items-center gap-2 text-purple-400 text-sm font-medium mb-1">
            <Key size={14} />
            API Access
          </div>
          <h1 className="text-2xl font-bold text-white">Organization API Keys</h1>
          <p className="text-sm text-gray-400 mt-1">Enterprise-only programmatic access.</p>
        </div>
        <ApiKeysPanel />
        <Link to="/profile?tab=api" className="text-sm text-dna-400 hover:underline">← Back to profile</Link>
      </div>
    </RequireFeature>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Settings, Layers, Globe, Image } from 'lucide-react';
import { useOrganization } from '../../hooks/useOrganization';
import { BusinessSetupWizard } from '../../components/business/BusinessSetupWizard';
import { ORGANIZATION_INDUSTRY_LABELS } from '../../lib/organization-profile';

export function OrganizationSettingsPage() {
  const { organization, loading, completeSetup, refresh } = useOrganization(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-purple-400 text-sm font-medium mb-1">
            <Settings size={14} />
            Organization Settings
          </div>
          <h1 className="text-2xl font-bold text-white">
            {organization?.name?.trim() || 'Your Organization'}
          </h1>
          <p className="text-sm text-gray-400 mt-1 font-mono">{organization?.shortId ?? '—'}</p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold"
        >
          {organization?.setupCompletedAt ? 'Edit organization setup' : 'Complete setup'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          {
            icon: Building2,
            label: 'Organization name',
            value: organization?.name?.trim() || 'Not set',
          },
          {
            icon: Globe,
            label: 'Country',
            value: organization?.country?.trim() || 'Not set',
          },
          {
            icon: Layers,
            label: 'Default workspace',
            value: organization?.defaultWorkspace?.name ?? 'Main Workspace',
          },
          {
            icon: Image,
            label: 'Logo',
            value: organization?.logoUrl ? 'Uploaded' : 'Not set',
          },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-bg-border bg-bg-card p-4">
            <Icon size={16} className="text-purple-400 mb-2" />
            <p className="text-2xs text-gray-500">{label}</p>
            <p className="text-sm font-medium text-white mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {organization?.industry && (
        <div className="rounded-xl border border-bg-border bg-bg-card p-4 text-sm text-gray-400">
          Industry: <span className="text-white">{ORGANIZATION_INDUSTRY_LABELS[organization.industry]}</span>
        </div>
      )}

      <Link to="/business" className="text-sm text-dna-400 hover:underline">
        ← Back to Organization Dashboard
      </Link>

      <BusinessSetupWizard
        open={wizardOpen}
        organization={organization}
        onClose={() => setWizardOpen(false)}
        onComplete={async (payload) => {
          await completeSetup(payload);
          await refresh();
          setWizardOpen(false);
        }}
      />
    </div>
  );
}

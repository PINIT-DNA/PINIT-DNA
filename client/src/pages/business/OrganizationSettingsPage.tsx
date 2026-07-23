import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Settings, Layers, Globe, Image, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganization } from '../../hooks/useOrganization';
import { BusinessSetupWizard } from '../../components/business/BusinessSetupWizard';
import { ORGANIZATION_INDUSTRY_LABELS } from '../../lib/organization-profile';

export function OrganizationSettingsPage() {
  const { organization, loading, completeSetup, refresh, uploadLogo } = useOrganization(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleLogoChange(file: File) {
    setUploading(true);
    try {
      await uploadLogo(file);
      toast.success('Logo uploaded');
    } catch {
      toast.error('Logo upload failed');
    } finally {
      setUploading(false);
    }
  }

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

      <div className="rounded-xl border border-bg-border bg-bg-card p-4 flex flex-col sm:flex-row gap-4 items-center">
        <div className="w-20 h-20 rounded-2xl border border-bg-border bg-bg-elevated overflow-hidden flex items-center justify-center">
          {organization?.logoUrl ? (
            <img src={organization.logoUrl} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <Image size={28} className="text-gray-500" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Organization logo</p>
          <p className="text-2xs text-gray-500 mb-2">PNG, JPG or WebP · max 2 MB</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleLogoChange(f);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-bg-border text-xs text-white hover:bg-bg-elevated disabled:opacity-60"
          >
            <Upload size={14} />
            {uploading ? 'Uploading…' : 'Upload logo'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { icon: Building2, label: 'Organization name', value: organization?.name?.trim() || 'Not set' },
          { icon: Globe, label: 'Country', value: organization?.country?.trim() || 'Not set' },
          { icon: Layers, label: 'Default workspace', value: organization?.defaultWorkspace?.name ?? 'Main Workspace' },
          { icon: Globe, label: 'Website', value: organization?.website?.trim() || 'Not set' },
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

      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/business/team" className="text-dna-400 hover:underline">Team management →</Link>
        <Link to="/business/audit-logs" className="text-dna-400 hover:underline">Audit logs →</Link>
        <Link to="/business/api-keys" className="text-dna-400 hover:underline">API keys →</Link>
      </div>

      <Link to="/business" className="text-sm text-dna-400 hover:underline block">
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

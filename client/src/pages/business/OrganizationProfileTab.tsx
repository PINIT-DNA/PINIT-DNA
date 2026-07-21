import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Building2, Save, RefreshCw, Mail, Globe, MapPin,
  User, CreditCard, BarChart3, Dna, Archive, Award, Shield,
  Radio, Users, Layers, Key, FileText, Plug, ArrowUpRight, Image,
} from 'lucide-react';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { useOrganization } from '../../hooks/useOrganization';
import { useSubscription } from '../../hooks/useSubscription';
import { formatBytes } from '../../hooks/useApi';
import {
  ORGANIZATION_INDUSTRY_LABELS,
  ORGANIZATION_SIZE_LABELS,
  type OrganizationIndustry,
  type OrganizationSize,
} from '../../lib/organization-profile';

interface ProfileData {
  fullName?: string;
  shortId?: string;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  organizationIndustry?: OrganizationIndustry | null;
  organizationSize?: OrganizationSize | null;
  country?: string | null;
  bio?: string | null;
  createdAt?: string;
  workspaceName?: string | null;
  businessSetupCompletedAt?: string | null;
}

interface StatsData {
  dnaGenerated?: number;
  filesProtected?: number;
  certificates?: number;
  monitoringJobs?: number;
  activeShares?: number;
  accessEvents?: number;
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = 'text',
  hint,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-2xs text-gray-500 font-medium mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full px-3 py-2 bg-bg-elevated border border-bg-border rounded-lg text-xs text-white focus:outline-none focus:border-dna-500 ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      />
      {hint && <p className="text-2xs text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

function PlaceholderField({ label, placeholder = 'Coming soon' }: { label: string; placeholder?: string }) {
  return (
    <Field
      label={label}
      value=""
      disabled
      placeholder={placeholder}
      hint="Available in a future release"
    />
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-bg-elevated border border-bg-border rounded-lg p-4 text-center">
      <div className="flex items-center justify-center text-dna-400 mb-2">{icon}</div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-2xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export function OrganizationProfileTab({
  profile,
  stats,
  onUpdate,
}: {
  profile: ProfileData;
  stats: StatsData | null;
  onUpdate: (p: ProfileData) => void;
}) {
  const { organization, loading: orgLoading } = useOrganization(true);
  const { subscription } = useSubscription();

  const [form, setForm] = useState({
    organization: organization?.name ?? profile?.organization ?? '',
    country: organization?.country ?? profile?.country ?? '',
    phone: profile?.phone ?? '',
    bio: profile?.bio ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      organization: organization?.name ?? profile?.organization ?? '',
      country: organization?.country ?? profile?.country ?? '',
      phone: profile?.phone ?? '',
      bio: profile?.bio ?? '',
    });
  }, [
    organization?.name,
    organization?.country,
    profile?.organization,
    profile?.country,
    profile?.phone,
    profile?.bio,
  ]);

  const industry = organization?.industry ?? profile?.organizationIndustry ?? null;
  const industryLabel = industry ? ORGANIZATION_INDUSTRY_LABELS[industry] : '—';
  const sizeLabel = profile?.organizationSize
    ? ORGANIZATION_SIZE_LABELS[profile.organizationSize]
    : '—';
  const orgShortId = organization?.shortId ?? '—';
  const workspaceCreated = organization?.setupCompletedAt
    ?? profile?.businessSetupCompletedAt
    ?? profile?.createdAt;

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await api.put(`${API_BASE_URL}/profile`, {
        organization: form.organization,
        country: form.country,
        phone: form.phone,
        bio: form.bio,
      });
      onUpdate({ ...profile, ...(data as { profile?: ProfileData }).profile });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (orgLoading && !organization) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw size={24} className="animate-spin text-dna-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section 1 — Organization Information */}
      <SectionCard title="Organization Information" icon={<Building2 size={14} className="text-purple-400" />}>
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="shrink-0 flex flex-col items-center gap-2">
            <div className="w-20 h-20 rounded-2xl border border-bg-border bg-bg-elevated flex items-center justify-center overflow-hidden">
              {organization?.logoUrl ? (
                <img src={organization.logoUrl} alt="Organization logo" className="w-full h-full object-cover" />
              ) : (
                <Image size={28} className="text-gray-500" />
              )}
            </div>
            <p className="text-2xs text-gray-500 text-center">Upload via Organization Settings</p>
            <Link
              to="/business/settings"
              className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1"
            >
              Manage logo <ArrowUpRight size={10} />
            </Link>
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Organization Name"
              value={form.organization}
              onChange={(v) => setForm({ ...form, organization: v })}
              placeholder="ABC Media Pvt Ltd"
            />
            <Field label="Organization PINIT ID" value={orgShortId} disabled />
            <Field label="Industry" value={industryLabel} disabled />
            <Field label="Business Type" value={industryLabel !== '—' ? `${industryLabel} Organization` : '—'} disabled />
            <PlaceholderField label="Company Registration Number" placeholder="Optional" />
            <PlaceholderField label="GST / Tax ID" placeholder="Optional" />
          </div>
        </div>
      </SectionCard>

      {/* Section 2 — Contact Information */}
      <SectionCard title="Contact Information" icon={<Mail size={14} className="text-dna-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Business Email" value={profile?.email ?? ''} disabled placeholder="Not set" />
          <Field
            label="Business Phone"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            placeholder="+91 9876543210"
          />
          <PlaceholderField label="Website" placeholder="https://example.com" />
          <PlaceholderField label="Support Email" placeholder="support@company.com" />
        </div>
      </SectionCard>

      {/* Section 3 — Headquarters */}
      <SectionCard title="Headquarters" icon={<MapPin size={14} className="text-dna-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Country"
            value={form.country}
            onChange={(v) => setForm({ ...form, country: v })}
            placeholder="India"
          />
          <PlaceholderField label="State" />
          <PlaceholderField label="City" />
          <div className="sm:col-span-2">
            <PlaceholderField label="Address" placeholder="Street, building, postal code" />
          </div>
        </div>
      </SectionCard>

      {/* Section 4 — Organization Details */}
      <SectionCard title="Organization Details" icon={<FileText size={14} className="text-dna-400" />}>
        <div className="space-y-4">
          <div>
            <label className="text-2xs text-gray-500 font-medium mb-1 block">About Organization</label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              className="w-full px-3 py-2 bg-bg-elevated border border-bg-border rounded-lg text-xs text-white resize-none h-24 focus:outline-none focus:border-dna-500"
              placeholder="Describe your organization, mission, and what you protect with PINITHub…"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PlaceholderField label="Founded Year" placeholder="e.g. 2020" />
            <Field label="Company Size" value={sizeLabel} disabled />
            <Field label="Primary Business" value={industryLabel} disabled />
            <Field
              label="Default Workspace"
              value={organization?.defaultWorkspace?.name ?? profile?.workspaceName ?? 'Main Workspace'}
              disabled
            />
          </div>
        </div>
      </SectionCard>

      {/* Section 5 — Organization Owner */}
      <SectionCard title="Organization Owner" icon={<User size={14} className="text-purple-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Owner Name" value={profile?.fullName ?? ''} disabled />
          <Field label="Owner PINIT ID" value={profile?.shortId ?? ''} disabled />
          <Field label="Owner Email" value={profile?.email ?? ''} disabled placeholder="Not set" />
          <Field
            label="Workspace Created"
            value={workspaceCreated ? format(new Date(workspaceCreated), 'MMM d, yyyy') : '—'}
            disabled
          />
        </div>
        <p className="text-2xs text-gray-500">
          Business Free includes one owner. Team members and roles unlock with Pro and Enterprise.
        </p>
      </SectionCard>

      {/* Section 6 — Subscription */}
      <SectionCard title="Subscription" icon={<CreditCard size={14} className="text-amber-400" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={<CreditCard size={14} />} label="Current Plan" value={subscription?.planName ?? 'Free'} />
          <StatCard
            icon={<Shield size={14} />}
            label="Protected Assets"
            value={`${subscription?.protectedAssetCount ?? 0}${subscription?.assetLimit != null ? ` / ${subscription.assetLimit}` : ''}`}
          />
          <StatCard
            icon={<Archive size={14} />}
            label="Storage Used"
            value={formatBytes(subscription?.storageUsedBytes ?? 0)}
          />
          <StatCard
            icon={<Users size={14} />}
            label="Team Members"
            value={`${subscription?.teamMemberCount ?? 1}${subscription?.teamMemberLimit != null ? ` / ${subscription.teamMemberLimit}` : ''}`}
          />
          <StatCard icon={<Globe size={14} />} label="Renewal Date" value="—" />
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link to="/upgrade" className="btn btn-primary btn-sm text-xs inline-flex items-center gap-1.5">
            <ArrowUpRight size={12} />
            Upgrade Plan
          </Link>
          <Link to="/subscription" className="text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-bg-border">
            View billing
          </Link>
        </div>
      </SectionCard>

      {/* Section 7 — Organization Statistics */}
      <SectionCard title="Organization Statistics" icon={<BarChart3 size={14} className="text-dna-400" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={<Archive size={14} />} label="Total Assets" value={stats?.filesProtected ?? 0} />
          <StatCard icon={<Dna size={14} />} label="DNA Generated" value={stats?.dnaGenerated ?? 0} />
          <StatCard icon={<Award size={14} />} label="Certificates" value={stats?.certificates ?? 0} />
          <StatCard icon={<Shield size={14} />} label="Investigations" value="—" />
          <StatCard icon={<Radio size={14} />} label="Monitoring Assets" value={stats?.monitoringJobs ?? 0} />
          <StatCard icon={<Users size={14} />} label="Team Members" value={subscription?.teamMemberCount ?? 1} />
        </div>
      </SectionCard>

      {/* Future Enterprise placeholders */}
      <SectionCard title="Future Modules" icon={<Layers size={14} className="text-gray-500" />}>
        <p className="text-2xs text-gray-500 mb-3">
          Enterprise capabilities — placeholders only, not yet available on Business Free.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            { icon: <Layers size={12} />, label: 'Departments' },
            { icon: <Users size={12} />, label: 'Teams' },
            { icon: <Key size={12} />, label: 'API Keys' },
            { icon: <FileText size={12} />, label: 'Audit Logs' },
            { icon: <Plug size={12} />, label: 'Integrations' },
          ].map(({ icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg border border-dashed border-bg-border bg-bg-elevated/50 px-3 py-2.5 opacity-60"
            >
              <span className="text-gray-500">{icon}</span>
              <span className="text-2xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex items-center gap-3">
        <button onClick={() => void handleSave()} disabled={saving} className="btn btn-primary btn-sm text-xs">
          {saving ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : saved ? (
            '✓ Saved'
          ) : (
            <>
              <Save size={12} /> Save Changes
            </>
          )}
        </button>
        <Link
          to="/business/settings"
          className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
        >
          Open Organization Settings <ArrowUpRight size={12} />
        </Link>
      </div>
    </div>
  );
}

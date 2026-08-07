import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Building2, Mail, MapPin, Layers, User, CreditCard, BarChart3, Shield,
  Clock, Settings, Users, ScrollText, Key, Plug, Receipt, Upload, Image,
  Globe, ArrowUpRight, RefreshCw, Monitor, Trash2,
  Sun, Moon, Bell, ShieldCheck, Download,
} from 'lucide-react';
import { api, listVaultRecords, retrieveFromVault } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { useOrganization, invalidateOrganizationCache } from '../../hooks/useOrganization';
import { useSubscription } from '../../hooks/useSubscription';
import { useOrganizationWorkspaces } from '../../hooks/useOrganizationWorkspaces';
import { useTheme } from '../../hooks/useTheme';
import { formatBytes } from '../../hooks/useApi';
import type { VaultRecord } from '../../types/dashboard.types';
import {
  ORGANIZATION_INDUSTRIES,
  ORGANIZATION_INDUSTRY_LABELS,
  ORGANIZATION_SIZE_LABELS,
  ORGANIZATION_SIZES,
  type OrganizationIndustry,
  type OrganizationSize,
} from '../../lib/organization-profile';
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS } from '../../lib/business-types';
import { RequireFeature } from '../../components/subscription/RequireFeature';
import { SubscriptionBadge } from '../../components/subscription/RequireFeature';
import {
  EnterpriseCard, EnterpriseField, EnterpriseSelect, EnterpriseStat,
  EnterpriseBadge, SaveBar,
} from '../../components/business/profile/shared';
import { TeamPanel } from '../../components/business/profile/TeamPanel';
import { DepartmentsPanel } from '../../components/business/profile/DepartmentsPanel';
import { AuditPanel } from '../../components/business/profile/AuditPanel';
import { ApiKeysPanel } from '../../components/business/profile/ApiKeysPanel';
import { IntegrationsPanel } from '../../components/business/profile/IntegrationsPanel';
import { resolveOrgIdentity } from '../../lib/org-identity';
import { notifyProfileUpdated } from '../../hooks/useUserProfile';

type BusinessTab =
  | 'organization'
  | 'contact'
  | 'workspace'
  | 'subscription'
  | 'security'
  | 'activity'
  | 'settings'
  | 'team'
  | 'departments'
  | 'audit'
  | 'api'
  | 'integrations'
  | 'billing';

interface ProfileData {
  fullName?: string;
  shortId?: string;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  country?: string | null;
  bio?: string | null;
  createdAt?: string;
  lastLoginAt?: string | null;
  workspaceName?: string | null;
  organizationIndustry?: OrganizationIndustry | null;
  organizationSize?: OrganizationSize | null;
  businessSetupCompletedAt?: string | null;
  notifyShareAccess?: boolean;
  notifyRiskAlerts?: boolean;
}

interface StatsData {
  dnaGenerated?: number;
  filesProtected?: number;
  certificates?: number;
  monitoringJobs?: number;
  activeShares?: number;
  accessEvents?: number;
}

const BASE_TABS: { id: BusinessTab; label: string; icon: React.ReactNode }[] = [
  { id: 'organization', label: 'Organization', icon: <Building2 size={14} /> },
  { id: 'contact', label: 'Contact', icon: <Mail size={14} /> },
  { id: 'workspace', label: 'Workspace', icon: <Layers size={14} /> },
  { id: 'subscription', label: 'Subscription', icon: <CreditCard size={14} /> },
  { id: 'team', label: 'Team', icon: <Users size={14} /> },
  { id: 'security', label: 'Security', icon: <Shield size={14} /> },
  { id: 'activity', label: 'Activity', icon: <Clock size={14} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={14} /> },
];

const ENTERPRISE_TABS: { id: BusinessTab; label: string; icon: React.ReactNode }[] = [
  { id: 'departments', label: 'Departments', icon: <Layers size={14} /> },
  { id: 'audit', label: 'Audit Logs', icon: <ScrollText size={14} /> },
  { id: 'api', label: 'API Access', icon: <Key size={14} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={14} /> },
  { id: 'billing', label: 'Billing', icon: <Receipt size={14} /> },
];

export function BusinessProfileHub({
  profile,
  stats,
}: {
  profile: ProfileData;
  stats: StatsData | null;
}) {
  const clearedOrgCache = useRef(false);
  if (!clearedOrgCache.current) {
    invalidateOrganizationCache();
    clearedOrgCache.current = true;
  }

  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as BusinessTab) || 'organization';
  const { organization, loading, updateProfile, uploadLogo } = useOrganization(true);
  const { subscription, planCode } = useSubscription();
  const isEnterprise = planCode === 'ENTERPRISE';
  const identity = resolveOrgIdentity(organization, profile, loading);

  const tabs = [...BASE_TABS, ...(isEnterprise ? ENTERPRISE_TABS : [])];

  function setTab(id: BusinessTab) {
    setParams({ tab: id }, { replace: true });
  }

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) {
      setTab('organization');
    }
  }, [tab, isEnterprise]);

  if (loading && !organization) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <RefreshCw size={24} className="animate-spin text-purple-400" />
        <p className="text-xs text-gray-500">Loading organization profile…</p>
      </div>
    );
  }

  const workspaceCreated = organization?.setupCompletedAt
    ?? profile?.businessSetupCompletedAt
    ?? profile?.createdAt;

  return (
    <div className="page-shell w-full max-w-6xl">
      {/* Enterprise header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 mb-6 shadow-sm dark:border-white/10 dark:bg-[#181a1f] dark:shadow-xl dark:shadow-black/20">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="w-20 h-20 rounded-2xl border-2 border-violet-200 bg-violet-50 dark:border-blue-500/30 dark:bg-blue-500/10 flex items-center justify-center shrink-0 overflow-hidden">
            {organization?.logoUrl ? (
              <img src={organization.logoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Building2 size={32} className="text-violet-700 dark:text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-xs text-violet-800 dark:text-blue-300 font-bold uppercase tracking-widest">Business Profile</p>
              <SubscriptionBadge />
              {isEnterprise && <EnterpriseBadge tone="purple">Enterprise</EnterpriseBadge>}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{identity.orgName}</h1>
            <p className="text-sm text-violet-800 dark:text-blue-300 font-mono mt-0.5 font-semibold">{identity.orgShortId}</p>
            {identity.workspaceName && (
              <p className="text-sm text-slate-600 dark:text-gray-400 mt-1">
                Default workspace · {identity.workspaceName}
                {identity.workspaceShortId !== '—' && (
                  <span className="font-mono ml-1 text-slate-500">({identity.workspaceShortId})</span>
                )}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500 dark:text-gray-500 font-medium">Organization since</p>
            <p className="text-sm text-slate-700 dark:text-gray-300 font-semibold">
              {profile?.createdAt ? format(new Date(profile.createdAt), 'MMM d, yyyy') : '—'}
            </p>
            <Link to="/business" className="text-sm text-violet-800 dark:text-purple-300 hover:underline mt-2 inline-flex items-center gap-1 font-semibold">
              Business dashboard <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mt-5 pt-5 border-t border-slate-200 dark:border-white/10">
            <EnterpriseStat label="Vault assets" value={stats.filesProtected ?? 0} accent="dna" />
            <EnterpriseStat label="DNA generated" value={stats.dnaGenerated ?? 0} accent="purple" />
            <EnterpriseStat label="Certificates" value={stats.certificates ?? 0} accent="amber" />
            <EnterpriseStat label="Monitoring" value={stats.monitoringJobs ?? 0} accent="green" />
            <EnterpriseStat label="Team" value={subscription?.teamMemberCount ?? 1} accent="purple" />
            <EnterpriseStat
              label="Plan"
              value={subscription?.planName ?? 'Free'}
              sub={subscription?.assetLimit != null ? `${subscription.protectedAssetCount}/${subscription.assetLimit} assets` : undefined}
              accent="amber"
            />
          </div>
        )}
      </div>

      {/* Tab navigation — high contrast for light + dark */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 scrollbar-thin">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold rounded-xl transition-all whitespace-nowrap border ${
              tab === t.id
                ? 'bg-blue-600 text-white border-blue-700 shadow-md'
                : 'text-slate-800 bg-white border-slate-300 hover:bg-slate-100 hover:border-slate-400 dark:text-gray-100 dark:bg-[#1e2128] dark:border-white/15 dark:hover:text-white dark:hover:bg-[#252830]'
            }`}
            style={tab === t.id ? { color: '#ffffff' } : undefined}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === 'organization' && (
        <OrganizationTab
          organization={organization}
          profile={profile}
          identity={identity}
          workspaceCreated={workspaceCreated}
          updateProfile={updateProfile}
          uploadLogo={uploadLogo}
        />
      )}
      {tab === 'contact' && (
        <ContactTab organization={organization} profile={profile} identity={identity} updateProfile={updateProfile} />
      )}
      {tab === 'workspace' && <WorkspaceTab identity={identity} organization={organization} />}
      {tab === 'subscription' && (
        <SubscriptionTab stats={stats} subscription={subscription} />
      )}
      {tab === 'security' && <SecurityTab profile={profile} />}
      {tab === 'activity' && (isEnterprise ? <AuditPanel /> : <PersonalActivityTab />)}
      {tab === 'settings' && <BusinessSettingsTab profile={profile} />}
      {tab === 'team' && <TeamPanel />}
      {tab === 'departments' && (
        <RequireFeature feature="FEATURE_ENTERPRISE_TEAMS" featureLabel="Departments">
          <DepartmentsPanel />
        </RequireFeature>
      )}
      {tab === 'audit' && (
        <RequireFeature feature="FEATURE_ENTERPRISE_TEAMS" featureLabel="Audit logs">
          <AuditPanel />
        </RequireFeature>
      )}
      {tab === 'api' && (
        <RequireFeature feature="FEATURE_API_ACCESS" featureLabel="API access">
          <ApiKeysPanel />
        </RequireFeature>
      )}
      {tab === 'integrations' && (
        <RequireFeature feature="FEATURE_API_ACCESS" featureLabel="Integrations">
          <IntegrationsPanel />
        </RequireFeature>
      )}
      {tab === 'billing' && <BillingTab />}
    </div>
  );
}

// ── Organization Tab ───────────────────────────────────────────────────────────

function OrganizationTab({
  organization,
  identity,
  workspaceCreated,
  updateProfile,
  uploadLogo,
}: {
  organization: ReturnType<typeof useOrganization>['organization'];
  profile: ProfileData;
  identity: ReturnType<typeof resolveOrgIdentity>;
  workspaceCreated?: string;
  updateProfile: ReturnType<typeof useOrganization>['updateProfile'];
  uploadLogo: ReturnType<typeof useOrganization>['uploadLogo'];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    organizationName: identity.orgName === 'Your Organization' ? '' : identity.orgName,
    industry: identity.industry ?? '',
    organizationSize: identity.organizationSize ?? '',
    businessType: organization?.businessType ?? '',
    registrationNumber: organization?.registrationNumber ?? '',
    gst: organization?.gst ?? '',
    foundedYear: organization?.foundedYear?.toString() ?? '',
    aboutDescription: identity.aboutDescription,
    services: organization?.services ?? '',
    notes: organization?.notes ?? '',
    linkedIn: organization?.linkedIn ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    setForm({
      organizationName: identity.orgName === 'Your Organization' ? '' : identity.orgName,
      industry: identity.industry ?? '',
      organizationSize: identity.organizationSize ?? '',
      businessType: organization?.businessType ?? '',
      registrationNumber: organization?.registrationNumber ?? '',
      gst: organization?.gst ?? '',
      foundedYear: organization?.foundedYear?.toString() ?? '',
      aboutDescription: identity.aboutDescription,
      services: organization?.services ?? '',
      notes: organization?.notes ?? '',
      linkedIn: organization?.linkedIn ?? '',
    });
  }, [organization, identity]);

  useEffect(() => {
    setLogoBroken(false);
  }, [organization?.logoUrl]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Parameters<typeof updateProfile>[0] = {
        organizationName: form.organizationName.trim(),
        businessType: form.businessType,
        registrationNumber: form.registrationNumber,
        gst: form.gst,
        foundedYear: form.foundedYear ? parseInt(form.foundedYear, 10) : undefined,
        aboutDescription: form.aboutDescription,
        services: form.services,
        notes: form.notes,
        linkedIn: form.linkedIn,
      };
      if (form.industry) payload.industry = form.industry as OrganizationIndustry;
      if (form.organizationSize) payload.organizationSize = form.organizationSize as OrganizationSize;
      if (!payload.organizationName || payload.organizationName.length < 2) {
        toast.error('Organization name must be at least 2 characters');
        return;
      }
      await updateProfile(payload);
      setSaved(true);
      toast.success('Organization profile saved');
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error as string | undefined;
      toast.error(msg ?? 'Could not save profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(file: File) {
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

  return (
    <div className="space-y-4 pb-16">
      <EnterpriseCard title="Organization information" icon={<Building2 size={16} />}>
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="shrink-0 flex flex-col items-center gap-2">
            <div className="w-24 h-24 rounded-2xl border border-purple-500/20 bg-bg-elevated flex items-center justify-center overflow-hidden">
              {organization?.logoUrl && !logoBroken ? (
                <img
                  src={organization.logoUrl}
                  alt="Logo"
                  className="w-full h-full object-cover"
                  onError={() => setLogoBroken(true)}
                />
              ) : (
                <Image size={32} className="text-gray-500" />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleLogo(f);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-500/30 text-2xs text-purple-300 hover:bg-purple-500/10 disabled:opacity-60"
            >
              <Upload size={12} />
              {uploading ? 'Uploading…' : 'Upload logo'}
            </button>
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EnterpriseField
              label="Organization name"
              value={form.organizationName}
              onChange={(v) => setForm({ ...form, organizationName: v })}
            />
            <EnterpriseField label="Organization PINIT ID" value={identity.orgShortId} disabled hint="Same number as your Individual ID — PINIT-ORG-{code}" />
            <EnterpriseSelect
              label="Industry"
              value={form.industry}
              onChange={(v) => setForm({ ...form, industry: v })}
              options={[
                { value: '', label: 'Select industry' },
                ...ORGANIZATION_INDUSTRIES.map((i) => ({ value: i, label: ORGANIZATION_INDUSTRY_LABELS[i] })),
              ]}
            />
            <EnterpriseSelect
              label="Business type"
              value={form.businessType}
              onChange={(v) => setForm({ ...form, businessType: v })}
              options={[
                { value: '', label: 'Select type' },
                ...BUSINESS_TYPES.map((t) => ({ value: t, label: BUSINESS_TYPE_LABELS[t] })),
              ]}
            />
            <EnterpriseField
              label="Registration number"
              value={form.registrationNumber}
              onChange={(v) => setForm({ ...form, registrationNumber: v })}
              placeholder="Optional"
            />
            <EnterpriseField
              label="GST / Tax ID"
              value={form.gst}
              onChange={(v) => setForm({ ...form, gst: v })}
              placeholder="Optional"
            />
          </div>
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="Organization details" icon={<Globe size={16} />}>
        <div className="space-y-4">
          <div>
            <label className="text-2xs text-gray-400 font-medium mb-1.5 block uppercase tracking-wide">About organization</label>
            <textarea
              value={form.aboutDescription}
              onChange={(e) => setForm({ ...form, aboutDescription: e.target.value })}
              className="w-full px-3 py-2.5 bg-bg-elevated/80 border border-bg-border rounded-xl text-sm text-white resize-none h-28 focus:outline-none focus:border-purple-500/50"
              placeholder="Mission, focus areas, and what you protect with PINITHub…"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EnterpriseField
              label="Founded year"
              value={form.foundedYear}
              onChange={(v) => setForm({ ...form, foundedYear: v })}
              placeholder="e.g. 2020"
              type="number"
            />
            <EnterpriseSelect
              label="Company size"
              value={form.organizationSize}
              onChange={(v) => setForm({ ...form, organizationSize: v })}
              options={[
                { value: '', label: 'Select size' },
                ...ORGANIZATION_SIZES.map((s) => ({ value: s, label: ORGANIZATION_SIZE_LABELS[s] })),
              ]}
            />
            <EnterpriseField
              label="Primary services"
              value={form.services}
              onChange={(v) => setForm({ ...form, services: v })}
              placeholder="e.g. Media production, legal advisory"
            />
            <EnterpriseField
              label="LinkedIn"
              value={form.linkedIn}
              onChange={(v) => setForm({ ...form, linkedIn: v })}
              placeholder="https://linkedin.com/company/…"
            />
            <div className="sm:col-span-2">
              <EnterpriseField
                label="Internal notes"
                value={form.notes}
                onChange={(v) => setForm({ ...form, notes: v })}
                placeholder="Private notes for your team"
              />
            </div>
          </div>
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="Organization owner" icon={<User size={16} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EnterpriseField label="Owner name" value={identity.ownerName} disabled />
          <EnterpriseField label="Owner PINIT ID" value={identity.ownerShortId} disabled hint="Your personal PINIT ID" />
          <EnterpriseField label="Owner email" value={identity.ownerEmail} disabled />
          <EnterpriseField
            label="Workspace PINIT ID"
            value={identity.workspaceShortId}
            disabled
            hint="Default workspace identifier"
          />
          <EnterpriseField
            label="Workspace created"
            value={workspaceCreated ? format(new Date(workspaceCreated), 'MMM d, yyyy') : '—'}
            disabled
          />
        </div>
      </EnterpriseCard>

      <SaveBar saving={saving} saved={saved} onSave={() => void handleSave()} />
    </div>
  );
}

// ── Contact Tab ────────────────────────────────────────────────────────────────

function ContactTab({
  organization,
  profile,
  identity,
  updateProfile,
}: {
  organization: ReturnType<typeof useOrganization>['organization'];
  profile: ProfileData;
  identity: ReturnType<typeof resolveOrgIdentity>;
  updateProfile: ReturnType<typeof useOrganization>['updateProfile'];
}) {
  const [form, setForm] = useState({
    website: organization?.website ?? '',
    supportEmail: organization?.supportEmail ?? profile.email ?? '',
    supportPhone: organization?.supportPhone ?? identity.supportPhone,
    country: organization?.country ?? identity.country,
    state: organization?.state ?? '',
    city: organization?.city ?? '',
    addressLine1: organization?.addressLine1 ?? '',
    addressLine2: organization?.addressLine2 ?? '',
    postalCode: organization?.postalCode ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      website: organization?.website ?? '',
      supportEmail: organization?.supportEmail ?? profile.email ?? '',
      supportPhone: organization?.supportPhone ?? identity.supportPhone,
      country: organization?.country ?? identity.country,
      state: organization?.state ?? '',
      city: organization?.city ?? '',
      addressLine1: organization?.addressLine1 ?? '',
      addressLine2: organization?.addressLine2 ?? '',
      postalCode: organization?.postalCode ?? '',
    });
  }, [organization, profile.email, identity]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateProfile(form);
      setSaved(true);
      toast.success('Contact details saved');
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error('Could not save contact details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-16">
      <EnterpriseCard title="Contact information" icon={<Mail size={16} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EnterpriseField label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://example.com" />
          <EnterpriseField label="Support email" value={form.supportEmail} onChange={(v) => setForm({ ...form, supportEmail: v })} placeholder="support@company.com" type="email" />
          <EnterpriseField label="Support phone" value={form.supportPhone} onChange={(v) => setForm({ ...form, supportPhone: v })} placeholder="+91 9876543210" />
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="Headquarters" icon={<MapPin size={16} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EnterpriseField label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
          <EnterpriseField label="State / Province" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
          <EnterpriseField label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
          <EnterpriseField label="Postal code" value={form.postalCode} onChange={(v) => setForm({ ...form, postalCode: v })} />
          <div className="sm:col-span-2">
            <EnterpriseField label="Address line 1" value={form.addressLine1} onChange={(v) => setForm({ ...form, addressLine1: v })} />
          </div>
          <div className="sm:col-span-2">
            <EnterpriseField label="Address line 2" value={form.addressLine2} onChange={(v) => setForm({ ...form, addressLine2: v })} placeholder="Suite, floor, building" />
          </div>
        </div>
      </EnterpriseCard>

      <SaveBar saving={saving} saved={saved} onSave={() => void handleSave()} />
    </div>
  );
}

// ── Workspace Tab ──────────────────────────────────────────────────────────────

function WorkspaceTab({
  identity,
}: {
  organization: ReturnType<typeof useOrganization>['organization'];
  identity: ReturnType<typeof resolveOrgIdentity>;
}) {
  const { workspaces, loading, create } = useOrganizationWorkspaces();
  const { subscription } = useSubscription();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await create(name.trim());
      toast.success('Workspace created');
      setName('');
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Could not create workspace');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <EnterpriseCard title="Default workspace" icon={<Layers size={16} />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <EnterpriseField label="Name" value={identity.workspaceName} disabled />
          <EnterpriseField label="Workspace PINIT ID" value={identity.workspaceShortId} disabled hint="Auto-assigned PINIT-WS ID" />
          <EnterpriseField label="Organization PINIT ID" value={identity.orgShortId} disabled />
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="All workspaces" icon={<Layers size={16} />}>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ul className="divide-y divide-bg-border -mx-1">
            {workspaces.map((w) => (
              <li key={w.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    {w.name}
                    {w.isDefault && <EnterpriseBadge tone="green">Default</EnterpriseBadge>}
                  </p>
                  <p className="text-2xs text-gray-500 font-mono">{w.shortId ?? w.id.slice(0, 8)}</p>
                </div>
                <time className="text-2xs text-gray-600">{format(new Date(w.createdAt), 'MMM d, yyyy')}</time>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={(e) => void handleCreate(e)} className="flex gap-2 mt-4 pt-4 border-t border-bg-border">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New workspace name"
            className="flex-1 px-3 py-2.5 bg-bg-elevated/80 border border-bg-border rounded-xl text-sm text-white"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-semibold disabled:opacity-60"
          >
            Create
          </button>
        </form>
        {subscription?.workspaceLimit != null && (
          <p className="text-2xs text-gray-500 mt-2">
            {workspaces.length} / {subscription.workspaceLimit} workspaces used
          </p>
        )}
      </EnterpriseCard>
    </div>
  );
}

// ── Subscription Tab ───────────────────────────────────────────────────────────

function SubscriptionTab({
  stats,
  subscription,
}: {
  stats: StatsData | null;
  subscription: ReturnType<typeof useSubscription>['subscription'];
}) {
  return (
    <div className="space-y-4">
      <EnterpriseCard title="Current plan" icon={<CreditCard size={16} />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <EnterpriseStat label="Plan" value={subscription?.planName ?? 'Free'} accent="amber" />
          <EnterpriseStat
            label="Protected assets"
            value={`${subscription?.protectedAssetCount ?? 0}${subscription?.assetLimit != null ? ` / ${subscription.assetLimit}` : ''}`}
            accent="dna"
          />
          <EnterpriseStat label="Storage" value={formatBytes(subscription?.storageUsedBytes ?? 0)} accent="purple" />
          <EnterpriseStat
            label="Team members"
            value={`${subscription?.teamMemberCount ?? 1}${subscription?.teamMemberLimit != null ? ` / ${subscription.teamMemberLimit}` : ''}`}
            accent="green"
          />
          <EnterpriseStat label="Status" value={subscription?.status ?? 'ACTIVE'} accent="purple" />
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <Link to="/upgrade" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-semibold">
            <ArrowUpRight size={14} /> Upgrade plan
          </Link>
          <Link to="/subscription" className="px-4 py-2 rounded-xl border border-bg-border text-sm text-gray-300 hover:text-white">
            Manage subscription
          </Link>
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="Organization statistics" icon={<BarChart3 size={16} />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <EnterpriseStat label="Total assets" value={stats?.filesProtected ?? 0} accent="dna" />
          <EnterpriseStat label="DNA generated" value={stats?.dnaGenerated ?? 0} accent="purple" />
          <EnterpriseStat label="Certificates" value={stats?.certificates ?? 0} accent="amber" />
          <EnterpriseStat label="Active shares" value={stats?.activeShares ?? 0} accent="green" />
          <EnterpriseStat label="Access events" value={stats?.accessEvents ?? 0} accent="purple" />
          <EnterpriseStat label="Monitoring" value={stats?.monitoringJobs ?? 0} accent="dna" />
        </div>
      </EnterpriseCard>
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────────────────────

function SecurityTab({ profile }: { profile: ProfileData }) {
  const [sessions, setSessions] = useState<Array<{ id: string; loginAt: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`${API_BASE_URL}/profile/sessions`).then((r) => {
      setSessions((r.data as { sessions?: Array<{ id: string; loginAt: string }> }).sessions ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <EnterpriseCard title="Security overview" icon={<Shield size={16} />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <EnterpriseStat label="Auth method" value="Biometric" accent="green" />
          <EnterpriseStat
            label="Last login"
            value={profile?.lastLoginAt ? `${formatDistanceToNow(new Date(profile.lastLoginAt))} ago` : 'Never'}
            accent="purple"
          />
          <EnterpriseStat label="2FA" value="Biometric HOID" accent="amber" />
          <EnterpriseStat label="Active sessions" value={sessions.length} accent="dna" />
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="Active sessions" icon={<Monitor size={16} />}>
        {loading ? (
          <div className="flex justify-center py-6"><RefreshCw size={16} className="animate-spin text-purple-400" /></div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No active sessions</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between bg-bg-elevated/60 rounded-xl px-4 py-3 border border-bg-border">
                <div className="flex items-center gap-2">
                  <Monitor size={14} className="text-gray-500" />
                  <div>
                    <p className="text-sm text-white">Session {i + 1}</p>
                    <p className="text-2xs text-gray-500">Created {formatDistanceToNow(new Date(s.loginAt))} ago</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await api.delete(`${API_BASE_URL}/profile/session/${s.id}`);
                    setSessions((prev) => prev.filter((x) => x.id !== s.id));
                    toast.success('Session revoked');
                  }}
                  className="text-2xs text-red-400 hover:text-red-300 flex items-center gap-1"
                >
                  <Trash2 size={12} /> Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </div>
  );
}

// ── Personal Activity (non-enterprise) ─────────────────────────────────────────

function PersonalActivityTab() {
  const [events, setEvents] = useState<Array<{ type: string; detail: string; date: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`${API_BASE_URL}/profile/activity`).then((r) => {
      setEvents((r.data as { events?: Array<{ type: string; detail: string; date: string }> }).events ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw size={16} className="animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <EnterpriseCard title="Activity timeline" icon={<Clock size={16} />}>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No activity yet</p>
      ) : (
        <ul className="divide-y divide-bg-border -mx-1 max-h-[60vh] overflow-y-auto">
          {events.map((ev, i) => (
            <li key={i} className="py-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-white">{ev.type.replace(/_/g, ' ')}</p>
                <p className="text-2xs text-gray-500 truncate">{ev.detail}</p>
              </div>
              <time className="text-2xs text-gray-600 shrink-0">
                {formatDistanceToNow(new Date(ev.date))} ago
              </time>
            </li>
          ))}
        </ul>
      )}
    </EnterpriseCard>
  );
}

// ── Activity Tab (enterprise uses AuditPanel inline above) ─────────────────────

// ── Settings Tab ───────────────────────────────────────────────────────────────

function BusinessSettingsTab({ profile }: { profile: ProfileData }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [personalName, setPersonalName] = useState(profile?.fullName?.trim() ?? '');
  const [savingName, setSavingName] = useState(false);
  const [prefs, setPrefs] = useState({
    notifyShareAccess: profile?.notifyShareAccess ?? true,
    notifyRiskAlerts: profile?.notifyRiskAlerts ?? true,
  });
  const [vaultFiles, setVaultFiles] = useState<VaultRecord[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    setVaultLoading(true);
    listVaultRecords()
      .then(setVaultFiles)
      .catch(() => setVaultFiles([]))
      .finally(() => setVaultLoading(false));
  }, []);

  useEffect(() => {
    setPersonalName(profile?.fullName?.trim() ?? '');
  }, [profile?.fullName]);

  async function savePersonalName() {
    const fullName = personalName.trim();
    if (fullName.length < 2) {
      toast.error('Your name must be at least 2 characters');
      return;
    }
    setSavingName(true);
    try {
      await api.put(`${API_BASE_URL}/profile`, { fullName });
      notifyProfileUpdated();
      toast.success('Your name saved');
    } catch {
      toast.error('Could not save your name');
    } finally {
      setSavingName(false);
    }
  }

  async function toggle(key: keyof typeof prefs) {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    await api.put(`${API_BASE_URL}/profile/notifications`, updated);
    toast.success('Preference saved');
  }

  const downloadOwnerBackup = async (record: VaultRecord) => {
    setDownloadingId(record.id);
    try {
      const blob = await retrieveFromVault(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.originalFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Owner backup downloaded (not tracked)');
    } catch {
      toast.error('Failed to download owner backup');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <EnterpriseCard title="Your name" icon={<User size={16} />}>
        <p className="text-2xs text-slate-600 dark:text-gray-400 mb-3">
          This is the name shown on your Individual home page and profile menu.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <EnterpriseField
              label="Full name"
              value={personalName}
              onChange={setPersonalName}
              placeholder="Your name"
            />
          </div>
          <button
            type="button"
            disabled={savingName}
            onClick={() => void savePersonalName()}
            className="px-4 py-2 rounded-lg bg-dna-500 hover:bg-dna-400 text-white text-xs font-semibold disabled:opacity-60"
          >
            {savingName ? 'Saving…' : 'Save name'}
          </button>
        </div>
        {profile?.shortId && (
          <p className="text-2xs text-slate-500 dark:text-gray-500 mt-2 font-mono">PINIT ID · {profile.shortId}</p>
        )}
      </EnterpriseCard>

      <EnterpriseCard title="Appearance" icon={theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Theme</p>
            <p className="text-2xs text-slate-600 dark:text-gray-400">Switch between light and dark mode</p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className={`w-10 h-6 rounded-full transition-colors relative ${theme === 'dark' ? 'bg-blue-600' : 'bg-gray-400'}`}
            aria-label="Toggle theme"
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${theme === 'dark' ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      </EnterpriseCard>

      <EnterpriseCard title="Organization notifications" icon={<Bell size={16} />}>
        {[
          { key: 'notifyShareAccess' as const, label: 'Secure share activity', desc: 'Link views, downloads, and revokes' },
          { key: 'notifyRiskAlerts' as const, label: 'Risk & security alerts', desc: 'Policy blocks and tampering attempts' },
        ].map((item) => (
          <div key={item.key} className="flex items-center justify-between py-3 border-b border-slate-200 dark:border-white/10 last:border-0">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</p>
              <p className="text-2xs text-slate-600 dark:text-gray-400">{item.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => void toggle(item.key)}
              className={`w-9 h-5 rounded-full transition-colors relative ${prefs[item.key] ? 'bg-blue-600' : 'bg-gray-600'}`}
              aria-label={item.label}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${prefs[item.key] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
      </EnterpriseCard>

      <EnterpriseCard title="Owner Backup" icon={<ShieldCheck size={16} />}>
        <p className="text-2xs text-slate-600 dark:text-gray-400 mb-3">
          Download the original (untracked) copy of a vault file. Personal backup only — not for sharing.
        </p>
        {vaultLoading ? (
          <div className="flex justify-center py-6">
            <RefreshCw size={16} className="animate-spin text-slate-500 dark:text-gray-400" />
          </div>
        ) : vaultFiles.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gray-400 text-center py-4">No vault files yet.</p>
        ) : (
          <ul className="space-y-2 max-h-[320px] overflow-y-auto">
            {vaultFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/10 dark:bg-[#1e2128]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{file.originalFileName}</p>
                  <p className="text-2xs text-slate-500 dark:text-gray-400 mono">
                    {formatBytes(file.originalSizeBytes)} · {format(new Date(file.createdAt), 'MMM d, yyyy')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadOwnerBackup(file)}
                  disabled={downloadingId === file.id}
                  className="btn-secondary btn-sm shrink-0 gap-1.5"
                >
                  {downloadingId === file.id ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  Backup
                </button>
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </div>
  );
}

// ── Billing Tab ────────────────────────────────────────────────────────────────

function BillingTab() {
  const { subscription } = useSubscription();
  const [billing, setBilling] = useState<{
    planName?: string;
    planCode?: string;
    status?: string;
    currentPeriodStart?: string | null;
    organizationName?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.get(`${API_BASE_URL}/organization/billing`);
        setBilling((r.data as { billing?: typeof billing }).billing ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Prefer effective subscription (same as header/sidebar) so admin bypass and billing stay aligned
  const planName = subscription?.planName ?? billing?.planName ?? 'Free';
  const status = billing?.status ?? subscription?.status ?? 'ACTIVE';

  return (
    <div className="space-y-4">
      <EnterpriseCard title="Billing summary" icon={<Receipt size={16} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EnterpriseField label="Organization" value={billing?.organizationName ?? '—'} disabled />
          <EnterpriseField label="Plan" value={planName} disabled />
          <EnterpriseField label="Status" value={status} disabled />
          <EnterpriseField
            label="Current period start"
            value={billing?.currentPeriodStart ? format(new Date(billing.currentPeriodStart), 'MMM d, yyyy') : '—'}
            disabled
          />
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <Link to="/subscription" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-semibold">
            <ArrowUpRight size={14} /> Full billing portal
          </Link>
          <Link to="/upgrade" className="px-4 py-2 rounded-xl border border-bg-border text-sm text-gray-300 hover:text-white">
            Change plan
          </Link>
        </div>
      </EnterpriseCard>
    </div>
  );
}

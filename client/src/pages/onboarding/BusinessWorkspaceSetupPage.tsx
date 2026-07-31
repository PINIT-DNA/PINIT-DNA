import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Briefcase, Users, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';
import { markBusinessSetupComplete } from '../../lib/account-onboarding';
import { BUSINESS_DASHBOARD_PATH } from '../../lib/subscription/post-upgrade-redirect';
import {
  ORGANIZATION_INDUSTRIES,
  ORGANIZATION_INDUSTRY_LABELS,
  ORGANIZATION_SIZE_LABELS,
  ORGANIZATION_SIZES,
  WORKSPACE_NAME_SUGGESTIONS,
  type OrganizationIndustry,
  type OrganizationSize,
} from '../../lib/organization-profile';

type Step = 1 | 2 | 3 | 4;

const STEP_META: Record<Step, { title: string; subtitle: string; icon: typeof Building2 }> = {
  1: {
    title: 'Organization name',
    subtitle: 'This is your company or team identity on PINITHub.',
    icon: Building2,
  },
  2: {
    title: 'Industry',
    subtitle: 'Helps us tailor your workspace experience.',
    icon: Briefcase,
  },
  3: {
    title: 'Organization size',
    subtitle: 'How many people are in your organization today?',
    icon: Users,
  },
  4: {
    title: 'Workspace name',
    subtitle: 'Your first shared workspace — you can add more when you upgrade.',
    icon: Layers,
  },
};

export function BusinessWorkspaceSetupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);

  const [organizationName, setOrganizationName] = useState('');
  const [industry, setIndustry] = useState<OrganizationIndustry>('TECHNOLOGY');
  const [organizationSize, setOrganizationSize] = useState<OrganizationSize>('SOLO');
  const [workspaceName, setWorkspaceName] = useState('Main Workspace');

  const meta = STEP_META[step];
  const StepIcon = meta.icon;

  function canAdvance(): boolean {
    if (step === 1) return organizationName.trim().length >= 2;
    if (step === 4) return workspaceName.trim().length >= 2;
    return true;
  }

  async function finishSetup() {
    if (!user?.sub || !canAdvance()) return;
    setBusy(true);
    try {
      await api.post(`${API_BASE_URL}/auth/business-setup`, {
        organizationName: organizationName.trim(),
        industry,
        organizationSize,
        workspaceName: workspaceName.trim(),
      });
      markBusinessSetupComplete(user.sub);
      toast.success('Organization workspace created');
      navigate(BUSINESS_DASHBOARD_PATH, { replace: true });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error as string | undefined;
      toast.error(msg ?? 'Could not create organization');
    } finally {
      setBusy(false);
    }
  }

  function handleNext() {
    if (!canAdvance()) return;
    if (step < 4) {
      setStep((step + 1) as Step);
      return;
    }
    void finishSetup();
  }

  function handleBack() {
    if (step > 1) setStep((step - 1) as Step);
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 space-y-8 pb-16">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-2xs text-gray-500 uppercase tracking-wider">
          <span>Business setup</span>
          <span>Step {step} of 4</span>
        </div>
        <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
          <div
            className="h-full bg-purple-500 transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
      </div>

      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/25 mb-2">
          <StepIcon size={22} className="text-purple-400" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{meta.title}</h1>
        <p className="text-sm text-gray-400 max-w-md mx-auto">{meta.subtitle}</p>
      </div>

      <div className="rounded-2xl border border-bg-border bg-bg-card p-5 sm:p-6 space-y-4">
        {step === 1 && (
          <>
            <label className="text-xs text-gray-400 block">Organization name</label>
            <input
              type="text"
              autoFocus
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="ABC Media Pvt Ltd"
              className="w-full rounded-xl border border-bg-border bg-bg-elevated px-4 py-3 text-sm text-white placeholder:text-gray-600"
            />
            <p className="text-2xs text-gray-500">A business account creates an organization — not just a personal profile.</p>
          </>
        )}

        {step === 2 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ORGANIZATION_INDUSTRIES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setIndustry(value)}
                className={`rounded-xl border px-3 py-2.5 text-sm transition-all ${
                  industry === value
                    ? 'border-purple-500/50 bg-purple-500/10 text-white ring-1 ring-purple-500/30'
                    : 'border-bg-border bg-bg-elevated text-gray-300 hover:border-purple-500/25'
                }`}
              >
                {ORGANIZATION_INDUSTRY_LABELS[value]}
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ORGANIZATION_SIZES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setOrganizationSize(value)}
                className={`rounded-xl border px-3 py-2.5 text-sm transition-all ${
                  organizationSize === value
                    ? 'border-purple-500/50 bg-purple-500/10 text-white ring-1 ring-purple-500/30'
                    : 'border-bg-border bg-bg-elevated text-gray-300 hover:border-purple-500/25'
                }`}
              >
                {ORGANIZATION_SIZE_LABELS[value]}
              </button>
            ))}
          </div>
        )}

        {step === 4 && (
          <>
            <label className="text-xs text-gray-400 block">Workspace name</label>
            <input
              type="text"
              autoFocus
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Main Workspace"
              className="w-full rounded-xl border border-bg-border bg-bg-elevated px-4 py-3 text-sm text-white placeholder:text-gray-600"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {WORKSPACE_NAME_SUGGESTIONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setWorkspaceName(name)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                    workspaceName === name
                      ? 'border-dna-500/40 bg-dna-500/10 text-dna-300'
                      : 'border-bg-border text-gray-400 hover:border-dna-500/25'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className="text-2xs text-gray-500">
              Free plan includes 1 workspace and 1 team member (you as owner). Upgrade later to invite members and add departments.
            </p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1 || busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-bg-border text-sm text-gray-400 hover:text-white disabled:opacity-40"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button
          type="button"
          disabled={busy || !canAdvance()}
          onClick={() => void handleNext()}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-sm font-semibold"
        >
          {step === 4 ? (busy ? 'Creating…' : 'Create organization') : 'Continue'}
          {step < 4 && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}

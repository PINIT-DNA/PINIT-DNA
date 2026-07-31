import { useState } from 'react';
import { X, ArrowLeft, ArrowRight, Layers, Image, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ORGANIZATION_INDUSTRIES,
  ORGANIZATION_INDUSTRY_LABELS,
  type OrganizationIndustry,
} from '../../lib/organization-profile';
import type { OrganizationView } from '../../hooks/useOrganization';

type Step = 1 | 2 | 3 | 4;

interface BusinessSetupWizardProps {
  open: boolean;
  organization: OrganizationView | null;
  onClose: () => void;
  onComplete: (payload: {
    organizationName: string;
    industry?: OrganizationIndustry;
    country?: string;
    workspaceName?: string;
    logoUrl?: string | null;
  }) => Promise<void>;
}

const STEP_META: Record<Step, { title: string; subtitle: string }> = {
  1: { title: 'Organization Information', subtitle: 'Only organization name is required.' },
  2: { title: 'Workspace', subtitle: 'Your first workspace on Business Free.' },
  3: { title: 'Organization Logo', subtitle: 'Optional — you can add this later.' },
  4: { title: 'Finish', subtitle: 'Review and create your organization profile.' },
};

export function BusinessSetupWizard({
  open,
  organization,
  onClose,
  onComplete,
}: BusinessSetupWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [organizationName, setOrganizationName] = useState(organization?.name ?? '');
  const [industry, setIndustry] = useState<OrganizationIndustry>(
    organization?.industry ?? 'TECHNOLOGY',
  );
  const [country, setCountry] = useState(organization?.country ?? '');
  const [workspaceName, setWorkspaceName] = useState(
    organization?.defaultWorkspace?.name ?? 'Main Workspace',
  );
  const [logoPreview, setLogoPreview] = useState<string | null>(organization?.logoUrl ?? null);

  if (!open) return null;

  function canAdvance(): boolean {
    if (step === 1) return organizationName.trim().length >= 2;
    if (step === 2) return workspaceName.trim().length >= 2;
    return true;
  }

  async function handleFinish() {
    if (organizationName.trim().length < 2) {
      toast.error('Organization name is required');
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      await onComplete({
        organizationName: organizationName.trim(),
        industry,
        country: country.trim() || undefined,
        workspaceName: workspaceName.trim() || 'Main Workspace',
        logoUrl: logoPreview,
      });
      toast.success('Organization setup complete');
      onClose();
    } catch {
      toast.error('Could not save organization setup');
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
    void handleFinish();
  }

  function handleLogoFile(file: File | null) {
    if (!file) {
      setLogoPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  const meta = STEP_META[step];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-bg-border bg-bg-card shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-bg-border bg-bg-card">
          <div>
            <p className="text-2xs text-gray-500 uppercase tracking-wider">Organization setup · Step {step} of 4</p>
            <h2 className="text-lg font-bold text-white">{meta.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-bg-elevated">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-400">{meta.subtitle}</p>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Organization name *</label>
                <input
                  type="text"
                  autoFocus
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="ABC Media Pvt Ltd"
                  className="w-full rounded-xl border border-bg-border bg-bg-elevated px-4 py-3 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Industry</label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value as OrganizationIndustry)}
                  className="w-full rounded-xl border border-bg-border bg-bg-elevated px-4 py-3 text-sm text-white"
                >
                  {ORGANIZATION_INDUSTRIES.map((value) => (
                    <option key={value} value={value}>{ORGANIZATION_INDUSTRY_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Country</label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="India"
                  className="w-full rounded-xl border border-bg-border bg-bg-elevated px-4 py-3 text-sm text-white"
                />
              </div>
              <div className="rounded-xl border border-bg-border bg-bg-elevated/60 px-4 py-3">
                <p className="text-2xs text-gray-500 uppercase tracking-wider mb-1">Organization PINIT ID</p>
                <p className="text-sm font-mono text-dna-300">{organization?.shortId ?? '—'}</p>
                <p className="text-2xs text-gray-500 mt-1">Generated automatically — cannot be changed.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-purple-300 text-sm">
                <Layers size={16} />
                Create your first workspace
              </div>
              <label className="text-xs text-gray-400 block">Workspace name</label>
              <input
                type="text"
                autoFocus
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="w-full rounded-xl border border-bg-border bg-bg-elevated px-4 py-3 text-sm text-white"
              />
              <p className="text-2xs text-gray-500">Business Free includes one workspace. Upgrade later for more.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-20 h-20 rounded-2xl border border-bg-border bg-bg-elevated flex items-center justify-center overflow-hidden">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" className="w-full h-full object-cover" />
                ) : (
                  <Image size={28} className="text-gray-500" />
                )}
              </div>
              <label className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-bg-border text-sm text-gray-300 hover:bg-bg-elevated cursor-pointer">
                Upload logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={() => setLogoPreview(null)}
                className="block mx-auto text-xs text-gray-500 hover:text-gray-300"
              >
                Skip logo
              </button>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 rounded-xl border border-purple-500/25 bg-purple-500/5 p-4">
              <div className="flex items-center gap-2 text-purple-300 text-sm font-medium">
                <CheckCircle2 size={16} />
                Ready to create
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Organization</dt>
                  <dd className="text-white text-right">{organizationName || '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">PINIT ID</dt>
                  <dd className="text-dna-300 font-mono text-right">{organization?.shortId}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Workspace</dt>
                  <dd className="text-white text-right">{workspaceName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Industry</dt>
                  <dd className="text-white text-right">{ORGANIZATION_INDUSTRY_LABELS[industry]}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 px-5 py-4 border-t border-bg-border bg-bg-card">
          <button
            type="button"
            disabled={step === 1 || busy}
            onClick={() => setStep((step - 1) as Step)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-bg-border text-sm text-gray-400 disabled:opacity-40"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <button
            type="button"
            disabled={busy || !canAdvance()}
            onClick={() => void handleNext()}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-sm font-semibold"
          >
            {step === 4 ? (busy ? 'Creating…' : 'Finish') : 'Continue'}
            {step < 4 && <ArrowRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

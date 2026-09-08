import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Modal } from '../ui/Modal';
import {
  KIND_LABEL,
  humanVerificationFromVault,
  humanVerificationLabel,
  type RegistryCredential,
} from '../../lib/credential-registry';
import { createFileShare, getVaultContentAnalysis } from '../../services/dashboard.api';
import { exportCertificatePDF } from '../../services/report-generator';
import { useAuth } from '../../context/AuthContext';

function formatIssued(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

function safeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? format(new Date(t), 'd MMM yyyy HH:mm') : raw;
}

export function CredentialDetailsModal({
  item,
  onClose,
  onPreview,
  onHumanUpdate,
}: {
  item: RegistryCredential;
  onClose: () => void;
  onPreview: () => void;
  onHumanUpdate: (next: RegistryCredential) => void;
}) {
  const { user } = useAuth();
  const [techOpen, setTechOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const vault = item.vault;
  const cert = item.certificate;
  const issued = formatIssued(item.issuedAt);
  const humanOk = item.human.state === 'verified' && item.human.percent >= 90;
  const fingerprinted = Boolean(vault?.dnaRecordId);
  const recorded = Boolean(cert?.certificateId);

  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    getVaultContentAnalysis(vault.id)
      .then((data) => {
        if (cancelled || data.status !== 'COMPLETED' || !data.contentAnalysis) return;
        const human = humanVerificationFromVault(vault, data.contentAnalysis);
        onHumanUpdate({ ...item, human });
      })
      .catch(() => { /* keep list state */ });
    return () => { cancelled = true; };
  }, [vault?.id]);

  const copyLink = async () => {
    if (!cert) { toast.error('No public credential URL until a Pinit certificate is issued'); return; }
    const url = `${window.location.origin}/verify-certificate?id=${encodeURIComponent(cert.certificateId)}`;
    await navigator.clipboard.writeText(url);
    toast.success('Verification link copied');
  };

  const share = async () => {
    if (!vault) { toast.error('Share requires a protected document in HUB'); return; }
    setSharing(true);
    try {
      const result = await createFileShare(vault.id);
      await navigator.clipboard.writeText(result.shareUrl);
      toast.success(result.reused ? 'Existing share link copied' : 'Share link copied');
    } catch {
      toast.error('Could not create a share link');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal open title="Verification details" onClose={onClose} size="lg">
      <div className="space-y-5 pb-1">
        <ul className="rounded-lg border border-[#252C38] bg-[#0C1018] divide-y divide-[#252C38] text-sm">
          {humanOk && <li className="px-3 py-2 text-[#32D583]">✓ Human verified</li>}
          {item.human.state === 'verified' && !humanOk && (
            <li className="px-3 py-2 text-[#F5F7FA]">✓ Human signal {item.human.percent}%</li>
          )}
          {item.protectedInHub && <li className="px-3 py-2 text-[#32D583]">✓ Protected in Pinit HUB</li>}
          {fingerprinted && <li className="px-3 py-2 text-[#32D583]">✓ Fingerprinted</li>}
          {recorded && <li className="px-3 py-2 text-[#32D583]">✓ Credential recorded</li>}
        </ul>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Verified by</dt>
            <dd className="text-[#F5F7FA] mt-0.5">{item.protectedInHub || recorded ? 'Pinit HUB' : 'Issuer record'}</dd>
          </div>
          {item.issuer && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Issuer</dt>
              <dd className="text-[#F5F7FA] mt-0.5">{item.issuer}</dd>
            </div>
          )}
          {issued && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Issue date</dt>
              <dd className="text-[#F5F7FA] mt-0.5">{issued}</dd>
            </div>
          )}
          {cert?.certificateId && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Credential ID</dt>
              <dd className="text-[#F5F7FA] mt-0.5 font-mono text-xs break-all">{cert.certificateId}</dd>
            </div>
          )}
          {item.human.state === 'verified' && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Human signal</dt>
              <dd className="text-[#F5F7FA] mt-0.5">{item.human.percent}%</dd>
            </div>
          )}
          {item.human.state === 'assessed' && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Human signal</dt>
              <dd className="text-[#F5F7FA] mt-0.5">{humanVerificationLabel(item.human)}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Protection</dt>
            <dd className="text-[#F5F7FA] mt-0.5">{item.protectedInHub ? 'Protected' : 'Not protected in HUB'}</dd>
          </div>
          {item.recipientName && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Recipient</dt>
              <dd className="text-[#F5F7FA] mt-0.5">{item.recipientName}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Category</dt>
            <dd className="text-[#F5F7FA] mt-0.5">{KIND_LABEL[item.kind]}</dd>
          </div>
        </dl>

        {(vault || recorded) && (
          <div className="text-sm space-y-1 text-[#9AA6B8]">
            {vault && <p>Protection record · evidence on file in Pinit HUB</p>}
            {fingerprinted && <p>Fingerprint · DNA record attached</p>}
            {recorded && <p>Credential history · issued {issued || 'date not recorded'}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={onPreview}>
            Preview certificate
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyLink}>
            Copy verification page link
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={share} disabled={sharing || !vault}>
            Share credential
          </button>
          {vault && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportCertificatePDF(vault, user ?? undefined, {
                    certificateId: cert?.certificateId,
                    title: item.title,
                    issuer: item.issuer,
                    humanLabel: humanVerificationLabel(item.human),
                    protectedInHub: item.protectedInHub,
                    recipient: item.recipientName,
                  });
                  toast.success('Certificate PDF downloaded');
                } catch {
                  toast.error('PDF generation failed');
                } finally {
                  setExporting(false);
                }
              }}
            >
              Download certificate
            </button>
          )}
        </div>

        <div className="border-t border-[#252C38] pt-2">
          <button
            type="button"
            className="flex items-center gap-2 text-sm text-[#9AA6B8] hover:text-white"
            onClick={() => setTechOpen((v) => !v)}
            aria-expanded={techOpen}
          >
            <ChevronDown size={14} className={techOpen ? 'rotate-180' : ''} />
            View technical details
          </button>
          {techOpen && (
            <dl className="mt-3 space-y-2 text-xs text-[#9AA6B8] font-mono">
              {cert?.certificateId && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Pinit Credential ID</dt><dd className="break-all text-[#F5F7FA]">{cert.certificateId}</dd></div>
              )}
              {vault && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Vault ID</dt><dd className="break-all text-[#F5F7FA]">{vault.id}</dd></div>
              )}
              {vault && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Asset / DNA ID</dt><dd className="break-all text-[#F5F7FA]">{vault.dnaRecordId}</dd></div>
              )}
              {safeDate(vault?.createdAt) && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Protection date</dt><dd className="text-[#F5F7FA]">{safeDate(vault?.createdAt)}</dd></div>
              )}
              {safeDate(cert?.issuedAt) && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Verification timestamp</dt><dd className="text-[#F5F7FA]">{safeDate(cert?.issuedAt)}</dd></div>
              )}
              {vault && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Evidence reference</dt><dd className="break-all text-[#F5F7FA]">{vault.originalFileName}</dd></div>
              )}
              {cert?.signature && (
                <div className="flex gap-3"><dt className="w-40 shrink-0">Record signature</dt><dd className="break-all text-[#F5F7FA]">{cert.signature.slice(0, 24)}…</dd></div>
              )}
            </dl>
          )}
        </div>
      </div>
    </Modal>
  );
}

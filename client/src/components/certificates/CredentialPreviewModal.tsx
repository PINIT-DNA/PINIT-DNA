import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Modal } from '../ui/Modal';
import { PinitCredentialDocument } from './PinitCredentialDocument';
import { CredentialDocumentPreview } from './CredentialDocumentPreview';
import {
  KIND_LABEL,
  compactCredentialId,
  humanVerificationLabel,
  type RegistryCredential,
} from '../../lib/credential-registry';
import { isImageMime, isPdfMime } from '../../lib/file-type-utils';
import { exportCertificatePDF } from '../../services/report-generator';
import { useAuth } from '../../context/AuthContext';

function formatIssued(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

export function CredentialPreviewModal({
  item,
  onClose,
  onViewDetails,
  onPrev,
  onNext,
}: {
  item: RegistryCredential;
  onClose: () => void;
  onViewDetails: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const vault = item.vault;
  const showOriginal = Boolean(
    vault && (isImageMime(vault.originalMimeType, vault.originalFileName) || isPdfMime(vault.originalMimeType, vault.originalFileName)),
  );
  const issued = formatIssued(item.issuedAt);
  const credId = compactCredentialId(item.certificate?.certificateId) || item.certificate?.certificateId || null;

  return (
    <Modal open title="Certificate Preview" onClose={onClose} size="xl">
      <div className="space-y-5 pb-2">
        <div className="relative">
          {onPrev && (
            <button
              type="button"
              className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 btn btn-secondary btn-sm rounded-full w-9 h-9 p-0"
              onClick={onPrev}
              aria-label="Previous certificate"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          {onNext && (
            <button
              type="button"
              className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 btn btn-secondary btn-sm rounded-full w-9 h-9 p-0"
              onClick={onNext}
              aria-label="Next certificate"
            >
              <ChevronRight size={16} />
            </button>
          )}
          {showOriginal && vault ? (
            <CredentialDocumentPreview
              vaultId={vault.id}
              fileName={vault.originalFileName}
              mimeType={vault.originalMimeType}
            />
          ) : (
            <PinitCredentialDocument item={item} className="rounded-xl border border-[#D8D4CC] shadow-sm" />
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Title</p>
            <p className="text-[#F5F7FA] mt-0.5">{item.title}</p>
          </div>
          {item.recipientName && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Recipient</p>
              <p className="text-[#F5F7FA] mt-0.5">{item.recipientName}</p>
            </div>
          )}
          {item.issuer ? (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Issuer</p>
              <p className="text-[#F5F7FA] mt-0.5">{item.issuer}</p>
            </div>
          ) : null}
          {issued && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Issue date</p>
              <p className="text-[#F5F7FA] mt-0.5">{issued}</p>
            </div>
          )}
          {credId && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Credential ID</p>
              <p className="text-[#F5F7FA] mt-0.5 font-mono text-xs break-all">{credId}</p>
            </div>
          )}
          <p className="text-[11px] text-[#9AA6B8] sm:col-span-2">{KIND_LABEL[item.kind]}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onViewDetails}>
            Open verification
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
                    certificateId: item.certificate?.certificateId,
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
              {exporting ? 'Downloading…' : 'Download certificate'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { format } from 'date-fns';
import { Modal } from '../ui/Modal';
import { PinitCredentialDocument } from './PinitCredentialDocument';
import type { HubCredential } from '../../services/dashboard.api';

function formatIssued(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

export function CredentialPreviewModal({
  item,
  recipientName,
  recipientPinitId,
  onClose,
  onViewDetails,
}: {
  item: HubCredential;
  recipientName?: string | null;
  recipientPinitId?: string | null;
  onClose: () => void;
  onViewDetails: () => void;
}) {
  const issued = formatIssued(item.issuedAt);

  return (
    <Modal open title="Certificate Preview" onClose={onClose} size="2xl">
      <div className="space-y-5 pb-2">
        <div className="overflow-x-auto -mx-1 px-1">
        <PinitCredentialDocument
          title={item.title}
          issuer={item.issuer}
          issuedLabel={issued}
          recipientName={recipientName || item.recipientName}
          recipientPinitId={recipientPinitId}
          certificateId={item.source.id}
          trustLabel="Pinit Verified"
        />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={onViewDetails}>
            View verification
          </button>
        </div>
      </div>
    </Modal>
  );
}

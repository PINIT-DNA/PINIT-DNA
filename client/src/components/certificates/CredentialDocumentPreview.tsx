import { useEffect, useState } from 'react';
import { previewVaultFile } from '../../services/dashboard.api';
import { isDocxMime, isImageMime, isPdfMime } from '../../lib/file-type-utils';

export function CredentialDocumentPreview({
  vaultId,
  fileName,
  mimeType,
}: {
  vaultId: string;
  fileName: string;
  mimeType: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    previewVaultFile(vaultId, { thumb: false })
      .then((data) => {
        if (revoked) return;
        const typed = new Blob([data], { type: data.type || mimeType });
        objectUrl = URL.createObjectURL(typed);
        setBlob(typed);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!revoked) setError('Document preview is unavailable.');
      })
      .finally(() => {
        if (!revoked) setLoading(false);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vaultId, mimeType]);

  if (loading) {
    return <div className="h-[min(62vh,560px)] animate-pulse rounded-lg bg-bg-elevated border border-bg-border" />;
  }
  if (error || !url) {
    return (
      <div className="h-40 rounded-lg bg-bg-elevated border border-bg-border flex items-center justify-center text-sm text-gray-400">
        {error || 'Preview unavailable'}
      </div>
    );
  }

  if (isImageMime(blob?.type || mimeType, fileName)) {
    return (
      <img
        src={url}
        alt={`${fileName} certificate document`}
        className="w-full max-h-[min(62vh,640px)] object-contain rounded-lg bg-[#F5F3EE]"
      />
    );
  }

  if (isPdfMime(blob?.type || mimeType, fileName)) {
    return (
      <iframe
        src={`${url}#toolbar=0&navpanes=0`}
        title={`${fileName} PDF preview`}
        className="w-full h-[min(62vh,640px)] rounded-lg border border-bg-border bg-white"
      />
    );
  }

  if (isDocxMime(blob?.type || mimeType, fileName)) {
    return (
      <p className="text-sm text-gray-400 py-8 text-center">
        This credential is a Word document. Use download from credential details to open the original file.
      </p>
    );
  }

  return (
    <p className="text-sm text-gray-400 py-8 text-center">
      This file type does not have an on-page preview. The Pinit certificate is shown below.
    </p>
  );
}

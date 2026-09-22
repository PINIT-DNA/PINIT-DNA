import { useEffect, useState } from 'react';
import { Microscope } from 'lucide-react';
import { fetchInvestigationProbeThumbnail } from '../services/dashboard.api';
import { cn } from './ui/utils';

/**
 * The uploaded/examined file's own thumbnail for one investigation — the durable,
 * server-persisted preview (see investigation-probe-thumbnail.service.ts), not the
 * matched vault original. That distinction is the point: a candidate/weak/no match
 * still has an uploaded file to show, so this never depends on a vault match existing
 * or its preview loading — unlike VaultFileThumbnail, which both list rows used to show
 * a broken "Retry" state for whenever the vault side failed or had nothing to match.
 */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

async function loadThumb(investigationId: string): Promise<string | null> {
  const cached = cache.get(investigationId);
  if (cached) return cached;
  const pending = inflight.get(investigationId);
  if (pending) return pending;
  const promise = fetchInvestigationProbeThumbnail(investigationId)
    .then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      cache.set(investigationId, url);
      return url;
    })
    .finally(() => inflight.delete(investigationId));
  inflight.set(investigationId, promise);
  return promise;
}

interface InvestigationProbeThumbnailProps {
  investigationId: string;
  className?: string;
}

export function InvestigationProbeThumbnail({ investigationId, className }: InvestigationProbeThumbnailProps) {
  const [url, setUrl] = useState<string | null>(() => cache.get(investigationId) ?? null);
  const [failed, setFailed] = useState(false);
  const frameClass = className ?? 'w-11 h-11 rounded-lg shrink-0';

  useEffect(() => {
    setUrl(cache.get(investigationId) ?? null);
    setFailed(false);
  }, [investigationId]);

  useEffect(() => {
    if (url || failed) return;
    let cancelled = false;
    loadThumb(investigationId).then((u) => {
      if (cancelled) return;
      if (u) setUrl(u); else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [investigationId, url, failed]);

  if (url) {
    return (
      <div className={cn(frameClass, 'overflow-hidden border border-bg-border bg-black/20')} title="Examined file">
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  // No thumbnail was saved for this investigation — either it predates this feature,
  // or the examined file was a type with no visual preview (PDF, document, audio).
  return (
    <div className={cn(frameClass, 'bg-bg-elevated border border-bg-border flex items-center justify-center')}>
      <Microscope size={16} className="text-gray-500" />
    </div>
  );
}

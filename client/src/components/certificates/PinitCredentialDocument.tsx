import { KIND_LABEL, humanVerificationLabel, issuerDisplay, type RegistryCredential } from '../../lib/credential-registry';
import { format } from 'date-fns';

function formatIssued(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

export function PinitCredentialDocument({
  item,
  className = '',
}: {
  item: RegistryCredential;
  className?: string;
}) {
  const issued = formatIssued(item.issuedAt);
  const certId = item.certificate?.certificateId;
  const showProtected = item.protectedInHub;
  const human = item.human;

  return (
    <article
      className={`relative overflow-hidden text-left ${className}`}
      style={{
        background: '#F5F3EE',
        color: '#111318',
        fontFamily: "Inter, system-ui, sans-serif",
      }}
      aria-label={`${KIND_LABEL[item.kind]} document for ${item.title}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: '#35D6A2' }} />
      <div className="px-8 sm:px-10 py-8 sm:py-10">
        <div className="flex items-start justify-between gap-4 mb-10">
          <div>
            <p className="text-[10px] tracking-[0.28em] uppercase" style={{ color: '#626875' }}>Pinit HUB</p>
            <p className="text-[10px] tracking-[0.18em] uppercase mt-1" style={{ color: '#626875' }}>
              {KIND_LABEL[item.kind]}
            </p>
          </div>
          {human.state !== 'not_assessed' && (
            <div
              className="shrink-0 border px-3 py-2 text-right"
              style={{ borderColor: '#111318', minWidth: 118 }}
            >
              <p className="text-[9px] tracking-[0.2em] uppercase" style={{ color: '#626875' }}>Pinit</p>
              <p className="text-[10px] font-semibold tracking-[0.08em] uppercase mt-0.5">
                {human.state === 'verified' ? 'Human verified' : 'Human assessed'}
              </p>
              {human.state === 'verified' && (
                <p className="text-sm font-semibold mt-0.5" style={{ color: '#2F6BFF' }}>{human.percent}%</p>
              )}
            </div>
          )}
        </div>

        <h1
          className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight mb-6"
          style={{ letterSpacing: '-0.03em' }}
        >
          {item.title}
        </h1>

        {item.recipientName && (
          <p className="text-sm mb-6" style={{ color: '#626875' }}>
            Awarded to <span className="font-medium" style={{ color: '#111318' }}>{item.recipientName}</span>
          </p>
        )}

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[10px] tracking-[0.16em] uppercase" style={{ color: '#626875' }}>Issued by</dt>
            <dd className="mt-0.5 font-medium">{issuerDisplay(item)}</dd>
          </div>
          {issued && (
            <div>
              <dt className="text-[10px] tracking-[0.16em] uppercase" style={{ color: '#626875' }}>Issued</dt>
              <dd className="mt-0.5">{issued}</dd>
            </div>
          )}
        </dl>

        <div className="mt-10 pt-6 flex flex-wrap items-end justify-between gap-4" style={{ borderTop: '1px solid #D8D4CC' }}>
          <div className="space-y-1">
            <p className="text-[11px]" style={{ color: '#626875' }}>{humanVerificationLabel(human)}</p>
            {showProtected && (
              <p className="text-[11px] font-medium" style={{ color: '#111318' }}>
                Protected &amp; recorded in Pinit HUB
              </p>
            )}
            {certId && (
              <p className="text-[10px] font-mono mt-2" style={{ color: '#626875' }}>{certId}</p>
            )}
          </div>
          <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#35D6A2' }}>
            <span className="text-[10px] font-bold text-[#111318]" aria-hidden>P</span>
          </div>
        </div>
      </div>
    </article>
  );
}

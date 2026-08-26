/**
 * Campaign → Rights.
 *
 * Answers one question per asset: what may the client actually do with this,
 * and what proves it. Three sources are kept visibly distinct rather than
 * merged into a single "status", because they have different authorities:
 *
 *   Protection — Pinit. DNA, vault, certificate.
 *   Licence    — Exchange, read-only. Never edited from here.
 *   Access     — Pinit. Who currently reaches the file.
 *
 * Where no licence exists the panel says so plainly. A default like "standard
 * terms" would be worse than an empty state, because someone would repeat it
 * to a client.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ScrollText, ShieldCheck, ShieldAlert, Award, Globe, AlertTriangle, RefreshCw,
  Users, Info, ExternalLink,
} from 'lucide-react';
import { listCampaignRights } from '../../../services/business.api';
import type { CampaignRights, AssetRights } from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { ReviewStatusBadge } from './ReviewPrimitives';
import type { ReviewStatus } from '../../../services/business.api';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const LICENCE_STATE: Record<string, { label: string; cls: string }> = {
  licensed: { label: 'Licensed',   cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  listed:   { label: 'Listed',     cls: 'text-dna-400 bg-dna-500/10 border-dna-500/25' },
  none:     { label: 'No licence', cls: 'text-gray-400 bg-bg-elevated border-bg-border' },
};

export function RightsPanel({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<CampaignRights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listCampaignRights(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load rights');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <SkeletonRows rows={4} />;

  if (error) {
    return (
      <SectionCard title="Rights" icon={ScrollText}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load rights</p>
          <p className="text-xs text-gray-400 mb-3">{error}</p>
          <button type="button" onClick={load}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </SectionCard>
    );
  }

  if (!data || data.assets.length === 0) {
    return (
      <SectionCard title="Rights" icon={ScrollText}>
        <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
          <ScrollText size={20} className="text-gray-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-0.5">No assets in this campaign yet</p>
          <p className="text-xs text-gray-400">
            Protect an asset and its rights and protection record will appear here.
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-2xs text-gray-500 flex items-start gap-1.5 px-1">
        <Info size={11} className="shrink-0 mt-0.5" />
        Licence information comes from Exchange and is read-only here. Protection and access are
        Pinit records.
      </p>

      {data.assets.map((a) => <RightsCard key={a.assetId} asset={a} />)}
    </div>
  );
}

function RightsCard({ asset: a }: { asset: AssetRights }) {
  const lic = LICENCE_STATE[a.licence.state] ?? LICENCE_STATE.none;

  return (
    <SectionCard
      title={a.filename}
      icon={ScrollText}
      action={
        <span className={cn('text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap', lic.cls)}>
          {lic.label}
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* ── Protection ───────────────────────────────────────── */}
        <div className="rounded-lg border border-bg-border bg-bg-elevated/40 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-2
                        flex items-center gap-1.5">
            <ShieldCheck size={11} /> Protection
          </p>
          <dl className="space-y-1.5">
            <Row label="DNA record" value={a.protection.hasDna ? 'Present' : 'None'}
              good={a.protection.hasDna} />
            <Row label="Vault" value={a.protection.hasVault ? 'Stored' : 'Not stored'}
              good={a.protection.hasVault} />
            <Row
              label="Certificate"
              value={a.protection.certificateId
                ? `${a.protection.certificateStatus ?? 'Issued'}`
                : 'None issued'}
              good={Boolean(a.protection.certificateId)}
            />
            {a.protection.certificateId && (
              <p className="text-2xs text-gray-500 mono truncate pt-0.5"
                title={a.protection.certificateId}>
                {a.protection.certificateId}
              </p>
            )}
            {a.protection.certificateExpiresAt && (
              <Row label="Cert expires"
                value={new Date(a.protection.certificateExpiresAt).toLocaleDateString()} />
            )}
          </dl>
        </div>

        {/* ── Licence (Exchange) ───────────────────────────────── */}
        <div className="rounded-lg border border-bg-border bg-bg-elevated/40 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-2
                        flex items-center gap-1.5">
            <Award size={11} /> Licence
            <span className="ml-auto normal-case tracking-normal font-normal
                             text-gray-600 inline-flex items-center gap-1">
              <ExternalLink size={9} /> Exchange
            </span>
          </p>

          {a.licence.state === 'none' ? (
            <p className="text-2xs text-gray-500">
              No licence on record. This asset has not been listed or sold on Exchange, so no usage
              terms apply beyond your own agreement with the client.
            </p>
          ) : (
            <dl className="space-y-1.5">
              {a.licence.tier && <Row label="Type" value={a.licence.tier} />}
              <Row
                label="Commercial use"
                value={a.licence.commercialUse === null
                  ? 'Not specified'
                  : a.licence.commercialUse ? 'Permitted' : 'Not permitted'}
                good={a.licence.commercialUse === true}
                bad={a.licence.commercialUse === false}
              />
              <Row label="Expires" value={a.licence.expiresAt
                ? new Date(a.licence.expiresAt).toLocaleDateString()
                : a.licence.state === 'licensed' ? 'No expiry' : '—'} />
              {a.licence.licensedTo && <Row label="Licensed to" value={a.licence.licensedTo} mono />}
              {a.licence.downloadLimit !== null && (
                <Row label="Downloads"
                  value={`${a.licence.downloadCount ?? 0} of ${a.licence.downloadLimit}`} />
              )}
              {a.licence.termsVersion && <Row label="Terms" value={a.licence.termsVersion} />}
            </dl>
          )}

          {a.licence.permittedUse && (
            <p className="text-2xs text-gray-400 mt-2 pt-2 border-t border-bg-border/70">
              {a.licence.permittedUse}
            </p>
          )}

          {a.licence.restrictions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {a.licence.restrictions.map((r) => (
                <li key={r} className="text-2xs text-amber-400 flex items-start gap-1.5">
                  <ShieldAlert size={10} className="shrink-0 mt-0.5" /> {r}
                </li>
              ))}
            </ul>
          )}

          {/* Territory is not recorded by Exchange. Saying so beats implying
              worldwide rights the record cannot support. */}
          <p className="text-2xs text-gray-600 mt-2 flex items-start gap-1.5">
            <Globe size={10} className="shrink-0 mt-0.5" />
            Territory is not recorded on Exchange licences.
          </p>
        </div>

        {/* ── Ownership and access ─────────────────────────────── */}
        <div className="rounded-lg border border-bg-border bg-bg-elevated/40 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-2
                        flex items-center gap-1.5">
            <Users size={11} /> Owner &amp; access
          </p>
          <dl className="space-y-1.5">
            <Row label="Owner" value={a.owner.name ?? 'Unknown'} />
            {a.owner.pinitId && <Row label="Pinit ID" value={a.owner.pinitId} mono />}
            <Row label="Version"
              value={a.review.currentVersion ? `v${a.review.currentVersion}` : 'None'} />
          </dl>

          {a.review.reviewStatus && (
            <div className="mt-2">
              <ReviewStatusBadge status={a.review.reviewStatus as ReviewStatus} />
            </div>
          )}

          <div className="mt-2.5 pt-2 border-t border-bg-border/70">
            <p className="text-2xs text-gray-500 mb-1">Who can reach it</p>
            {a.access.length === 0 ? (
              <p className="text-2xs text-gray-500">Your team only.</p>
            ) : (
              <ul className="space-y-1">
                {a.access.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="text-2xs text-gray-400 truncate">
                    {p.name} · <span className="text-gray-500">{p.kind}</span>
                    {p.status !== 'ACTIVE' && (
                      <span className="text-gray-600"> · {p.status.toLowerCase()}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function Row({
  label, value, good, bad, mono,
}: {
  label: string; value: string; good?: boolean; bad?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-2xs text-gray-500 shrink-0">{label}</dt>
      <dd className={cn(
        'text-2xs font-medium truncate text-right',
        good ? 'text-emerald-400' : bad ? 'text-amber-400' : 'text-gray-300',
        mono && 'mono',
      )} title={value}>
        {value}
      </dd>
    </div>
  );
}

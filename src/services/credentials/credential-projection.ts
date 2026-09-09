/**
 * Pure mapping for Hub credential projections.
 * Certificate / Vault / Asset remain the sources of truth.
 */

export type CertLifecycle = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export function mapCertificateLifecycle(status: string): CertLifecycle {
  if (status === 'REVOKED') return 'REVOKED';
  if (status === 'EXPIRED') return 'EXPIRED';
  return 'ACTIVE';
}

export function titleFromProtectedFileName(filename: string | null | undefined): string | null {
  const raw = String(filename || '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return stripped || raw;
}

/** Prefer the live vault display name (what rename updates). Fall back to Asset. Never invent one. */
export function certificateDisplayTitle(params: {
  assetFileName?: string | null;
  vaultFileName?: string | null;
}): string {
  const fromVault = titleFromProtectedFileName(params.vaultFileName);
  if (fromVault) return fromVault;
  const fromAsset = titleFromProtectedFileName(params.assetFileName);
  if (fromAsset) return fromAsset;
  return 'Pinit Protected Asset Certificate';
}

export const PINIT_CERTIFICATE_ISSUER = 'Pinit';
export const PINIT_CERTIFICATE_TRUST = 'PINIT_VERIFIED' as const;

export type RelatedAssetDto = {
  id: string;
  title: string;
  /** Existing My Assets route: /vault?id=<VaultRecord.id> */
  href: string;
};

export type CredentialDto = {
  id: string;
  type: 'CERTIFICATE' | 'AWARD' | 'LICENSE' | 'COURSE' | 'WORKSHOP';
  title: string;
  issuer: string;
  recipientName: string | null;
  trustState: typeof PINIT_CERTIFICATE_TRUST | 'PINIT_ISSUED' | 'SELF_ADDED' | 'SELF_ADDED_EVIDENCE_PROTECTED' | 'COMING_SOON';
  lifecycleStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ARCHIVED';
  issuedAt: string | null;
  expiresAt: string | null;
  relatedAsset: RelatedAssetDto | null;
  source: {
    type: 'PINIT_CERTIFICATE';
    id: string;
  };
};

export function toCertificateCredentialDto(params: {
  credentialId: string;
  certificateId: string;
  status: string;
  issuedAt: Date | string | null;
  expiresAt: Date | string | null;
  recipientName: string | null;
  assetId: string | null;
  assetFileName: string | null;
  assetOwned: boolean;
  vaultFileName: string | null;
  vaultFocusId: string | null;
}): CredentialDto {
  const relatedAsset =
    params.assetId && params.assetOwned && params.vaultFocusId
      ? {
          id: params.assetId,
          title:
            titleFromProtectedFileName(params.vaultFileName) ||
            titleFromProtectedFileName(params.assetFileName) ||
            'Protected asset',
          href: `/vault?id=${encodeURIComponent(params.vaultFocusId)}`,
        }
      : null;

  return {
    id: params.credentialId,
    type: 'CERTIFICATE',
    title: certificateDisplayTitle({
      assetFileName: params.assetOwned ? params.assetFileName : null,
      vaultFileName: params.vaultFileName,
    }),
    issuer: PINIT_CERTIFICATE_ISSUER,
    recipientName: params.recipientName,
    trustState: PINIT_CERTIFICATE_TRUST,
    lifecycleStatus: mapCertificateLifecycle(params.status),
    issuedAt: params.issuedAt ? new Date(params.issuedAt).toISOString() : null,
    expiresAt: params.expiresAt ? new Date(params.expiresAt).toISOString() : null,
    relatedAsset,
    source: {
      type: 'PINIT_CERTIFICATE',
      id: params.certificateId,
    },
  };
}

export function dtoOmitsSecrets(dto: CredentialDto): boolean {
  const blob = JSON.stringify(dto);
  return !/dnaRecordId|vaultId|signature/i.test(blob);
}

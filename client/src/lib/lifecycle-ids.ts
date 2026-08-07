/**
 * Formal lifecycle ID display aliases.
 * Canonical storage stays UUID/token/tepCode — these are human-facing labels only.
 */

function shortSeg(id: string | null | undefined, len = 8): string {
  if (!id) return '--------';
  return id.replace(/-/g, '').slice(0, len).toUpperCase();
}

/** Track ID — primary is existing TEP code; fallback from vault id. */
export function formatTrackId(tepCode?: string | null, vaultId?: string | null): string {
  if (tepCode?.trim()) return tepCode.trim();
  if (vaultId) return `TRK-${shortSeg(vaultId, 10)}`;
  return 'TRK-PENDING';
}

/** Publish ID — from protected post / asset publish registration. */
export function formatPublishId(
  protectedPostId?: string | null,
  assetId?: string | null,
  clientRequestId?: string | null,
): string {
  const src = protectedPostId || assetId || clientRequestId;
  if (!src) return 'PUB-PENDING';
  return `PUB-${shortSeg(src, 10)}`;
}

/** Reshare / hop ID — child share links in the forward graph. */
export function formatReshareId(shareLinkId?: string | null, hopToken?: string | null): string {
  const src = shareLinkId || hopToken;
  if (!src) return 'RSH-PENDING';
  return `RSH-${shortSeg(src, 10)}`;
}

/** Vault ID display helper */
export function formatVaultId(vaultId?: string | null): string {
  if (!vaultId) return 'VAULT-PENDING';
  return vaultId;
}

/** Share ID display — prefer opaque token, else uuid */
export function formatShareId(token?: string | null, shareLinkId?: string | null): string {
  if (token?.trim()) return token.trim();
  if (shareLinkId) return `SHR-${shortSeg(shareLinkId, 10)}`;
  return 'SHR-PENDING';
}

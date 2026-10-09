export type PublicScanVerdict = 'protected' | 'possible' | 'not_found';

/** Visual similarity (0–1) at or above this can be "Protected" when a second check agrees, or when it is this high on its own. */
export const PROTECTED_VISUAL = 0.97;
/** Visual similarity (0–1) at or above this, and below a protected result, is "Possible". */
export const POSSIBLE_VISUAL = 0.9;

export interface PublicScanDraft {
  verdict: PublicScanVerdict;
  ownerName?: string;
  protectedAt?: string;
  title?: string | null;
  recipientLabel?: string | null;
  matchStrength?: number;
  anotherRegistration?: boolean;
  email?: string;
  ownerUserId?: string;
  dnaRecordId?: string;
  vaultId?: string;
  address?: string;
}

export interface PublicScanBody {
  success: true;
  verdict: PublicScanVerdict;
  message: string;
  ownerName?: string;
  protectedAt?: string;
  title?: string;
  recipientLabel?: string;
  matchStrength?: number;
  anotherRegistration?: true;
  detailsToken?: string;
}

const ALLOWED_KEYS = new Set([
  'success',
  'verdict',
  'message',
  'ownerName',
  'protectedAt',
  'title',
  'recipientLabel',
  'matchStrength',
  'anotherRegistration',
  'detailsToken',
]);

export function decidePublicScan(input: {
  markFound: boolean;
  visual: number;
  featureConfirmed: boolean;
}): PublicScanVerdict {
  if (input.markFound) return 'protected';
  if (input.visual >= PROTECTED_VISUAL) return 'protected';
  if (input.visual >= POSSIBLE_VISUAL && input.featureConfirmed) return 'protected';
  if (input.visual >= POSSIBLE_VISUAL) return 'possible';
  return 'not_found';
}

export function scanMessage(verdict: PublicScanVerdict, anotherRegistration: boolean): string {
  if (verdict === 'not_found') {
    return 'No matching protected asset found. This scan did not find a matching asset in PINIT’s available records. This does not mean the image is free to use, that it is unprotected everywhere, or that ownership is disproved.';
  }
  const lead = verdict === 'protected'
    ? 'Protected by PINIT. A match shows a relationship with a PINIT record. It does not by itself prove legal ownership.'
    : 'Possible match. This is not a confirmed result.';
  return anotherRegistration ? `${lead} Another registration of this asset exists.` : lead;
}

/** Drops every field that is not on the public card. */
export function toPublicScanBody(draft: PublicScanDraft): PublicScanBody {
  const another = draft.anotherRegistration === true && draft.verdict !== 'not_found';
  const body: PublicScanBody = {
    success: true,
    verdict: draft.verdict,
    message: scanMessage(draft.verdict, another),
  };
  if (draft.verdict !== 'not_found') {
    if (draft.ownerName) body.ownerName = draft.ownerName;
    if (draft.protectedAt) body.protectedAt = draft.protectedAt;
    if (typeof draft.matchStrength === 'number') body.matchStrength = Math.round(draft.matchStrength);
    if (draft.title) body.title = draft.title;
    if (draft.recipientLabel) body.recipientLabel = draft.recipientLabel;
    if (another) body.anotherRegistration = true;
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) delete (body as unknown as Record<string, unknown>)[key];
  }
  return body;
}

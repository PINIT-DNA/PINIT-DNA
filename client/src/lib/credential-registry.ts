import type { IssuedCertificate, VaultContentAnalysis, VaultRecord } from '../types/dashboard.types';

export type CredentialKind =
  | 'certificate'
  | 'award'
  | 'license'
  | 'course'
  | 'workshop'
  | 'recognition';

export type HumanVerification =
  | { state: 'verified'; percent: number }
  | { state: 'assessed' }
  | { state: 'not_assessed' };

export interface PortfolioCredentialHint {
  id: string;
  vaultId: string;
  title: string;
  issuer: string;
  kind: CredentialKind;
  issuedOn: string;
  description: string;
}

export interface RegistryCredential {
  id: string;
  kind: CredentialKind;
  title: string;
  issuer: string | null;
  issuedAt: string | null;
  vault: VaultRecord | null;
  certificate: IssuedCertificate | null;
  human: HumanVerification;
  protectedInHub: boolean;
  description: string;
  recipientName: string | null;
}

const KIND_FROM_SKILL: Record<string, CredentialKind> = {
  certificate: 'certificate',
  award: 'award',
  license: 'license',
  course: 'course',
  workshop: 'workshop',
  recognition: 'recognition',
};

export const KIND_LABEL: Record<CredentialKind, string> = {
  certificate: 'Certificate',
  award: 'Award',
  license: 'License',
  course: 'Course',
  workshop: 'Workshop',
  recognition: 'Recognition',
};

export function parseCredentialKind(raw: unknown): CredentialKind {
  const key = String(raw || '').toLowerCase().trim();
  return KIND_FROM_SKILL[key] ?? 'certificate';
}

export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename;
}

export function humanVerificationFromVault(
  vault: VaultRecord | null,
  analysis?: VaultContentAnalysis | null,
): HumanVerification {
  const snapshot = analysis ?? vault?.contentAnalysis ?? null;
  const manual = snapshot?.composition?.manualPercent;
  if (typeof manual === 'number' && Number.isFinite(manual)) {
    return { state: 'verified', percent: Math.round(manual) };
  }
  const label = String(snapshot?.label || vault?.contentLabel || '').trim().toUpperCase();
  if (label && label !== 'UNKNOWN' && label !== 'NOT_ANALYZED' && label !== 'PENDING') {
    return { state: 'assessed' };
  }
  return { state: 'not_assessed' };
}

export function humanVerificationLabel(human: HumanVerification): string {
  if (human.state === 'verified') return `Human verified · ${human.percent}%`;
  if (human.state === 'assessed') return 'Human assessed';
  return 'Not assessed';
}

export function parsePortfolioHints(raw: unknown): PortfolioCredentialHint[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const p = (root.portfolio && typeof root.portfolio === 'object'
    ? root.portfolio
    : root) as Record<string, unknown>;

  const hints: PortfolioCredentialHint[] = [];

  const certs = Array.isArray(p.certifications) ? p.certifications : [];
  for (const item of certs) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    hints.push({
      id: String(c.id || ''),
      vaultId: String(c.vault_id || c.documentKey || '').trim(),
      title: String(c.title || '').trim(),
      issuer: String(c.org || c.issuer || '').trim(),
      kind: parseCredentialKind(c.kind || c.relatedSkill),
      issuedOn: String(c.period || c.year || c.issuedOn || '').trim(),
      description: String(c.note || c.description || '').trim(),
    });
  }

  const awards = Array.isArray(p.awards) ? p.awards : [];
  for (const item of awards) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    hints.push({
      id: String(a.id || ''),
      vaultId: String(a.vault_id || '').trim(),
      title: String(a.title || '').trim(),
      issuer: String(a.org || a.issuer || a.organization || '').trim(),
      kind: 'award',
      issuedOn: String(a.period || a.year || '').trim(),
      description: String(a.note || a.description || '').trim(),
    });
  }

  return hints.filter((h) => h.title || h.vaultId);
}

export function buildRegistryCredentials(params: {
  vaults: VaultRecord[];
  certificates: IssuedCertificate[];
  hints: PortfolioCredentialHint[];
  recipientName?: string | null;
}): RegistryCredential[] {
  const certByVault = new Map(params.certificates.map((c) => [c.vaultId, c]));
  const vaultById = new Map(params.vaults.map((v) => [v.id, v]));
  const hintsByVault = new Map<string, PortfolioCredentialHint>();
  const unmatchedHints: PortfolioCredentialHint[] = [];

  for (const hint of params.hints) {
    if (hint.vaultId && vaultById.has(hint.vaultId)) hintsByVault.set(hint.vaultId, hint);
    else unmatchedHints.push(hint);
  }

  const usedVaults = new Set<string>();
  const rows: RegistryCredential[] = [];

  // Only records the user added as credentials (portfolio hints). Do not treat every vault file as a certificate.
  for (const vault of params.vaults) {
    const hint = hintsByVault.get(vault.id);
    if (!hint) continue;
    const certificate = certByVault.get(vault.id) ?? null;
    usedVaults.add(vault.id);
    rows.push({
      id: certificate?.certificateId || hint.id || vault.id,
      kind: hint.kind,
      title: hint.title || titleFromFilename(vault.originalFileName),
      issuer: hint.issuer || null,
      issuedAt: certificate?.issuedAt || hint.issuedOn || vault.createdAt,
      vault,
      certificate,
      human: humanVerificationFromVault(vault),
      protectedInHub: true,
      description: hint.description || '',
      recipientName: params.recipientName ?? null,
    });
  }

  for (const hint of unmatchedHints) {
    const linked = hint.vaultId ? vaultById.get(hint.vaultId) ?? null : null;
    if (linked && usedVaults.has(linked.id)) continue;
    rows.push({
      id: hint.id || `hint-${hint.title}`,
      kind: hint.kind,
      title: hint.title || 'Untitled credential',
      issuer: hint.issuer || null,
      issuedAt: hint.issuedOn || null,
      vault: linked,
      certificate: linked ? certByVault.get(linked.id) ?? null : null,
      human: humanVerificationFromVault(linked),
      protectedInHub: Boolean(linked),
      description: hint.description,
      recipientName: params.recipientName ?? null,
    });
  }

  if (!params.hints.length && rows.length === 0) {
    for (const vault of params.vaults) {
      const certificate = certByVault.get(vault.id) ?? null;
      if (!certificate) continue;
      rows.push({
        id: certificate.certificateId,
        kind: 'certificate',
        title: titleFromFilename(vault.originalFileName),
        issuer: null,
        issuedAt: certificate.issuedAt || vault.createdAt,
        vault,
        certificate,
        human: humanVerificationFromVault(vault),
        protectedInHub: true,
        description: '',
        recipientName: params.recipientName ?? null,
      });
    }
  }

  return rows;
}

export function registryMetrics(items: RegistryCredential[]) {
  const protectedCount = items.filter((i) => i.protectedInHub).length;
  const verified = items.filter((i) => i.human.state === 'verified') as Array<RegistryCredential & { human: { state: 'verified'; percent: number } }>;
  const assessedCount = items.filter((i) => i.human.state === 'assessed').length;
  const avgVerified = verified.length
    ? Math.round(verified.reduce((sum, i) => sum + i.human.percent, 0) / verified.length)
    : null;
  const humanVerifiedCount = items.filter((i) => i.human.state === 'verified' && i.human.percent >= 90).length;
  return {
    total: items.length,
    protectedCount,
    verifiedCount: verified.length,
    humanVerifiedCount,
    assessedCount,
    avgVerified,
  };
}

export function sortCredentials(
  items: RegistryCredential[],
  sort: 'newest' | 'oldest' | 'verified' | 'alpha',
): RegistryCredential[] {
  const copy = [...items];
  const time = (item: RegistryCredential) => {
    const raw = item.issuedAt || item.vault?.createdAt;
    const t = raw ? Date.parse(raw) : 0;
    return Number.isFinite(t) ? t : 0;
  };
  if (sort === 'oldest') copy.sort((a, b) => time(a) - time(b));
  else if (sort === 'alpha') copy.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'verified') {
    copy.sort((a, b) => {
      const av = a.human.state === 'verified' ? a.human.percent : a.human.state === 'assessed' ? 1 : 0;
      const bv = b.human.state === 'verified' ? b.human.percent : b.human.state === 'assessed' ? 1 : 0;
      return bv - av || time(b) - time(a);
    });
  } else copy.sort((a, b) => time(b) - time(a));
  return copy;
}

export function issuerDisplay(item: RegistryCredential): string {
  if (item.issuer) return item.issuer;
  return 'Issuer not recorded';
}

export type CredentialSeal = {
  headline: string;
  tier: 'gold' | 'silver' | 'bronze' | null;
  percent: number | null;
};

/** Map a real human % to a seal. Never invent a score. */
export function credentialSeal(human: HumanVerification): CredentialSeal {
  if (human.state !== 'verified') {
    if (human.state === 'assessed') return { headline: 'ASSESSED', tier: null, percent: null };
    return { headline: '', tier: null, percent: null };
  }
  const percent = human.percent;
  if (percent >= 90) return { headline: 'HUMAN VERIFIED', tier: 'gold', percent };
  if (percent >= 75) return { headline: 'VERIFIED', tier: 'silver', percent };
  if (percent >= 50) return { headline: 'REVIEWED', tier: 'bronze', percent };
  return { headline: '', tier: null, percent };
}

export function compactCredentialId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  if (trimmed.length > 32) return null;
  return trimmed;
}

export function earliestYear(items: RegistryCredential[]): number | null {
  let min: number | null = null;
  for (const item of items) {
    const raw = item.issuedAt || item.vault?.createdAt;
    if (!raw) continue;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) continue;
    const y = new Date(t).getFullYear();
    if (min == null || y < min) min = y;
  }
  return min;
}

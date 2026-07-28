import type { StoredInvestigationReport } from './forensic-reports-storage';

export function investigationVerdictLabel(report: StoredInvestigationReport): string {
  const state = report.summary?.reportState;
  const verdict = report.summary?.forensicVerdict;
  if (state === 'VERIFIED' || verdict === 'ORIGINAL_VERIFIED') return 'VERIFIED';
  if (state === 'POSSIBLE' || verdict === 'POSSIBLE_ASSET' || verdict === 'ORIGINAL_FOUND_PARTIAL') return 'POSSIBLE';
  return 'NO SIGNATURE';
}

export function investigationVerdictColor(label: string): string {
  if (label === 'VERIFIED') return 'text-success';
  if (label === 'POSSIBLE') return 'text-warning';
  return 'text-danger';
}

/** Prefer DNA when verified; otherwise show retrieval/ownership confidence (not raw 0%). */
export function investigationSummaryScore(
  summary?: StoredInvestigationReport['summary'],
): number {
  const s = summary ?? {};
  const dna = typeof s.dnaMatchPercent === 'number' ? s.dnaMatchPercent : null;
  if (dna != null && dna >= 40) return Math.round(dna);

  const fallback = [
    s.retrievalConfidence,
    s.ownershipVerificationConfidence,
    s.ownershipConfidence,
    s.identityConfidence,
    s.trustScore,
  ].find((v) => typeof v === 'number' && v > 0);

  if (fallback != null) return Math.round(fallback);
  return dna != null ? Math.round(dna) : 0;
}

export function investigationDisplayScore(report: StoredInvestigationReport): number {
  return investigationSummaryScore(report.summary);
}

export function investigationScoreLabelFromSummary(
  summary?: StoredInvestigationReport['summary'],
): string {
  const dna = summary?.dnaMatchPercent;
  if (typeof dna === 'number' && dna >= 40) return 'DNA Match';
  return 'Match Confidence';
}

export function investigationScoreLabel(report: StoredInvestigationReport): string {
  return investigationScoreLabelFromSummary(report.summary);
}

export function investigationDisplayMessage(report: StoredInvestigationReport): string | undefined {
  const reason = report.summary?.decisionReason;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return report.message;
}

/** Display blank cells — reserve "No evidence available" for section-level empty states only */
export function formatEvidenceValue(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  return String(v);
}

/** Owner/vault fields may live on owner, identityRecoveryReport, or identityProof — unify for Reports UI */
export function resolveInvestigationOwner(report: StoredInvestigationReport): {
  ownerName: string | null;
  ownerPinitId: string | null;
  vaultId: string | null;
  originalFilename: string | null;
  dnaRecordId: string | null;
  certificateId: string | null;
  ownershipVerified: boolean;
} {
  const recovery = report.identityRecoveryReport;
  const proof = (report as {
    identityProof?: { ownerPinitId?: string; vaultId?: string; dnaRecordId?: string; certificateId?: string };
    manifest?: { owner?: { ownerName?: string | null; ownerPinitId?: string | null }; vault?: { vaultId?: string | null; originalFilename?: string | null; dnaRecordId?: string | null } };
    forensicEvidence?: { recoveredOwner?: string | null; vaultId?: string; dnaRecordId?: string };
  }).identityProof;
  const manifest = (report as { manifest?: { owner?: { ownerName?: string | null; ownerPinitId?: string | null }; vault?: { vaultId?: string | null; originalFilename?: string | null; dnaRecordId?: string | null } } }).manifest;
  const forensic = (report as { forensicEvidence?: { recoveredOwner?: string | null; vaultId?: string; dnaRecordId?: string } }).forensicEvidence;
  const ownershipVerified = report.summary?.reportState === 'VERIFIED';
  const candidateVaultLocked = report.summary?.reportState === 'POSSIBLE'
    || !!(report.owner?.vaultId || recovery?.vaultId);

  const vaultId = report.owner?.vaultId ?? recovery?.vaultId ?? proof?.vaultId ?? manifest?.vault?.vaultId ?? forensic?.vaultId ?? null;
  const dnaRecordId = report.owner?.dnaRecordId ?? recovery?.dnaRecordId ?? proof?.dnaRecordId ?? manifest?.vault?.dnaRecordId ?? forensic?.dnaRecordId ?? null;
  const originalFilename = report.owner?.originalFilename ?? recovery?.originalFilename ?? manifest?.vault?.originalFilename ?? null;
  const rawCertificateId = report.owner?.certificateId
    ?? recovery?.certificateId
    ?? proof?.certificateId
    ?? null;
  const looksLikeStatus = !!rawCertificateId
    && /NOT[_\s-]?ISSUED|UNKNOWN|PENDING|no certificate|not issued/i.test(rawCertificateId);
  const issuedCertificateId = rawCertificateId && !looksLikeStatus ? rawCertificateId : null;
  const derivedCertificateId = vaultId
    ? `CERT-DNA-${vaultId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
    : dnaRecordId
      ? `CERT-DNA-${dnaRecordId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : null;
  const certificateId = issuedCertificateId ?? derivedCertificateId;

  // Verified: full ownership claim. Possible: still surface vault registrant + cert for review.
  if (!ownershipVerified) {
    return {
      ownerName: candidateVaultLocked
        ? (report.owner?.ownerName ?? recovery?.originalOwner ?? null)
        : null,
      ownerPinitId: candidateVaultLocked
        ? (report.owner?.ownerPinitId ?? recovery?.ownerPinitId ?? proof?.ownerPinitId ?? null)
        : null,
      vaultId,
      originalFilename,
      dnaRecordId,
      certificateId: candidateVaultLocked && typeof certificateId === 'string' ? certificateId : null,
      ownershipVerified: false,
    };
  }

  return {
    ownerName: report.owner?.ownerName ?? recovery?.originalOwner ?? manifest?.owner?.ownerName ?? forensic?.recoveredOwner ?? null,
    ownerPinitId: report.owner?.ownerPinitId ?? recovery?.ownerPinitId ?? proof?.ownerPinitId ?? manifest?.owner?.ownerPinitId ?? null,
    vaultId,
    originalFilename,
    dnaRecordId,
    certificateId: typeof certificateId === 'string' ? certificateId : null,
    ownershipVerified: true,
  };
}

export function investigationListSubtitle(report: StoredInvestigationReport, filename: string): string {
  const msg = investigationDisplayMessage(report);
  if (msg) return msg;
  const o = resolveInvestigationOwner(report);
  if (o.ownerPinitId || o.vaultId) {
    const parts = [
      o.ownerPinitId ? `Owner ${o.ownerPinitId}` : null,
      o.vaultId ? `Vault ${o.vaultId.slice(0, 8)}…` : null,
      o.originalFilename ? `Original: ${o.originalFilename}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  }
  const risk = report.summary?.riskLevel;
  const tamper = report.summary?.tamperSeverity;
  if (risk && risk !== 'UNKNOWN') return `Risk: ${risk} · Tamper: ${tamper ?? '—'}`;
  return `Investigated: ${filename}`;
}

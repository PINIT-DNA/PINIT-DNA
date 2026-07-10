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

/** Owner/vault fields may live on owner, identityRecoveryReport, or identityProof — unify for Reports UI */
export function resolveInvestigationOwner(report: StoredInvestigationReport): {
  ownerName: string | null;
  ownerPinitId: string | null;
  vaultId: string | null;
  originalFilename: string | null;
  dnaRecordId: string | null;
} {
  const recovery = report.identityRecoveryReport;
  const proof = (report as {
    identityProof?: { ownerPinitId?: string; vaultId?: string; dnaRecordId?: string };
    manifest?: { owner?: { ownerName?: string | null; ownerPinitId?: string | null }; vault?: { vaultId?: string | null; originalFilename?: string | null } };
  }).identityProof;
  const manifest = (report as { manifest?: { owner?: { ownerName?: string | null; ownerPinitId?: string | null }; vault?: { vaultId?: string | null; originalFilename?: string | null } } }).manifest;

  return {
    ownerName: report.owner?.ownerName ?? recovery?.originalOwner ?? manifest?.owner?.ownerName ?? null,
    ownerPinitId: report.owner?.ownerPinitId ?? recovery?.ownerPinitId ?? proof?.ownerPinitId ?? manifest?.owner?.ownerPinitId ?? null,
    vaultId: report.owner?.vaultId ?? recovery?.vaultId ?? proof?.vaultId ?? manifest?.vault?.vaultId ?? null,
    originalFilename: report.owner?.originalFilename ?? recovery?.originalFilename ?? manifest?.vault?.originalFilename ?? null,
    dnaRecordId: report.owner?.dnaRecordId ?? recovery?.dnaRecordId ?? proof?.dnaRecordId ?? null,
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
